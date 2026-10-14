import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('建立 members 表', () => {
    const db = openDb(':memory:');
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'`)
      .get();
    expect(row).toBeDefined();
    db.close();
  });

  it('舊資料庫的 members 表會補上 violations 欄位，既有記錄保留', () => {
    const dir = mkdtempSync(join(tmpdir(), 'antispam-'));
    const path = join(dir, 'old.db');
    const old = new Database(path);
    old.exec(`CREATE TABLE members (
      chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id))`);
    old.prepare(`INSERT INTO members VALUES (?, ?, ?)`).run(-100, 42, 1700000000000);
    old.close();

    const db = openDb(path);
    const row = db.prepare(`SELECT * FROM members`).get() as any;
    expect(row.joined_at).toBe(1700000000000);
    expect(row.violations).toBe(0);
    db.close();
    rmSync(dir, { recursive: true });
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
