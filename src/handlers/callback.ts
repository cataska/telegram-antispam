import { Context } from 'grammy';
import { pendingUsers } from '../store/pending.js';
import { verifiedUsers } from '../store/verified.js';

export async function handleCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('verify:')) return;

  const [, oderId, answer] = data.split(':');
  const chatId = ctx.chat?.id;
  const callerId = ctx.from?.id;
  const userId = Number(oderId);

  if (!chatId || !callerId) return;

  // 只有本人可以回答
  if (callerId !== userId) {
    await ctx.answerCallbackQuery({ text: '這不是你的驗證問題！', show_alert: true });
    return;
  }

  const key = `${chatId}:${userId}`;
  const pending = pendingUsers.get(key);

  if (!pending) {
    await ctx.answerCallbackQuery({ text: '驗證已過期', show_alert: true });
    return;
  }

  if (answer === pending.correctAnswer) {
    // 驗證成功
    pendingUsers.delete(key);
    verifiedUsers.add(key);

    // 恢復發言權限
    await ctx.api.restrictChatMember(chatId, callerId, {
      permissions: {
        can_send_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
    });

    await ctx.answerCallbackQuery({ text: '驗證成功！' });
    await ctx.api.deleteMessage(chatId, pending.messageId);
  } else {
    // 驗證失敗
    pendingUsers.delete(key);

    await ctx.api.banChatMember(chatId, callerId);
    await ctx.api.unbanChatMember(chatId, callerId); // 允許重新加入
    await ctx.answerCallbackQuery({ text: '答案錯誤，請重新加入群組', show_alert: true });
    await ctx.api.deleteMessage(chatId, pending.messageId);
  }
}
