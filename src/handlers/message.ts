import { Context, NextFunction } from 'grammy';
import { isRecentMember } from '../store/members.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { containsRestrictedContent } from '../services/linkFilter.js';
import { trackAlbumMessage, flagAlbum } from '../services/albumTracker.js';
import { config } from '../config.js';

// 管理員豁免所有限制。只在即將處置時才查，避免每則訊息都打一次 API。
async function isAdmin(ctx: Context, chatId: number, userId: number): Promise<boolean> {
  const member = await ctx.api.getChatMember(chatId, userId);
  return member.status === 'administrator' || member.status === 'creator';
}

// 匿名管理員（以群組本身的身分發言）與連結頻道的自動轉發都是管理員層級的行為，放行。
// 其他頻道身分無法對應到任何成員的加入紀錄，也無法禁言，
// 而用一次性頻道當馬甲打廣告是常見手法：一律套用新成員的內容限制，洪水則直接刪訊息。
async function handleSenderChatMessage(
  ctx: Context,
  next: NextFunction,
  chatId: number,
  senderChatId: number
) {
  const msg = ctx.msg!;
  if (senderChatId === chatId || msg.is_automatic_forward) {
    return next();
  }

  if (containsRestrictedContent(msg, ctx.me?.username)) {
    await ctx.deleteMessage();
    console.log(`[連結過濾] 刪除頻道身分 ${senderChatId} 的訊息（含連結、@bot 提及或外部載體）`);
    return;
  }

  if (!ctx.editedMessage && checkRateLimit(chatId, senderChatId, msg.media_group_id)) {
    await ctx.deleteMessage();
    console.log(`[洪水偵測] 頻道身分 ${senderChatId} 發送過於頻繁，刪除訊息`);
    return;
  }

  return next();
}

// 同時處理新訊息與編輯後的訊息（ctx.msg 兩者皆涵蓋）。
// 編輯是連結過濾的破口：先發無害文字，事後再改成廣告。
export async function handleMessage(ctx: Context, next: NextFunction) {
  const chat = ctx.chat;
  const userId = ctx.from?.id;
  const msg = ctx.msg;

  // 只處理群組訊息
  if (!chat || !userId || !msg || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    return next();
  }

  const chatId = chat.id;
  const albumId = msg.media_group_id;

  // 以頻道身分或匿名管理員發言時，from 只是 Telegram 的服務帳號，真正的主體在 sender_chat。
  if (msg.sender_chat) {
    return handleSenderChatMessage(ctx, next, chatId, msg.sender_chat.id);
  }

  // 1. 新成員在加入後的限制期內禁止發連結、@bot 提及、轉發、inline bot 內容。
  //    綁在驗證狀態上是擋不到廣告的：驗證期間本來就全靜音，
  //    真正的破口是「通過驗證後先潛伏、隔一段時間再發廣告」。
  if (isRecentMember(chatId, userId, config.linkRestrictWindowMs)) {
    // 相簿只有一則帶 caption，其餘圖片在命中後才陸續抵達，得靠標記補刪
    if (albumId !== undefined && trackAlbumMessage(chatId, albumId, msg.message_id)) {
      await ctx.deleteMessage();
      console.log(`[連結過濾] 刪除新成員 ${userId} 已判定違規相簿的後續圖片`);
      return;
    }

    if (containsRestrictedContent(msg, ctx.me?.username) && !(await isAdmin(ctx, chatId, userId))) {
      await ctx.deleteMessage();
      const kind = ctx.editedMessage ? '編輯後' : '';
      console.log(`[連結過濾] 刪除新成員 ${userId} 的${kind}訊息（含連結、@bot 提及或外部載體）`);

      if (albumId !== undefined) {
        const earlier = flagAlbum(chatId, albumId, msg.message_id);
        if (earlier.length > 0) {
          await ctx.api.deleteMessages(chatId, earlier);
          console.log(`[連結過濾] 一併刪除同相簿先前抵達的 ${earlier.length} 則訊息`);
        }
      }
      return;
    }
  }

  // 編輯不是新的發言，不計入洪水
  if (ctx.editedMessage) {
    return next();
  }

  // 2. 洪水偵測（管理員豁免）
  const isFlooding = checkRateLimit(chatId, userId, msg.media_group_id);
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
