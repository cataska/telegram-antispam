import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';

describe('openDb', () => {
  it('建立 pending 表', () => {
    const db = openDb(':memory:');
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending'`)
      .get();
    expect(row).toBeDefined();
    db.close();
  });

  it('pending 表可寫入與讀回', () => {
    const db = openDb(':memory:');
    db.prepare(
      `INSERT INTO pending (chat_id, user_id, correct_answer, joined_at, captcha_message_id, join_message_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(-100, 42, '2', 1700000000000, 99, null);
    const row = db.prepare(`SELECT * FROM pending WHERE chat_id = ? AND user_id = ?`).get(-100, 42) as any;
    expect(row.correct_answer).toBe('2');
    expect(row.join_message_id).toBeNull();
    db.close();
  });
});
