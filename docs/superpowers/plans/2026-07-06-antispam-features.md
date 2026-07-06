# 防護功能擴充實作計畫（持久化、CAS、入群洪水、可配置化、服務訊息刪除）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 telegram-antispam bot 加上 SQLite 持久化、CAS 已知 spammer 封鎖、入群洪水戒備模式、環境變數配置、未通過驗證者的入群服務訊息刪除。

**Architecture:** 新增 `config.ts`（環境變數集中）、`db.ts`（better-sqlite3）、兩個 service（cas、joinFlood）與一個 handler（serviceMessage）；`store/pending.ts` 改為 SQLite 持久化並內管超時 timer。入群流程順序：洪水檢查 → CAS → 驗證題。

**Tech Stack:** TypeScript 5（strict、ESM）、grammY 1.x、better-sqlite3、vitest。

**Spec:** `docs/superpowers/specs/2026-07-06-antispam-features-design.md`

## Global Constraints

- Node 20+，`"type": "module"`，import 路徑一律帶 `.js` 副檔名。
- TDD：每個 task 先寫失敗測試、確認失敗原因正確，再寫最小實作。測試指令 `npx vitest run <file>`。
- grammY `restrictChatMember` 簽名是 `(chatId, userId, permissions, other?)`——permissions 是第三參數本體，不是包在 `{permissions}` 裡。
- 註解與 log 用繁體中文，格式沿用現有 `[標籤] 說明` 風格。
- 測試中不可呼叫真實網路：涉及 `handleNewMember` 的測試一律 stub `fetch`。
- 每個 task 結束時 `npm test` 全綠、`npm run build` 乾淨，然後 commit（訊息結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）。
- 時間戳一律 epoch 毫秒（DB 的 `joined_at` 也是毫秒）。

---

### Task 1: config.ts 環境變數配置

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`
- Modify: `.env.example`（整檔覆寫，見 Step 5）

**Interfaces:**
- Produces: `loadConfig(env?): Config`、`config: Config`（singleton）。`Config` 欄位：`verifyTimeoutMs, floodWindowMs, floodMaxMessages, floodMuteSeconds, joinFloodWindowMs, joinFloodMaxJoins, joinFloodCooldownMs, casEnabled, casTimeoutMs, adminMuteSeconds, dbPath`。秒數類環境變數在載入時轉為毫秒欄位（`floodMuteSeconds`、`adminMuteSeconds` 例外，保持秒，因為 Telegram `until_date` 用秒）。

- [ ] **Step 1: 寫失敗測試**

```ts
// src/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('無環境變數時使用預設值', () => {
    const config = loadConfig({});
    expect(config.verifyTimeoutMs).toBe(180_000);
    expect(config.floodWindowMs).toBe(5_000);
    expect(config.floodMaxMessages).toBe(5);
    expect(config.floodMuteSeconds).toBe(300);
    expect(config.joinFloodWindowMs).toBe(60_000);
    expect(config.joinFloodMaxJoins).toBe(10);
    expect(config.joinFloodCooldownMs).toBe(300_000);
    expect(config.casEnabled).toBe(true);
    expect(config.casTimeoutMs).toBe(3000);
    expect(config.adminMuteSeconds).toBe(86_400);
    expect(config.dbPath).toBe('./data/antispam.db');
  });

  it('環境變數可覆寫預設值', () => {
    const config = loadConfig({
      VERIFY_TIMEOUT_SECONDS: '60',
      JOIN_FLOOD_MAX_JOINS: '20',
      CAS_ENABLED: 'false',
      DB_PATH: '/tmp/test.db',
    });
    expect(config.verifyTimeoutMs).toBe(60_000);
    expect(config.joinFloodMaxJoins).toBe(20);
    expect(config.casEnabled).toBe(false);
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('非法數值直接拋錯（fail-fast）', () => {
    expect(() => loadConfig({ VERIFY_TIMEOUT_SECONDS: 'abc' })).toThrow('VERIFY_TIMEOUT_SECONDS');
    expect(() => loadConfig({ FLOOD_MAX_MESSAGES: '-1' })).toThrow('FLOOD_MAX_MESSAGES');
    expect(() => loadConfig({ CAS_ENABLED: 'yes' })).toThrow('CAS_ENABLED');
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL，錯誤為找不到模組 `./config.js`。

- [ ] **Step 3: 最小實作**

```ts
// src/config.ts
export interface Config {
  verifyTimeoutMs: number;
  floodWindowMs: number;
  floodMaxMessages: number;
  floodMuteSeconds: number;
  joinFloodWindowMs: number;
  joinFloodMaxJoins: number;
  joinFloodCooldownMs: number;
  casEnabled: boolean;
  casTimeoutMs: number;
  adminMuteSeconds: number;
  dbPath: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`環境變數 ${name} 必須是正整數，收到：${raw}`);
  }
  return value;
}

function booleanFlag(env: Env, name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`環境變數 ${name} 必須是 true 或 false，收到：${raw}`);
}

export function loadConfig(env: Env = process.env): Config {
  return {
    verifyTimeoutMs: positiveInt(env, 'VERIFY_TIMEOUT_SECONDS', 180) * 1000,
    floodWindowMs: positiveInt(env, 'FLOOD_WINDOW_SECONDS', 5) * 1000,
    floodMaxMessages: positiveInt(env, 'FLOOD_MAX_MESSAGES', 5),
    floodMuteSeconds: positiveInt(env, 'FLOOD_MUTE_SECONDS', 300),
    joinFloodWindowMs: positiveInt(env, 'JOIN_FLOOD_WINDOW_SECONDS', 60) * 1000,
    joinFloodMaxJoins: positiveInt(env, 'JOIN_FLOOD_MAX_JOINS', 10),
    joinFloodCooldownMs: positiveInt(env, 'JOIN_FLOOD_COOLDOWN_SECONDS', 300) * 1000,
    casEnabled: booleanFlag(env, 'CAS_ENABLED', true),
    casTimeoutMs: positiveInt(env, 'CAS_TIMEOUT_MS', 3000),
    adminMuteSeconds: positiveInt(env, 'ADMIN_MUTE_SECONDS', 86_400),
    dbPath: env.DB_PATH || './data/antispam.db',
  };
}

export const config = loadConfig();
```

- [ ] **Step 4: 確認測試通過**

Run: `npx vitest run src/config.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 覆寫 `.env.example`**

```bash
# .env.example 整檔內容
BOT_TOKEN=your_bot_token_here

# 以下皆可省略，顯示值為預設值
# VERIFY_TIMEOUT_SECONDS=180        # 驗證時限（秒）
# FLOOD_WINDOW_SECONDS=5            # 訊息洪水視窗（秒）
# FLOOD_MAX_MESSAGES=5              # 視窗內訊息上限
# FLOOD_MUTE_SECONDS=300            # 訊息洪水禁言時長（秒）
# JOIN_FLOOD_WINDOW_SECONDS=60      # 入群洪水視窗（秒）
# JOIN_FLOOD_MAX_JOINS=10           # 視窗內加入數上限
# JOIN_FLOOD_COOLDOWN_SECONDS=300   # 戒備模式冷卻（秒）
# CAS_ENABLED=true                  # 是否啟用 CAS 檢查
# CAS_TIMEOUT_MS=3000               # CAS 查詢逾時（毫秒）
# ADMIN_MUTE_SECONDS=86400          # 管理員禁言按鈕時長（秒）
# DB_PATH=./data/antispam.db        # SQLite 資料庫路徑
```

- [ ] **Step 6: 全套測試 + 建置 + commit**

Run: `npm test && npm run build`
Expected: 全綠、無編譯錯誤。

```bash
git add src/config.ts src/config.test.ts .env.example
git commit -m "Add centralized env-based configuration"
```

---

### Task 2: db.ts 資料庫初始化

**Files:**
- Create: `src/db.ts`
- Test: `src/db.test.ts`
- Modify: `package.json`（新增依賴）

**Interfaces:**
- Produces: `openDb(path: string): DB`（`DB` 為 `Database.Database` 別名）。建立 `pending` 表、啟用 WAL；`:memory:` 以外的路徑會自動建立父目錄。

- [ ] **Step 1: 安裝依賴**

Run: `npm install better-sqlite3 && npm install -D @types/better-sqlite3`
Expected: 安裝成功（better-sqlite3 有 linux-x64 prebuilt，不需編譯）。

- [ ] **Step 2: 寫失敗測試**

```ts
// src/db.test.ts
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
```

- [ ] **Step 3: 確認測試失敗**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL，找不到模組 `./db.js`。

- [ ] **Step 4: 最小實作**

```ts
// src/db.ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
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
  return db;
}
```

- [ ] **Step 5: 確認測試通過**

Run: `npx vitest run src/db.test.ts`
Expected: 2 passed。

- [ ] **Step 6: 全套測試 + 建置 + commit**

Run: `npm test && npm run build`

```bash
git add src/db.ts src/db.test.ts package.json package-lock.json
git commit -m "Add SQLite database module with pending table"
```

---

### Task 3: store/pending.ts 改為 SQLite 持久化（含所有既有消費端遷移）

這是最大的一個 task：store API 全面改版，`newMember.ts`、`message.ts`、`callback.ts` 與其測試同步遷移。完成後軟體行為與改版前一致（新功能在後續 task）。

**Files:**
- Rewrite: `src/store/pending.ts`
- Create: `src/handlers/pendingActions.ts`
- Test: `src/store/pending.test.ts`（新）
- Modify: `src/handlers/newMember.ts`、`src/handlers/message.ts`、`src/handlers/callback.ts` 及對應 `.test.ts`

**Interfaces:**
- Consumes: Task 1 `config`、Task 2 `openDb/DB`。
- Produces:
  - `initPendingStore(db: DB): void` — 綁定 DB、清空 timer 註冊表（測試 beforeEach 用）。
  - `addPending(pending: PendingUser, timeoutMs: number, onTimeout: TimeoutHandler): void`
  - `getPending(chatId: number, userId: number): PendingUser | undefined`
  - `attachJoinMessage(chatId: number, userId: number, messageId: number): boolean`
  - `resolvePending(chatId: number, userId: number): void` — 刪列 + 清 timer。
  - `restorePending(timeoutMs: number, onTimeout: TimeoutHandler): number` — 回傳恢復筆數；過期者以 delay 0 排程走同一條 onTimeout 路徑。
  - `PendingUser { userId, chatId, correctAnswer, joinedAt, captchaMessageId, joinMessageId? }`、`TimeoutHandler = (p: PendingUser) => Promise<void> | void`
  - `pendingActions.ts`：`kickAndCleanup(api, pending)`（ban+unban+刪訊息）、`deletePendingMessages(api, pending)`（刪驗證訊息與已記錄的入群訊息，各自 try/catch）。

- [ ] **Step 1: 寫 store 失敗測試**

```ts
// src/store/pending.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDb } from '../db.js';
import {
  initPendingStore,
  addPending,
  getPending,
  attachJoinMessage,
  resolvePending,
  restorePending,
  PendingUser,
} from './pending.js';

function makePending(overrides: Partial<PendingUser> = {}): PendingUser {
  return {
    userId: 42,
    chatId: -100,
    correctAnswer: '2',
    joinedAt: Date.now(),
    captchaMessageId: 99,
    ...overrides,
  };
}

describe('pending store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('add 之後可以 get 回同樣內容', () => {
    addPending(makePending(), 180_000, () => {});
    const got = getPending(-100, 42);
    expect(got).toMatchObject({ userId: 42, chatId: -100, correctAnswer: '2', captchaMessageId: 99 });
    expect(got?.joinMessageId).toBeUndefined();
  });

  it('attachJoinMessage 補記服務訊息 id，無此列時回傳 false', () => {
    addPending(makePending(), 180_000, () => {});
    expect(attachJoinMessage(-100, 42, 123)).toBe(true);
    expect(getPending(-100, 42)?.joinMessageId).toBe(123);
    expect(attachJoinMessage(-100, 999, 123)).toBe(false);
  });

  it('超時觸發 onTimeout 並清除記錄', async () => {
    const onTimeout = vi.fn();
    addPending(makePending(), 180_000, onTimeout);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }));
    expect(getPending(-100, 42)).toBeUndefined();
  });

  it('resolve 之後超時不再觸發', async () => {
    const onTimeout = vi.fn();
    addPending(makePending(), 180_000, onTimeout);
    resolvePending(-100, 42);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('同用戶重複 add：舊 timer 作廢，只有新的 180 秒有效', async () => {
    const first = vi.fn();
    const second = vi.fn();
    addPending(makePending(), 180_000, first);
    await vi.advanceTimersByTimeAsync(100_000);
    addPending(makePending({ joinedAt: Date.now() }), 180_000, second);

    await vi.advanceTimersByTimeAsync(85_000); // 第一次的時限已過
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100_000); // 第二次時限到
    expect(second).toHaveBeenCalled();
  });

  it('restore：未過期者按剩餘時間重建 timer', async () => {
    const onTimeout = vi.fn();
    addPending(makePending({ joinedAt: Date.now() - 100_000 }), 180_000, () => {});
    // restorePending 會先清空 timer 註冊表再重建，等同重啟後的狀態
    const count = restorePending(180_000, onTimeout);
    expect(count).toBe(1);

    await vi.advanceTimersByTimeAsync(75_000);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); // 剩餘 80 秒到期
    expect(onTimeout).toHaveBeenCalled();
  });

  it('restore：已過期者立即（delay 0）觸發 onTimeout', async () => {
    const onTimeout = vi.fn();
    addPending(makePending({ joinedAt: Date.now() - 200_000 }), 180_000, () => {});
    restorePending(180_000, onTimeout);

    await vi.advanceTimersByTimeAsync(0);
    expect(onTimeout).toHaveBeenCalled();
    expect(getPending(-100, 42)).toBeUndefined();
  });
});
```

注意：`restorePending` 實作必須先清空 timer 註冊表再重建（見 Step 3 實作），restore 測試才不會出現 `addPending` 留下的雙 timer；因此 restore 測試中 `addPending` 的 onTimeout 一律用空函式。

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/store/pending.test.ts`
Expected: FAIL，`initPendingStore` 等匯出不存在。

- [ ] **Step 3: 重寫 store**

```ts
// src/store/pending.ts
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
```

- [ ] **Step 4: 確認 store 測試通過**

Run: `npx vitest run src/store/pending.test.ts`
Expected: 7 passed。

- [ ] **Step 5: 建立 pendingActions helper**

```ts
// src/handlers/pendingActions.ts
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
```

（此 helper 由後續 Step 的 handler 測試覆蓋，不另寫獨立測試。）

- [ ] **Step 6: 遷移 newMember.ts**

```ts
// src/handlers/newMember.ts
import { Context } from 'grammy';
import { addPending, PendingUser } from '../store/pending.js';
import { generateCaptcha } from '../services/captcha.js';
import { InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { kickAndCleanup } from './pendingActions.js';

export async function handleNewMember(ctx: Context) {
  const update = ctx.chatMember;
  if (!update) return;

  const { old_chat_member, new_chat_member, chat } = update;

  // 只處理真正的新加入：從群外（left/kicked）變成 member。
  // 排除降級（administrator → member）、解除禁言（restricted → member）等狀態轉變。
  if (new_chat_member.status !== 'member') return;
  if (old_chat_member.status !== 'left' && old_chat_member.status !== 'kicked') return;

  const user = new_chat_member.user;
  if (user.is_bot) return;

  const chatId = chat.id;
  const userId = user.id;

  // 限制新成員發言
  await ctx.api.restrictChatMember(chatId, userId, {
    can_send_messages: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
  });

  // 產生驗證題目
  const captcha = generateCaptcha();

  // 建立按鈕（選項垂直排列）
  const keyboard = new InlineKeyboard();
  captcha.options.forEach((option) => {
    keyboard.text(option, `verify:${userId}:${option}`).row();
  });

  // 管理員快捷按鈕（水平排列）
  keyboard
    .text('通過[✅]', `admin:${userId}:pass`)
    .text('封鎖[🚫]', `admin:${userId}:ban`)
    .text('禁言[🔇]', `admin:${userId}:mute`);

  const timeoutSeconds = config.verifyTimeoutMs / 1000;

  // 發送驗證訊息
  const message = await ctx.api.sendMessage(
    chatId,
    `🤖 入群驗證\n${user.first_name}，請在 ${timeoutSeconds} 秒內回答問題\nPlease answer within ${timeoutSeconds} seconds\n\n${captcha.question}`,
    { reply_markup: keyboard }
  );

  const pending: PendingUser = {
    userId,
    chatId,
    correctAnswer: captcha.correctAnswer,
    joinedAt: Date.now(),
    captchaMessageId: message.message_id,
  };

  console.log(`[新成員] ${user.first_name} (${userId}) 加入群組 ${chatId}，等待驗證`);

  addPending(pending, config.verifyTimeoutMs, async (p) => {
    console.log(`[超時] 用戶 ${p.userId} 驗證超時，已踢出群組 ${p.chatId}`);
    await kickAndCleanup(ctx.api, p);
  });
}
```

- [ ] **Step 7: 遷移 newMember.test.ts**

```ts
// src/handlers/newMember.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleNewMember } from './newMember.js';
import { initPendingStore, getPending } from '../store/pending.js';
import { openDb } from '../db.js';

const chatId = -100123;
const user = { id: 42, is_bot: false, first_name: 'New' };

function makeCtx(oldStatus: string, newStatus: string) {
  return {
    chatMember: {
      chat: { id: chatId, type: 'supergroup' },
      old_chat_member: { status: oldStatus, user },
      new_chat_member: { status: newStatus, user },
    },
    api: {
      restrictChatMember: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 99 }),
      banChatMember: vi.fn().mockResolvedValue(true),
      unbanChatMember: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as any;
}

describe('handleNewMember', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
    // 避免 CAS 檢查打到真實網路（Task 7 之前 handler 尚未接 CAS，先備妥 stub 也無害）
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('新成員（left → member）觸發驗證', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalled();
    expect(ctx.api.sendMessage).toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeDefined();
  });

  it('管理員被降級（administrator → member）不觸發驗證', async () => {
    const ctx = makeCtx('administrator', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('解除禁言（restricted → member）不觸發驗證', async () => {
    const ctx = makeCtx('restricted', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('驗證超時會踢出用戶並刪除驗證訊息', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 99);
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('超時前重新入群，第一次的超時 timer 不會誤踢第二次驗證', async () => {
    const ctx1 = makeCtx('left', 'member');
    await handleNewMember(ctx1);

    await vi.advanceTimersByTimeAsync(100_000);
    const ctx2 = makeCtx('kicked', 'member');
    await handleNewMember(ctx2);

    await vi.advanceTimersByTimeAsync(85_000); // 第一次的 180 秒已過
    expect(ctx1.api.banChatMember).not.toHaveBeenCalled();
    expect(ctx2.api.banChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(100_000); // 第二次的 180 秒到期
    expect(ctx2.api.banChatMember).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: 遷移 message.ts 與其測試**

`src/handlers/message.ts` 的變更：`pendingUsers.has(key)` → `getPending(chatId, userId)`；閾值改讀 config。

```ts
// src/handlers/message.ts
import { Context, NextFunction } from 'grammy';
import { getPending } from '../store/pending.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { containsLink } from '../services/linkFilter.js';
import { config } from '../config.js';

export async function handleMessage(ctx: Context, next: NextFunction) {
  const chat = ctx.chat;
  const userId = ctx.from?.id;

  // 只處理群組訊息
  if (!chat || !userId || (chat.type !== 'group' && chat.type !== 'supergroup')) {
    return next();
  }

  const chatId = chat.id;
  const text = ctx.message?.text || ctx.message?.caption || '';

  // 1. 驗證中的新成員禁止發連結
  if (getPending(chatId, userId) && containsLink(text)) {
    await ctx.deleteMessage();
    console.log(`[連結過濾] 刪除驗證中用戶 ${userId} 的訊息（含連結）`);
    return;
  }

  // 2. 洪水偵測（管理員豁免）
  const isFlooding = checkRateLimit(chatId, userId);
  if (isFlooding) {
    const member = await ctx.api.getChatMember(chatId, userId);
    if (member.status === 'administrator' || member.status === 'creator') {
      return next();
    }

    const until = Math.floor(Date.now() / 1000) + config.floodMuteSeconds;
    await ctx.api.restrictChatMember(
      chatId,
      userId,
      { can_send_messages: false },
      { until_date: until }
    );
    await ctx.reply(`${ctx.from?.first_name} 發送訊息過於頻繁，已禁言 ${config.floodMuteSeconds / 60} 分鐘。`);
    console.log(`[洪水偵測] 用戶 ${userId} 發送過於頻繁，禁言 ${config.floodMuteSeconds / 60} 分鐘`);
    return;
  }

  return next();
}
```

`src/services/rateLimit.ts` 改讀 config（保留既有演算法）：

```ts
// src/services/rateLimit.ts
import { config } from '../config.js';

// 訊息記錄：chatId:userId -> 時間戳陣列
const messageTimestamps: Map<string, number[]> = new Map();

export function checkRateLimit(chatId: number, userId: number): boolean {
  const key = `${chatId}:${userId}`;
  const now = Date.now();

  let timestamps = messageTimestamps.get(key) || [];

  // 移除過期的時間戳
  timestamps = timestamps.filter((ts) => now - ts < config.floodWindowMs);

  // 加入新的時間戳
  timestamps.push(now);
  messageTimestamps.set(key, timestamps);

  // 檢查是否超過限制
  return timestamps.length > config.floodMaxMessages;
}
```

`src/handlers/message.test.ts`：`beforeEach` 改為 init store 並用 `addPending` 建立驗證中用戶（取代直接操作 Map）：

```ts
// src/handlers/message.test.ts（僅列出與現版的差異部分——beforeEach 與「驗證中的新成員」測試）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from './message.js';
import { initPendingStore, addPending } from '../store/pending.js';
import { openDb } from '../db.js';

// makeCtx 與其餘測試維持現狀（略——保留原檔內容）

let nextChatId = 1000;

describe('handleMessage', () => {
  let chatId: number;
  const userId = 42;

  beforeEach(() => {
    chatId = nextChatId++;
    initPendingStore(openDb(':memory:'));
  });

  it('驗證中的新成員發連結會被刪除', async () => {
    addPending(
      { userId, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 1 },
      180_000,
      () => {}
    );
    const ctx = makeCtx({ chatId, userId, text: '快來 https://spam.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // 其餘四個測試（私聊放行、老成員連結不受影響、一般成員洪水禁言、管理員洪水豁免）內容不變
});
```

注意：`initPendingStore` 會清 timer，`addPending` 的 180 秒 timer 在下個測試的 beforeEach 被清掉，不會洩漏。

- [ ] **Step 9: 遷移 callback.ts 與其測試**

```ts
// src/handlers/callback.ts
import { Context } from 'grammy';
import { getPending, resolvePending, PendingUser } from '../store/pending.js';
import { config } from '../config.js';
import { kickAndCleanup, deletePendingMessages } from './pendingActions.js';

export async function handleCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const chatId = ctx.chat?.id;
  const callerId = ctx.from?.id;

  if (!chatId || !callerId) return;

  // 管理員快捷按鈕
  if (data.startsWith('admin:')) {
    await handleAdminAction(ctx, data, chatId, callerId);
    return;
  }

  // 用戶驗證按鈕
  if (data.startsWith('verify:')) {
    await handleVerifyAction(ctx, data, chatId, callerId);
    return;
  }
}

// 以群組預設權限恢復發言，避免給新成員比群組設定更寬的權限
async function liftRestrictions(ctx: Context, chatId: number, userId: number) {
  const chat = await ctx.api.getChat(chatId);
  const permissions = chat.permissions ?? {
    can_send_messages: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
  };
  await ctx.api.restrictChatMember(chatId, userId, permissions);
}

async function handleAdminAction(
  ctx: Context,
  data: string,
  chatId: number,
  callerId: number
) {
  // 檢查是否為管理員
  const member = await ctx.api.getChatMember(chatId, callerId);
  const isAdmin = ['administrator', 'creator'].includes(member.status);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '只有管理員可以操作', show_alert: true });
    return;
  }

  const [, targetId, action] = data.split(':');
  const userId = Number(targetId);
  const pending = getPending(chatId, userId);
  resolvePending(chatId, userId);

  switch (action) {
    case 'pass':
      // 直接通過驗證：保留入群訊息，只刪驗證訊息
      await liftRestrictions(ctx, chatId, userId);
      await ctx.answerCallbackQuery({ text: '已通過驗證' });
      if (pending) {
        try {
          await ctx.api.deleteMessage(chatId, pending.captchaMessageId);
        } catch {
          // 訊息可能已不存在，忽略
        }
      }
      console.log(`[管理員] 管理員 ${callerId} 手動通過用戶 ${userId} 的驗證`);
      break;

    case 'ban':
      // 封鎖用戶：屬未通過驗證，連入群訊息一併刪除
      await ctx.api.banChatMember(chatId, userId);
      await ctx.answerCallbackQuery({ text: '已封鎖用戶' });
      if (pending) {
        await deletePendingMessages(ctx.api, pending);
      }
      console.log(`[管理員] 管理員 ${callerId} 封鎖用戶 ${userId}`);
      break;

    case 'mute': {
      // 禁言：屬未通過驗證，連入群訊息一併刪除
      const until = Math.floor(Date.now() / 1000) + config.adminMuteSeconds;
      await ctx.api.restrictChatMember(
        chatId,
        userId,
        { can_send_messages: false },
        { until_date: until }
      );
      await ctx.answerCallbackQuery({ text: `已禁言 ${config.adminMuteSeconds / 3600} 小時` });
      if (pending) {
        await deletePendingMessages(ctx.api, pending);
      }
      console.log(`[管理員] 管理員 ${callerId} 禁言用戶 ${userId} ${config.adminMuteSeconds / 3600} 小時`);
      break;
    }
  }
}

async function handleVerifyAction(
  ctx: Context,
  data: string,
  chatId: number,
  callerId: number
) {
  const [, targetId, answer] = data.split(':');
  const userId = Number(targetId);

  // 只有本人可以回答
  if (callerId !== userId) {
    await ctx.answerCallbackQuery({ text: '這不是你的驗證問題！', show_alert: true });
    return;
  }

  const pending = getPending(chatId, userId);

  if (!pending) {
    await ctx.answerCallbackQuery({ text: '驗證已過期', show_alert: true });
    return;
  }

  resolvePending(chatId, userId);

  if (answer === pending.correctAnswer) {
    // 驗證成功：保留入群訊息，只刪驗證訊息
    await liftRestrictions(ctx, chatId, callerId);
    await ctx.answerCallbackQuery({ text: '驗證成功！' });
    try {
      await ctx.api.deleteMessage(chatId, pending.captchaMessageId);
    } catch {
      // 訊息可能已不存在，忽略
    }
    console.log(`[驗證成功] 用戶 ${userId} 通過驗證`);
  } else {
    // 驗證失敗：踢出並清理驗證訊息與入群訊息
    await ctx.answerCallbackQuery({ text: '答案錯誤，請重新加入群組', show_alert: true });
    await kickAndCleanup(ctx.api, pending);
    console.log(`[驗證失敗] 用戶 ${userId} 答錯，已踢出`);
  }
}
```

`src/handlers/callback.test.ts`：`setPending` 改用 `addPending`，並新增「答錯連入群訊息一併刪除」測試：

```ts
// src/handlers/callback.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCallback } from './callback.js';
import { initPendingStore, addPending, getPending, attachJoinMessage } from '../store/pending.js';
import { openDb } from '../db.js';

const chatId = -100456;
const userId = 42;
const adminId = 7;

const chatPermissions = {
  can_send_messages: true,
  can_send_other_messages: true,
  can_add_web_page_previews: false,
};

function makeCtx(data: string, callerId: number, callerStatus = 'member') {
  return {
    callbackQuery: { data },
    chat: { id: chatId, type: 'supergroup' },
    from: { id: callerId },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    api: {
      getChatMember: vi.fn().mockResolvedValue({ status: callerStatus }),
      getChat: vi.fn().mockResolvedValue({ id: chatId, permissions: chatPermissions }),
      restrictChatMember: vi.fn().mockResolvedValue(true),
      banChatMember: vi.fn().mockResolvedValue(true),
      unbanChatMember: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as any;
}

function setPending() {
  addPending(
    { userId, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 99 },
    180_000,
    () => {}
  );
}

describe('handleCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
    setPending();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('答對後以群組預設權限恢復發言', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(chatId, userId, chatPermissions);
    expect(getPending(chatId, userId)).toBeUndefined();
  });

  it('答對後清除超時 timer', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('答錯會被踢出，驗證訊息與入群訊息一併刪除', async () => {
    attachJoinMessage(chatId, userId, 123);
    const ctx = makeCtx(`verify:${userId}:3`, userId);

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 99);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 123);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('非本人點驗證按鈕會被拒絕', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, 999);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, userId)).toBeDefined();
  });

  it('管理員手動通過時以群組預設權限恢復發言並清除 timer', async () => {
    const ctx = makeCtx(`admin:${userId}:pass`, adminId, 'administrator');

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(chatId, userId, chatPermissions);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('管理員封鎖時入群訊息一併刪除', async () => {
    attachJoinMessage(chatId, userId, 123);
    const ctx = makeCtx(`admin:${userId}:ban`, adminId, 'administrator');

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 123);
  });

  it('非管理員點管理員按鈕會被拒絕', async () => {
    const ctx = makeCtx(`admin:${userId}:ban`, 999, 'member');

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, userId)).toBeDefined();
  });
});
```

- [ ] **Step 10: 暫時修補 index.ts 使建置通過**

`index.ts` 目前沒有初始化 store，會在執行期壞掉；完整接線在 Task 8，此處先加最小初始化讓行為正確：

```ts
// src/index.ts 中，const bot = new Bot(token); 之後加入：
import { openDb } from './db.js';           // （檔頭）
import { config } from './config.js';       // （檔頭）
import { initPendingStore } from './store/pending.js'; // （檔頭）

initPendingStore(openDb(config.dbPath));
```

- [ ] **Step 11: 全套測試 + 建置 + commit**

Run: `npm test && npm run build`
Expected: 全綠（config 3、db 2、pending 7、linkFilter 4、captcha 1、message 5、newMember 5、callback 7）、建置乾淨。

```bash
git add -A src/ package.json package-lock.json
git commit -m "Persist pending verifications in SQLite with restorable timers"
```

---

### Task 4: services/cas.ts CAS 查詢

**Files:**
- Create: `src/services/cas.ts`
- Test: `src/services/cas.test.ts`

**Interfaces:**
- Consumes: Task 1 `config`。
- Produces: `isCasBanned(userId: number, opts?: { enabled: boolean; timeoutMs: number }): Promise<boolean>`。opts 預設取自 config；查詢失敗/逾時/非 2xx 一律回 false（fail-open）。

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/cas.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCasBanned } from './cas.js';

const opts = { enabled: true, timeoutMs: 3000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCasBanned', () => {
  it('CAS 回傳 ok=true 視為命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { offenses: 3 } }),
    }));
    expect(await isCasBanned(42, opts)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cas.chat/check?user_id=42',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('CAS 回傳 ok=false 視為未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Record not found.' }),
    }));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('查詢失敗時 fail-open 回傳未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('HTTP 非 2xx 視為未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('停用時不發出查詢', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await isCasBanned(42, { enabled: false, timeoutMs: 3000 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/services/cas.test.ts`
Expected: FAIL，找不到模組 `./cas.js`。

- [ ] **Step 3: 最小實作**

```ts
// src/services/cas.ts
import { config } from '../config.js';

export interface CasOptions {
  enabled: boolean;
  timeoutMs: number;
}

// 查詢 CAS（Combot Anti-Spam）名單；查詢失敗一律視為未命中（fail-open），
// 避免 CAS 服務異常時擋住正常人入群
export async function isCasBanned(
  userId: number,
  opts: CasOptions = { enabled: config.casEnabled, timeoutMs: config.casTimeoutMs }
): Promise<boolean> {
  if (!opts.enabled) return false;

  try {
    const res = await fetch(`https://api.cas.chat/check?user_id=${userId}`, {
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch (e) {
    console.log(`[CAS] 查詢失敗，視為未命中：${e}`);
    return false;
  }
}
```

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/services/cas.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 全套測試 + 建置 + commit**

```bash
npm test && npm run build
git add src/services/cas.ts src/services/cas.test.ts
git commit -m "Add CAS ban list lookup with fail-open semantics"
```

---

### Task 5: services/joinFlood.ts 與 store/recentlyRemoved.ts

**Files:**
- Create: `src/services/joinFlood.ts`、`src/store/recentlyRemoved.ts`
- Test: `src/services/joinFlood.test.ts`、`src/store/recentlyRemoved.test.ts`

**Interfaces:**
- Consumes: Task 1 `config`。
- Produces:
  - `recordJoin(chatId: number, opts?: { windowMs; maxJoins; cooldownMs }): { inAlert: boolean; justEntered: boolean }` — 每次入群呼叫一次；`inAlert` 表示本次加入要被踢，`justEntered` 表示剛觸發戒備（要發通知）。
  - `markRemoved(chatId: number, userId: number): void`、`consumeRecentlyRemoved(chatId: number, userId: number): boolean`（讀取即消費，TTL 60 秒）。

- [ ] **Step 1: 寫失敗測試**

```ts
// src/services/joinFlood.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordJoin } from './joinFlood.js';

const opts = { windowMs: 60_000, maxJoins: 10, cooldownMs: 300_000 };

// 每個測試用不同 chatId 避免模組狀態互相干擾
let nextChatId = 1;

describe('recordJoin', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('視窗內加入數未超標時不進入戒備', () => {
    for (let i = 0; i < 10; i++) {
      const result = recordJoin(chatId, opts);
      expect(result.inAlert).toBe(false);
    }
  });

  it('視窗內超標的那一次加入觸發戒備，justEntered 只在第一次為 true', () => {
    for (let i = 0; i < 10; i++) recordJoin(chatId, opts);

    const eleventh = recordJoin(chatId, opts);
    expect(eleventh).toEqual({ inAlert: true, justEntered: true });

    const twelfth = recordJoin(chatId, opts);
    expect(twelfth).toEqual({ inAlert: true, justEntered: false });
  });

  it('舊的加入記錄滑出視窗後不觸發戒備', () => {
    for (let i = 0; i < 10; i++) recordJoin(chatId, opts);
    vi.advanceTimersByTime(61_000); // 全部滑出視窗

    const result = recordJoin(chatId, opts);
    expect(result.inAlert).toBe(false);
  });

  it('最後一次觸發後經過冷卻時間自動解除戒備', () => {
    for (let i = 0; i < 11; i++) recordJoin(chatId, opts); // 第 11 次觸發戒備

    vi.advanceTimersByTime(301_000); // 超過冷卻
    const result = recordJoin(chatId, opts);
    expect(result.inAlert).toBe(false);
  });

  it('不同群組的狀態互不影響', () => {
    for (let i = 0; i < 11; i++) recordJoin(chatId, opts);
    const other = recordJoin(chatId + 100_000, opts);
    expect(other.inAlert).toBe(false);
  });
});
```

```ts
// src/store/recentlyRemoved.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { markRemoved, consumeRecentlyRemoved } from './recentlyRemoved.js';

let nextChatId = 1;

describe('recentlyRemoved', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('標記後可查到一次，讀取即消費', () => {
    markRemoved(chatId, 42);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(true);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(false);
  });

  it('未標記者查不到', () => {
    expect(consumeRecentlyRemoved(chatId, 999)).toBe(false);
  });

  it('超過 TTL 後失效', () => {
    markRemoved(chatId, 42);
    vi.advanceTimersByTime(61_000);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(false);
  });
});
```

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/services/joinFlood.test.ts src/store/recentlyRemoved.test.ts`
Expected: FAIL，模組不存在。

- [ ] **Step 3: 最小實作**

```ts
// src/services/joinFlood.ts
import { config } from '../config.js';

export interface JoinFloodOptions {
  windowMs: number;
  maxJoins: number;
  cooldownMs: number;
}

export interface JoinFloodResult {
  inAlert: boolean;     // 本次加入落在戒備模式，應踢出
  justEntered: boolean; // 剛觸發戒備，應發通知
}

interface ChatState {
  joins: number[];    // 加入時間戳（epoch 毫秒）
  alertUntil: number; // 戒備截止時間，0 表示未戒備
}

const states = new Map<number, ChatState>();

export function recordJoin(
  chatId: number,
  opts: JoinFloodOptions = {
    windowMs: config.joinFloodWindowMs,
    maxJoins: config.joinFloodMaxJoins,
    cooldownMs: config.joinFloodCooldownMs,
  }
): JoinFloodResult {
  const now = Date.now();
  const state = states.get(chatId) ?? { joins: [], alertUntil: 0 };

  state.joins = state.joins.filter((ts) => now - ts < opts.windowMs);
  state.joins.push(now);

  const wasAlert = now < state.alertUntil;
  if (state.joins.length > opts.maxJoins) {
    // 每次觸發都刷新冷卻：持續湧入時戒備不會中途解除
    state.alertUntil = now + opts.cooldownMs;
  }
  const inAlert = now < state.alertUntil;

  states.set(chatId, state);
  return { inAlert, justEntered: inAlert && !wasAlert };
}
```

```ts
// src/store/recentlyRemoved.ts
const TTL_MS = 60_000;

// 剛被 bot 移除（CAS 封鎖、戒備踢出）的用戶，其入群服務訊息稍後抵達時要刪除。
// key: chatId:userId -> 有效期限（epoch 毫秒）
const removed = new Map<string, number>();

export function markRemoved(chatId: number, userId: number) {
  // 順手清掉過期項目，避免服務訊息始終未到時累積
  const now = Date.now();
  for (const [key, expiry] of removed) {
    if (now > expiry) removed.delete(key);
  }
  removed.set(`${chatId}:${userId}`, now + TTL_MS);
}

// 讀取即消費：服務訊息只會抵達一次
export function consumeRecentlyRemoved(chatId: number, userId: number): boolean {
  const key = `${chatId}:${userId}`;
  const expiry = removed.get(key);
  if (expiry === undefined) return false;
  removed.delete(key);
  return Date.now() <= expiry;
}
```

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/services/joinFlood.test.ts src/store/recentlyRemoved.test.ts`
Expected: 8 passed。

- [ ] **Step 5: 全套測試 + 建置 + commit**

```bash
npm test && npm run build
git add src/services/joinFlood.ts src/services/joinFlood.test.ts src/store/recentlyRemoved.ts src/store/recentlyRemoved.test.ts
git commit -m "Add join flood detection and recently-removed tracking"
```

---

### Task 6: newMember.ts 整合洪水檢查與 CAS

**Files:**
- Modify: `src/handlers/newMember.ts`
- Test: `src/handlers/newMember.test.ts`（新增測試）

**Interfaces:**
- Consumes: Task 4 `isCasBanned`、Task 5 `recordJoin`/`markRemoved`。
- Produces: 入群流程順序固定為 洪水 → CAS → 驗證題（後續 task 依賴此順序）。

- [ ] **Step 1: 新增失敗測試**

在 `src/handlers/newMember.test.ts` 的 describe 內新增（既有 import 之外加 `import { recordJoin } from '../services/joinFlood.js';`；注意既有測試每個 describe 共用 `chatId = -100123`，戒備測試要用獨立 chatId 避免污染其他測試）：

```ts
  it('CAS 命中者直接永久封鎖，不出驗證題', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.unbanChatMember).not.toHaveBeenCalled(); // 永久封鎖
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('戒備模式中新加入者被踢出（可重新加入），剛觸發時發通知', async () => {
    const alertChatId = -100999;
    const floodOpts = { windowMs: 60_000, maxJoins: 10, cooldownMs: 300_000 };
    // 先灌 10 次讓下一次入群觸發戒備
    for (let i = 0; i < 10; i++) recordJoin(alertChatId, floodOpts);

    const makeAlertCtx = () => {
      const ctx = makeCtx('left', 'member');
      ctx.chatMember.chat.id = alertChatId;
      return ctx;
    };

    const first = makeAlertCtx();
    await handleNewMember(first);
    expect(first.api.banChatMember).toHaveBeenCalledWith(alertChatId, user.id);
    expect(first.api.unbanChatMember).toHaveBeenCalledWith(alertChatId, user.id);
    expect(first.api.sendMessage).toHaveBeenCalledTimes(1); // 戒備通知
    expect(getPending(alertChatId, user.id)).toBeUndefined();

    const second = makeAlertCtx();
    await handleNewMember(second);
    expect(second.api.banChatMember).toHaveBeenCalled();
    expect(second.api.sendMessage).not.toHaveBeenCalled(); // 通知只發一次
  });
```

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/handlers/newMember.test.ts`
Expected: 新增的 2 個測試 FAIL（目前 handler 未接洪水與 CAS），既有 5 個 PASS。

- [ ] **Step 3: 修改 handler**

在 `src/handlers/newMember.ts` 檔頭加入：

```ts
import { isCasBanned } from '../services/cas.js';
import { recordJoin } from '../services/joinFlood.js';
import { markRemoved } from '../store/recentlyRemoved.js';
```

在 `if (user.is_bot) return;` 與「限制新成員發言」之間插入：

```ts
  const chatId = chat.id;
  const userId = user.id;

  // 1. 入群洪水檢查：戒備模式中直接踢出（可重新加入）
  const flood = recordJoin(chatId);
  if (flood.inAlert) {
    markRemoved(chatId, userId);
    await ctx.api.banChatMember(chatId, userId);
    await ctx.api.unbanChatMember(chatId, userId); // 允許稍後重新加入
    console.log(`[入群洪水] 戒備模式中踢出用戶 ${userId}（群組 ${chatId}）`);
    if (flood.justEntered) {
      try {
        await ctx.api.sendMessage(
          chatId,
          '⚠️ 偵測到大量帳號短時間湧入，已進入戒備模式：期間新加入的成員將被暫時移除，稍後可重新加入。'
        );
      } catch {
        // 通知失敗不影響防護
      }
    }
    return;
  }

  // 2. CAS 檢查：已知 spammer 直接永久封鎖
  if (await isCasBanned(userId)) {
    markRemoved(chatId, userId);
    await ctx.api.banChatMember(chatId, userId);
    console.log(`[CAS] 用戶 ${userId} 在 CAS 名單上，已永久封鎖（群組 ${chatId}）`);
    return;
  }
```

（原本函式內已有的 `const chatId = chat.id; const userId = user.id;` 兩行移除，避免重複宣告。）

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/handlers/newMember.test.ts`
Expected: 7 passed。

- [ ] **Step 5: 全套測試 + 建置 + commit**

```bash
npm test && npm run build
git add src/handlers/newMember.ts src/handlers/newMember.test.ts
git commit -m "Gate new members through join-flood and CAS checks"
```

---

### Task 7: serviceMessage.ts 入群服務訊息處理

**Files:**
- Create: `src/handlers/serviceMessage.ts`
- Modify: `src/handlers/index.ts`
- Test: `src/handlers/serviceMessage.test.ts`

**Interfaces:**
- Consumes: Task 3 `attachJoinMessage`、Task 5 `consumeRecentlyRemoved`。
- Produces: `handleServiceMessage(ctx: Context): Promise<void>`，註冊於 `message:new_chat_members`。

- [ ] **Step 1: 寫失敗測試**

```ts
// src/handlers/serviceMessage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleServiceMessage } from './serviceMessage.js';
import { initPendingStore, addPending, getPending } from '../store/pending.js';
import { markRemoved } from '../store/recentlyRemoved.js';
import { openDb } from '../db.js';

let nextChatId = 5000;

function makeCtx(chatId: number, members: Array<{ id: number; is_bot: boolean }>) {
  return {
    chat: { id: chatId, type: 'supergroup' },
    message: { message_id: 777, new_chat_members: members },
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as any;
}

describe('handleServiceMessage', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    initPendingStore(openDb(':memory:'));
  });

  it('驗證中用戶的入群訊息被記錄到 pending', async () => {
    addPending(
      { userId: 42, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 99 },
      180_000,
      () => {}
    );
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(getPending(chatId, 42)?.joinMessageId).toBe(777);
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it('剛被移除用戶的入群訊息立即刪除', async () => {
    markRemoved(chatId, 42);
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 777);
  });

  it('與 bot 無關的入群訊息不處理', async () => {
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/handlers/serviceMessage.test.ts`
Expected: FAIL，模組不存在。

- [ ] **Step 3: 實作 handler 並註冊**

```ts
// src/handlers/serviceMessage.ts
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

  for (const member of members) {
    if (member.is_bot) continue;

    if (consumeRecentlyRemoved(chatId, member.id)) {
      try {
        await ctx.api.deleteMessage(chatId, message.message_id);
      } catch {
        // 訊息可能已不存在，忽略
      }
      return; // 整則訊息已刪，不需再處理其他成員
    }

    attachJoinMessage(chatId, member.id, message.message_id);
  }
}
```

`src/handlers/index.ts` 全檔改為：

```ts
import { Bot } from 'grammy';
import { handleNewMember } from './newMember.js';
import { handleMessage } from './message.js';
import { handleCallback } from './callback.js';
import { handleServiceMessage } from './serviceMessage.js';

export function setupHandlers(bot: Bot) {
  // 新成員加入
  bot.on('chat_member', handleNewMember);

  // 驗證按鈕回調
  bot.on('callback_query:data', handleCallback);

  // 入群服務訊息（需在一般訊息檢查之前註冊）
  bot.on('message:new_chat_members', handleServiceMessage);

  // 訊息檢查（連結過濾、洪水偵測）
  bot.on('message', handleMessage);
}
```

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/handlers/serviceMessage.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 全套測試 + 建置 + commit**

```bash
npm test && npm run build
git add src/handlers/serviceMessage.ts src/handlers/serviceMessage.test.ts src/handlers/index.ts
git commit -m "Capture and clean up join service messages"
```

---

### Task 8: index.ts 接線、啟動恢復、README

**Files:**
- Modify: `src/index.ts`、`README.md`

**Interfaces:**
- Consumes: Task 3 `restorePending`/`kickAndCleanup`、Task 1 `config`。

- [ ] **Step 1: 改寫 index.ts**

```ts
// src/index.ts
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
```

- [ ] **Step 2: 更新 README.md**

「功能」一節改為：

```markdown
## 功能

- **新成員驗證**：加入後需回答問題，限時內（預設 180 秒）答對才能發言
- **CAS 整合**：入群時查詢 [CAS](https://cas.chat) 名單，已知 spammer 直接永久封鎖
- **入群洪水防護**：短時間大量帳號湧入時進入戒備模式，期間新加入者暫時移除，冷卻後自動解除
- **新成員禁止發連結**：驗證通過前禁止發送 URL
- **洪水偵測**：預設 5 秒內超過 5 則訊息自動禁言 5 分鐘（管理員豁免）
- **狀態持久化**：進行中的驗證存於 SQLite，重啟後自動恢復
- **服務訊息清理**：未通過驗證者的「加入群組」訊息自動刪除
```

「設定」一節補充：

```markdown
所有閾值都可用環境變數調整（見 `.env.example`），不設定則使用預設值。
```

「專案結構」一節改為：

```markdown
```
src/
├── index.ts               # 入口
├── config.ts              # 環境變數配置
├── db.ts                  # SQLite 初始化
├── handlers/
│   ├── index.ts           # Handler 設定
│   ├── newMember.ts       # 新成員：洪水檢查 → CAS → 驗證
│   ├── serviceMessage.ts  # 入群服務訊息處理
│   ├── message.ts         # 訊息檢查
│   ├── callback.ts        # 按鈕回調
│   └── pendingActions.ts  # 踢出與訊息清理
├── services/
│   ├── captcha.ts         # 驗證題目產生
│   ├── cas.ts             # CAS 查詢
│   ├── joinFlood.ts       # 入群洪水偵測
│   ├── rateLimit.ts       # 訊息洪水偵測
│   └── linkFilter.ts      # 連結過濾
└── store/
    ├── pending.ts         # 待驗證用戶（SQLite）
    └── recentlyRemoved.ts # 剛被移除用戶（記憶體）
```
```

- [ ] **Step 3: 全套測試 + 建置 + 啟動 smoke test**

Run: `npm test && npm run build`
Expected: 全綠、建置乾淨。

Run: `node -e "import('./dist/index.js').catch(e => console.log('OK:', e.message))"`
Expected: 輸出 `OK: BOT_TOKEN environment variable is required`（config 與 db 模組載入正常，只缺 token）。
另確認執行後產生 `data/antispam.db` 則刪除之（smoke test 副產物）：`rm -rf data/`。
注意：`.gitignore` 需加入 `data/`（本 step 一併修改）。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts README.md .gitignore
git commit -m "Wire persistence, restore pending verifications on startup"
```

---

## 驗收清單（全部 task 完成後）

- [ ] `npm test` 全綠（預估約 52 個測試）
- [ ] `npm run build` 乾淨
- [ ] `git log` 每個 task 一個 commit
- [ ] 用真實 token 在測試群驗證：入群出題、答對解禁、答錯踢出、重啟後 pending 恢復
