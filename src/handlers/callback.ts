import { Context } from 'grammy';
import { getPending, resolvePending, PendingUser } from '../store/pending.js';
import { config } from '../config.js';
import { kickAndCleanup, deletePendingMessages } from './pendingActions.js';

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

// 以群組預設權限恢復發言，避免給新成員比群組設定更寬的權限
async function liftRestrictions(ctx: Context, chatId: number, userId: number) {
  const chat = await ctx.api.getChat(chatId);
  const permissions = chat.permissions ?? {
    can_send_messages: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
  };
  await ctx.api.restrictChatMember(chatId, userId, permissions);
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

  const [, targetId, action] = data.split(':');
  const userId = Number(targetId);
  const pending = getPending(chatId, userId);
  resolvePending(chatId, userId);

  switch (action) {
    case 'pass':
      // 直接通過驗證：保留入群訊息，只刪驗證訊息
      await liftRestrictions(ctx, chatId, userId);
      await ctx.answerCallbackQuery({ text: '已通過驗證' });
      if (pending) {
        try {
          await ctx.api.deleteMessage(chatId, pending.captchaMessageId);
        } catch {
          // 訊息可能已不存在，忽略
        }
      }
      console.log(`[管理員] 管理員 ${callerId} 手動通過用戶 ${userId} 的驗證`);
      break;

    case 'ban':
      // 封鎖用戶：屬未通過驗證，連入群訊息一併刪除
      await ctx.api.banChatMember(chatId, userId);
      await ctx.answerCallbackQuery({ text: '已封鎖用戶' });
      if (pending) {
        await deletePendingMessages(ctx.api, pending);
      }
      console.log(`[管理員] 管理員 ${callerId} 封鎖用戶 ${userId}`);
      break;

    case 'mute': {
      // 禁言：屬未通過驗證，連入群訊息一併刪除
      const until = Math.floor(Date.now() / 1000) + config.adminMuteSeconds;
      await ctx.api.restrictChatMember(
        chatId,
        userId,
        { can_send_messages: false },
        { until_date: until }
      );
      await ctx.answerCallbackQuery({ text: `已禁言 ${config.adminMuteSeconds / 3600} 小時` });
      if (pending) {
        await deletePendingMessages(ctx.api, pending);
      }
      console.log(`[管理員] 管理員 ${callerId} 禁言用戶 ${userId} ${config.adminMuteSeconds / 3600} 小時`);
      break;
    }
  }
}

async function handleVerifyAction(
  ctx: Context,
  data: string,
  chatId: number,
  callerId: number
) {
  const [, targetId, answer] = data.split(':');
  const userId = Number(targetId);

  // 只有本人可以回答
  if (callerId !== userId) {
    await ctx.answerCallbackQuery({ text: '這不是你的驗證問題！', show_alert: true });
    return;
  }

  const pending = getPending(chatId, userId);

  if (!pending) {
    await ctx.answerCallbackQuery({ text: '驗證已過期', show_alert: true });
    return;
  }

  resolvePending(chatId, userId);

  if (answer === pending.correctAnswer) {
    // 驗證成功：保留入群訊息，只刪驗證訊息
    await liftRestrictions(ctx, chatId, callerId);
    await ctx.answerCallbackQuery({ text: '驗證成功！' });
    try {
      await ctx.api.deleteMessage(chatId, pending.captchaMessageId);
    } catch {
      // 訊息可能已不存在，忽略
    }
    console.log(`[驗證成功] 用戶 ${userId} 通過驗證`);
  } else {
    // 驗證失敗：踢出並清理驗證訊息與入群訊息
    await ctx.answerCallbackQuery({ text: '答案錯誤，請重新加入群組', show_alert: true });
    await kickAndCleanup(ctx.api, pending);
    console.log(`[驗證失敗] 用戶 ${userId} 答錯，已踢出`);
  }
}
