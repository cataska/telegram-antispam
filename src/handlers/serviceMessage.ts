import { Context } from 'grammy';
import { attachJoinMessage } from '../store/pending.js';
import { consumeRecentlyRemoved } from '../store/recentlyRemoved.js';

// 處理「XX 加入群組」服務訊息：
// - 驗證中的用戶 → 記下訊息 id，未通過驗證時一併刪除
// - 剛被 bot 移除的用戶（CAS 封鎖、戒備踢出）→ 立即刪除
export async function handleServiceMessage(ctx: Context) {
  const chatId = ctx.chat?.id;
  const message = ctx.message;
  const members = message?.new_chat_members;
  if (!chatId || !message || !members) return;

  for (const member of members) {
    if (member.is_bot) continue;

    if (consumeRecentlyRemoved(chatId, member.id)) {
      try {
        await ctx.api.deleteMessage(chatId, message.message_id);
      } catch {
        // 訊息可能已不存在，忽略
      }
      return; // 整則訊息已刪，不需再處理其他成員
    }

    attachJoinMessage(chatId, member.id, message.message_id);
  }
}
