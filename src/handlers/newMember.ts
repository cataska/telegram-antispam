import { Context } from 'grammy';
import { addPending, getPending, resolvePending, PendingUser } from '../store/pending.js';
import { generateCaptcha } from '../services/captcha.js';
import { InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { kickAndCleanup, deletePendingMessages } from './pendingActions.js';
import { isCasBanned } from '../services/cas.js';
import { recordJoin } from '../services/joinFlood.js';
import { markRemoved } from '../store/recentlyRemoved.js';

export async function handleNewMember(ctx: Context) {
  const update = ctx.chatMember;
  if (!update) return;

  const { old_chat_member, new_chat_member, chat } = update;

  // 只處理真正的新加入：從群外（left/kicked）變成 member。
  // 排除降級（administrator → member）、解除禁言（restricted → member）等狀態轉變。
  if (new_chat_member.status !== 'member') return;
  if (old_chat_member.status !== 'left' && old_chat_member.status !== 'kicked') return;

  const user = new_chat_member.user;
  if (user.is_bot) return;

  const chatId = chat.id;
  const userId = user.id;

  // 1. 入群洪水檢查：戒備模式中直接踢出（可重新加入）
  const flood = recordJoin(chatId);
  if (flood.inAlert) {
    const stale = getPending(chatId, userId);
    if (stale) {
      resolvePending(chatId, userId);
      await deletePendingMessages(ctx.api, stale);
    }
    markRemoved(chatId, userId);
    await ctx.api.banChatMember(chatId, userId);
    await ctx.api.unbanChatMember(chatId, userId); // 允許稍後重新加入
    console.log(`[入群洪水] 戒備模式中踢出用戶 ${userId}（群組 ${chatId}）`);
    if (flood.justEntered) {
      try {
        await ctx.api.sendMessage(
          chatId,
          '⚠️ 偵測到大量帳號短時間湧入，已進入戒備模式：期間新加入的成員將被暫時移除，稍後可重新加入。'
        );
      } catch {
        // 通知失敗不影響防護
      }
    }
    return;
  }

  // 2. CAS 檢查：已知 spammer 直接永久封鎖
  if (await isCasBanned(userId)) {
    const stale = getPending(chatId, userId);
    if (stale) {
      resolvePending(chatId, userId);
      await deletePendingMessages(ctx.api, stale);
    }
    markRemoved(chatId, userId);
    await ctx.api.banChatMember(chatId, userId);
    console.log(`[CAS] 用戶 ${userId} 在 CAS 名單上，已永久封鎖（群組 ${chatId}）`);
    return;
  }

  // 限制新成員發言
  await ctx.api.restrictChatMember(chatId, userId, {
    can_send_messages: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
  });

  // 產生驗證題目
  const captcha = generateCaptcha();

  // 建立按鈕（選項垂直排列）
  const keyboard = new InlineKeyboard();
  captcha.options.forEach((option) => {
    keyboard.text(option, `verify:${userId}:${option}`).row();
  });

  // 管理員快捷按鈕（水平排列）
  keyboard
    .text('通過[✅]', `admin:${userId}:pass`)
    .text('封鎖[🚫]', `admin:${userId}:ban`)
    .text('禁言[🔇]', `admin:${userId}:mute`);

  const timeoutSeconds = config.verifyTimeoutMs / 1000;

  // 發送驗證訊息
  const message = await ctx.api.sendMessage(
    chatId,
    `🤖 入群驗證\n${user.first_name}，請在 ${timeoutSeconds} 秒內回答問題\nPlease answer within ${timeoutSeconds} seconds\n\n${captcha.question}`,
    { reply_markup: keyboard }
  );

  const pending: PendingUser = {
    userId,
    chatId,
    correctAnswer: captcha.correctAnswer,
    joinedAt: Date.now(),
    captchaMessageId: message.message_id,
  };

  console.log(`[新成員] ${user.first_name} (${userId}) 加入群組 ${chatId}，等待驗證`);

  addPending(pending, config.verifyTimeoutMs, async (p) => {
    console.log(`[超時] 用戶 ${p.userId} 驗證超時，已踢出群組 ${p.chatId}`);
    await kickAndCleanup(ctx.api, p);
  });
}
