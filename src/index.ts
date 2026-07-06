import 'dotenv/config';
import { Bot } from 'grammy';
import { config } from './config.js';
import { openDb } from './db.js';
import { initPendingStore, restorePending } from './store/pending.js';
import { kickAndCleanup } from './handlers/pendingActions.js';
import { setupHandlers } from './handlers/index.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(token);

initPendingStore(openDb(config.dbPath));
setupHandlers(bot);

// 防止單次 API 錯誤（例如對管理員 restrict 失敗、刪除已刪訊息）讓整個 bot 停擺
bot.catch((err) => {
  console.error(`[錯誤] 處理 update ${err.ctx.update.update_id} 時發生錯誤:`, err.error);
});

// 恢復重啟前進行中的驗證：未過期者按剩餘時間重建超時 timer，已過期者立即踢出
const restored = restorePending(config.verifyTimeoutMs, async (pending) => {
  console.log(`[超時] 用戶 ${pending.userId} 驗證超時，已踢出群組 ${pending.chatId}`);
  await kickAndCleanup(bot.api, pending);
});
console.log(`[啟動] 恢復 ${restored} 筆進行中的驗證`);

// chat_member 不在 getUpdates 的預設回傳範圍，必須明確列出才收得到新成員事件
bot.start({
  allowed_updates: ['chat_member', 'message', 'callback_query'],
});
console.log('Anti-spam bot is running...');
