import { Context, NextFunction } from 'grammy';
import { verifiedUsers } from '../store/verified.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { containsLink } from '../services/linkFilter.js';

export async function handleMessage(ctx: Context, next: NextFunction) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const text = ctx.message?.text || ctx.message?.caption || '';

  if (!chatId || !userId) return next();

  const key = `${chatId}:${userId}`;

  // 1. 新成員禁止發連結
  if (!verifiedUsers.has(key) && containsLink(text)) {
    await ctx.deleteMessage();
    return;
  }

  // 2. 洪水偵測
  const isFlooding = checkRateLimit(chatId, userId);
  if (isFlooding) {
    // 禁言 5 分鐘
    const until = Math.floor(Date.now() / 1000) + 300;
    await ctx.api.restrictChatMember(chatId, userId, {
      permissions: { can_send_messages: false },
      until_date: until,
    });
    await ctx.reply(`${ctx.from?.first_name} 發送訊息過於頻繁，已禁言 5 分鐘。`);
    return;
  }

  return next();
}
