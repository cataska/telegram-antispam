import { Context } from 'grammy';
import { pendingUsers } from '../store/pending.js';
import { verifiedUsers } from '../store/verified.js';

export async function handleCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const chatId = ctx.chat?.id;
  const callerId = ctx.from?.id;

  if (!chatId || !callerId) return;

  // 管理員快捷按鈕
  if (data.startsWith('admin:')) {
    await handleAdminAction(ctx, data, chatId, callerId);
    return;
  }

  // 用戶驗證按鈕
  if (data.startsWith('verify:')) {
    await handleVerifyAction(ctx, data, chatId, callerId);
    return;
  }
}

async function handleAdminAction(
  ctx: Context,
  data: string,
  chatId: number,
  callerId: number
) {
  // 檢查是否為管理員
  const member = await ctx.api.getChatMember(chatId, callerId);
  const isAdmin = ['administrator', 'creator'].includes(member.status);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '只有管理員可以操作', show_alert: true });
    return;
  }

  const [, oderId, action] = data.split(':');
  const userId = Number(oderId);
  const key = `${chatId}:${userId}`;
  const pending = pendingUsers.get(key);

  switch (action) {
    case 'pass':
      // 直接通過驗證
      pendingUsers.delete(key);
      verifiedUsers.add(key);
      await ctx.api.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      });
      await ctx.answerCallbackQuery({ text: '已通過驗證' });
      if (pending) {
        await ctx.api.deleteMessage(chatId, pending.messageId);
      }
      console.log(`[管理員] 管理員 ${callerId} 手動通過用戶 ${userId} 的驗證`);
      break;

    case 'ban':
      // 封鎖用戶
      pendingUsers.delete(key);
      await ctx.api.banChatMember(chatId, userId);
      await ctx.answerCallbackQuery({ text: '已封鎖用戶' });
      if (pending) {
        await ctx.api.deleteMessage(chatId, pending.messageId);
      }
      console.log(`[管理員] 管理員 ${callerId} 封鎖用戶 ${userId}`);
      break;

    case 'mute':
      // 禁言 24 小時
      pendingUsers.delete(key);
      const until = Math.floor(Date.now() / 1000) + 86400;
      await ctx.api.restrictChatMember(chatId, userId, {
        permissions: { can_send_messages: false },
        until_date: until,
      });
      await ctx.answerCallbackQuery({ text: '已禁言 24 小時' });
      if (pending) {
        await ctx.api.deleteMessage(chatId, pending.messageId);
      }
      console.log(`[管理員] 管理員 ${callerId} 禁言用戶 ${userId} 24 小時`);
      break;
  }
}

async function handleVerifyAction(
  ctx: Context,
  data: string,
  chatId: number,
  callerId: number
) {
  const [, oderId, answer] = data.split(':');
  const userId = Number(oderId);

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
    console.log(`[驗證成功] 用戶 ${userId} 通過驗證`);
  } else {
    // 驗證失敗
    pendingUsers.delete(key);

    await ctx.api.banChatMember(chatId, callerId);
    await ctx.api.unbanChatMember(chatId, callerId); // 允許重新加入
    await ctx.answerCallbackQuery({ text: '答案錯誤，請重新加入群組', show_alert: true });
    await ctx.api.deleteMessage(chatId, pending.messageId);
    console.log(`[驗證失敗] 用戶 ${userId} 答錯，已踢出`);
  }
}
