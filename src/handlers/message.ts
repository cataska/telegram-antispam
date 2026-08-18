import { Context, NextFunction } from 'grammy';
import { isRecentMember } from '../store/members.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { containsLink } from '../services/linkFilter.js';
import { config } from '../config.js';

// 管理員豁免所有限制。只在即將處置時才查，避免每則訊息都打一次 API。
async function isAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
  const member = await ctx.api.getChatMember(chatId, userId);
  return member.status === 'administrator' || member.status === 'creator';
}

export async function handleMessage(ctx: Context, next: NextFunction) {
  const chat = ctx.chat;
  const userId = ctx.from?.id;

  // 只處理群組訊息
  if (!chat || !userId || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    return next();
  }

  const chatId = chat.id;
  const text = ctx.message?.text || ctx.message?.caption || '';
  const entities = ctx.message?.entities ?? ctx.message?.caption_entities ?? [];

  // 1. 新成員在加入後的限制期內禁止發連結。
  //    綁在驗證狀態上是擋不到廣告的：驗證期間本來就全靜音，
  //    真正的破口是「通過驗證後先潛伏、隔一段時間再發廣告」。
  if (
    isRecentMember(chatId, userId, config.linkRestrictWindowMs) &&
    containsLink(text, entities) &&
    !(await isAdmin(ctx, chatId, userId))
  ) {
    await ctx.deleteMessage();
    console.log(`[連結過濾] 刪除新成員 ${userId} 的訊息（含連結）`);
    return;
  }

  // 2. 洪水偵測（管理員豁免）
  const isFlooding = checkRateLimit(chatId, userId, ctx.message?.media_group_id);
  if (isFlooding) {
    if (await isAdmin(ctx, chatId, userId)) {
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
