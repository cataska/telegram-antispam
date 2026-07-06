import type { DB } from '../db.js';

export interface PendingUser {
  userId: number;
  chatId: number;
  correctAnswer: string;
  joinedAt: number; // epoch 毫秒
  captchaMessageId: number;
  joinMessageId?: number;
}

export type TimeoutHandler = (pending: PendingUser) => Promise<void> | void;

let db: DB;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const keyOf = (chatId: number, userId: number) => `${chatId}:${userId}`;

export function initPendingStore(database: DB) {
  db = database;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export function addPending(pending: PendingUser, timeoutMs: number, onTimeout: TimeoutHandler) {
  const key = keyOf(pending.chatId, pending.userId);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing); // 同用戶重複入群：舊 timer 作廢

  db.prepare(
    `INSERT OR REPLACE INTO pending
       (chat_id, user_id, correct_answer, joined_at, captcha_message_id, join_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    pending.chatId,
    pending.userId,
    pending.correctAnswer,
    pending.joinedAt,
    pending.captchaMessageId,
    pending.joinMessageId ?? null
  );

  scheduleTimeout(pending, timeoutMs, onTimeout);
}

function scheduleTimeout(pending: PendingUser, delayMs: number, onTimeout: TimeoutHandler) {
  const key = keyOf(pending.chatId, pending.userId);
  timers.set(
    key,
    setTimeout(async () => {
      const current = getPending(pending.chatId, pending.userId);
      // 已被 resolve、或已是另一次入群的記錄時不動作
      if (!current || current.joinedAt !== pending.joinedAt) return;
      resolvePending(pending.chatId, pending.userId);
      await onTimeout(current);
    }, delayMs)
  );
}

export function getPending(chatId: number, userId: number): PendingUser | undefined {
  const row = db
    .prepare(`SELECT * FROM pending WHERE chat_id = ? AND user_id = ?`)
    .get(chatId, userId) as
    | {
        chat_id: number;
        user_id: number;
        correct_answer: string;
        joined_at: number;
        captcha_message_id: number;
        join_message_id: number | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    correctAnswer: row.correct_answer,
    joinedAt: row.joined_at,
    captchaMessageId: row.captcha_message_id,
    joinMessageId: row.join_message_id ?? undefined,
  };
}

export function attachJoinMessage(chatId: number, userId: number, messageId: number): boolean {
  const result = db
    .prepare(`UPDATE pending SET join_message_id = ? WHERE chat_id = ? AND user_id = ?`)
    .run(messageId, chatId, userId);
  return result.changes > 0;
}

export function resolvePending(chatId: number, userId: number) {
  const key = keyOf(chatId, userId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  db.prepare(`DELETE FROM pending WHERE chat_id = ? AND user_id = ?`).run(chatId, userId);
}

// 啟動時恢復：未過期者按剩餘時間重建 timer；已過期者以 delay 0 走同一條超時路徑
export function restorePending(timeoutMs: number, onTimeout: TimeoutHandler): number {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();

  const rows = db.prepare(`SELECT chat_id, user_id FROM pending`).all() as Array<{
    chat_id: number;
    user_id: number;
  }>;
  const now = Date.now();
  let restored = 0;
  for (const row of rows) {
    const pending = getPending(row.chat_id, row.user_id)!;
    const remaining = pending.joinedAt + timeoutMs - now;
    scheduleTimeout(pending, Math.max(0, remaining), onTimeout);
    if (remaining > 0) restored++;
  }
  return restored;
}
