import 'dotenv/config';
import { Bot } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
import { config } from './config.js';
import { openDb } from './db.js';
import { restorePending, stopAllTimers } from './store/pending.js';
import { pruneMembers } from './store/members.js';
import { initStores } from './store/index.js';
import { kickAndCleanup } from './handlers/pendingActions.js';
import { setupHandlers } from './handlers/index.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN environment variable is required');
}

const bot = new Bot(token);

const db = openDb(config.dbPath);
initStores(db);
pruneMembers(config.linkRestrictWindowMs);

// 依「群組 + 觸發者」分流並行處理。必須在所有 handler 之前註冊。
// 同一觸發者的 update 維持原順序（chat_member 仍早於對應的 new_chat_members
// 服務訊息），不同人則並行——CAS 查詢最長要等 3 秒，循序處理時這 3 秒會把
// 其他人的訊息和驗證按鈕全卡在後面，入群洪水時最壞會累積成數十秒。
bot.use(
  sequentialize((ctx) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (chatId === undefined || userId === undefined) return undefined;
    return `${chatId}:${userId}`;
  })
);

setupHandlers(bot);

// 防止單次 API 錯誤（例如對管理員 restrict 失敗、刪除已刪訊息）讓整個 bot 停擺
bot.catch((err) => {
  console.error(`[錯誤] 處理 update ${err.ctx.update.update_id} 時發生錯誤:`, err.error);
});

// 恢復重啟前進行中的驗證：未過期者按剩餘時間重建超時 timer，已過期者立即踢出
const { restored, expired } = restorePending(config.verifyTimeoutMs, async (pending) => {
  console.log(`[超時] 用戶 ${pending.userId} 驗證超時，已踢出群組 ${pending.chatId}`);
  await kickAndCleanup(bot.api, pending);
});
console.log(`[啟動] 恢復 ${restored} 筆進行中的驗證，另有 ${expired} 筆已逾時將立即處置`);

// chat_member 不在 getUpdates 的預設回傳範圍，必須明確列出才收得到新成員事件
const runner = run(bot, {
  runner: {
    fetch: { allowed_updates: ['chat_member', 'message', 'callback_query'] },
  },
});
console.log('Anti-spam bot is running...');

// 收到終止訊號時先停止收新 update，等處理中的 update 收尾，再關閉資料庫。
// 必須一併清掉驗證超時 timer，否則 Node 會撐到最後一個 timer 到期才結束，
// 容器停止時只能等 SIGKILL。
async function shutdown(signal: string) {
  console.log(`[關閉] 收到 ${signal}，停止接收 update`);
  if (runner.isRunning()) await runner.stop();
  stopAllTimers();
  db.close();
  console.log('[關閉] 已停止');
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
