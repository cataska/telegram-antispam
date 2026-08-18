import type { DB } from '../db.js';
import { initPendingStore } from './pending.js';
import { initMemberStore } from './members.js';

// 所有以 DB 為底的 store 共用同一個連線。
// 新增 store 時只要接進這裡，正式啟動與測試就會一起初始化。
export function initStores(db: DB) {
  initPendingStore(db);
  initMemberStore(db);
}
