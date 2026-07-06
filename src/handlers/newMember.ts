import { Context } from 'grammy';
import { addPending, PendingUser } from '../store/pending.js';
import { generateCaptcha } from '../services/captcha.js';
import { InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { kickAndCleanup } from './pendingActions.js';

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
