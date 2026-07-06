import { Api } from 'grammy';
import { PendingUser } from '../store/pending.js';

// 刪除驗證訊息與（已記錄的）入群服務訊息；訊息可能已被刪，各自容錯
export async function deletePendingMessages(api: Api, pending: PendingUser) {
  try {
    await api.deleteMessage(pending.chatId, pending.captchaMessageId);
  } catch {
    // 訊息可能已不存在，忽略
  }
  if (pending.joinMessageId) {
    try {
      await api.deleteMessage(pending.chatId, pending.joinMessageId);
    } catch {
      // 同上
    }
  }
}

// 未通過驗證的統一處置：踢出（可重新加入）並清理訊息
export async function kickAndCleanup(api: Api, pending: PendingUser) {
  try {
    await api.banChatMember(pending.chatId, pending.userId);
    await api.unbanChatMember(pending.chatId, pending.userId); // 允許重新加入
  } catch (e) {
    console.log(`[清理] 踢出用戶 ${pending.userId} 失敗：${e}`);
  }
  await deletePendingMessages(api, pending);
}
