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

  const humans = members.filter((member) => !member.is_bot);

  // 一則訊息可含多位成員。必須先對每一位都消費掉「剛被移除」標記再決定刪不刪：
  // 命中就提早 return 的話，後面成員的標記會留到 TTL 過期，
  // 期間他若重新加入，正常的入群訊息會被誤刪。
  let removedAny = false;
  for (const member of humans) {
    if (consumeRecentlyRemoved(chatId, member.id)) removedAny = true;
  }

  if (removedAny) {
    try {
      await ctx.api.deleteMessage(chatId, message.message_id);
    } catch {
      // 訊息可能已不存在，忽略
    }
    return; // 整則訊息已刪，其他成員的入群訊息也隨之消失
  }

  for (const member of humans) {
    attachJoinMessage(chatId, member.id, message.message_id);
  }
}
