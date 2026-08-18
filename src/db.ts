import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 資料庫類型別名
export type DB = Database.Database;

/**
 * 開啟資料庫連線並初始化 pending、members 表
 * @param path - 資料庫文件路徑，特殊值 ':memory:' 表示使用記憶體資料庫
 * @returns 初始化後的資料庫實例
 */
export function openDb(path: string): DB {
  // 為非記憶體資料庫自動建立父目錄
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // 啟用 WAL 模式以提高並發性能
  db.pragma('journal_mode = WAL');

  // 建立 pending 表以儲存待驗證用戶資訊
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending (
      chat_id            INTEGER NOT NULL,
      user_id            INTEGER NOT NULL,
      correct_answer     TEXT    NOT NULL,
      joined_at          INTEGER NOT NULL,
      captcha_message_id INTEGER NOT NULL,
      join_message_id    INTEGER,
      PRIMARY KEY (chat_id, user_id)
    )
  `);

  // 記錄成員的加入時間，供「新成員限制」（例如入群一段時間內禁發連結）判斷
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      chat_id   INTEGER NOT NULL,
      user_id   INTEGER NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    )
  `);

  return db;
}
