import type { DB } from '../db.js';

let db: DB;

export function initMemberStore(database: DB) {
  db = database;
}

// 記錄成員加入時間。同一人重新加入時以最新一次為準（限制期重新起算）。
export function recordMemberJoin(chatId: number, userId: number, joinedAt: number = Date.now()) {
  db.prepare(
    `INSERT OR REPLACE INTO members (chat_id, user_id, joined_at) VALUES (?, ?, ?)`
  ).run(chatId, userId, joinedAt);
}

// 加入未滿 windowMs 的成員視為「新成員」，適用較嚴格的限制。
// bot 進群之前就在的老成員沒有記錄，一律不受限。
export function isRecentMember(
  chatId: number,
  userId: number,
  windowMs: number,
  now: number = Date.now()
): boolean {
  if (windowMs <= 0) return false;
  const row = db
    .prepare(`SELECT joined_at FROM members WHERE chat_id = ? AND user_id = ?`)
    .get(chatId, userId) as { joined_at: number } | undefined;
  if (!row) return false;
  return now - row.joined_at < windowMs;
}

// 清掉已過限制期的記錄，避免表隨時間無限成長
export function pruneMembers(windowMs: number, now: number = Date.now()): number {
  if (windowMs <= 0) return 0;
  const result = db.prepare(`DELETE FROM members WHERE joined_at < ?`).run(now - windowMs);
  return result.changes;
}
