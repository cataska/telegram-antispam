import { Context, NextFunction } from 'grammy';
import { getPending } from '../store/pending.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { containsLink } from '../services/linkFilter.js';
import { config } from '../config.js';

export async function handleMessage(ctx: Context, next: NextFunction) {
  const chat = ctx.chat;
  const userId = ctx.from?.id;

  // 只處理群組訊息
  if (!chat || !userId || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    return next();
  }

  const chatId = chat.id;
  const text = ctx.message?.text || ctx.message?.caption || '';

  // 1. 驗證中的新成員禁止發連結
  if (getPending(chatId, userId) && containsLink(text)) {
    await ctx.deleteMessage();
    console.log(`[連結過濾] 刪除驗證中用戶 ${userId} 的訊息（含連結）`);
    return;
  }

  // 2. 洪水偵測（管理員豁免）
  const isFlooding = checkRateLimit(chatId, userId, ctx.message?.media_group_id);
  if (isFlooding) {
    const member = await ctx.api.getChatMember(chatId, userId);
    if (member.status === 'administrator' || member.status === 'creator') {
      return next();
    }

    const until = Math.floor(Date.now() / 1000) + config.floodMuteSeconds;
    await ctx.api.restrictChatMember(
      chatId,
      userId,
      { can_send_messages: false },
      { until_date: until }
    );
    await ctx.reply(`${ctx.from?.first_name} 發送訊息過於頻繁，已禁言 ${config.floodMuteSeconds / 60} 分鐘。`);
    console.log(`[洪水偵測] 用戶 ${userId} 發送過於頻繁，禁言 ${config.floodMuteSeconds / 60} 分鐘`);
    return;
  }

  return next();
}
