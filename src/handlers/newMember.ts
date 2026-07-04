import { Context } from 'grammy';
import { pendingUsers, PendingUser } from '../store/pending.js';
import { generateCaptcha } from '../services/captcha.js';
import { InlineKeyboard } from 'grammy';

const VERIFY_TIMEOUT_MS = 180_000; // 180 秒

export async function handleNewMember(ctx: Context) {
  const update = ctx.chatMember;
  if (!update) return;

  const { new_chat_member, chat } = update;

  // 只處理新加入的成員
  if (new_chat_member.status !== 'member') return;

  const user = new_chat_member.user;
  if (user.is_bot) return;

  const chatId = chat.id;
  const userId = user.id;

  // 限制新成員發言
  await ctx.api.restrictChatMember(chatId, userId, {
    permissions: {
      can_send_messages: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    },
  });

  // 產生驗證題目
  const captcha = generateCaptcha();

  // 儲存待驗證狀態
  const pending: PendingUser = {
    userId,
    chatId,
    correctAnswer: captcha.correctAnswer,
    joinedAt: Date.now(),
    messageId: 0,
  };

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

  // 發送驗證訊息
  const message = await ctx.api.sendMessage(
    chatId,
    `🤖 入群驗證\n${user.first_name}，請在 180 秒內回答問題\nPlease answer within 180 seconds\n\n${captcha.question}`,
    { reply_markup: keyboard }
  );

  pending.messageId = message.message_id;
  pendingUsers.set(`${chatId}:${userId}`, pending);

  console.log(`[新成員] ${user.first_name} (${userId}) 加入群組 ${chatId}，等待驗證`);

  // 設定超時
  setTimeout(async () => {
    const key = `${chatId}:${userId}`;
    if (pendingUsers.has(key)) {
      pendingUsers.delete(key);
      console.log(`[超時] 用戶 ${userId} 驗證超時，已踢出群組 ${chatId}`);
      try {
        await ctx.api.banChatMember(chatId, userId);
        await ctx.api.unbanChatMember(chatId, userId); // 允許重新加入
        await ctx.api.deleteMessage(chatId, message.message_id);
      } catch (e) {
        // 忽略錯誤
      }
    }
  }, VERIFY_TIMEOUT_MS);
}
