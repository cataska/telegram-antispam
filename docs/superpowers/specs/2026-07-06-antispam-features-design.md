# 防護功能擴充設計：持久化、CAS、入群洪水、可配置化、服務訊息刪除

日期：2026-07-06
狀態：已核可

## 背景

telegram-antispam 是以 grammY 撰寫的群組防 spam bot，現有功能：入群驗證題、驗證中禁發連結、訊息洪水禁言。本設計新增五項功能：

1. 狀態持久化（SQLite）
2. CAS（Combot Anti-Spam）整合
3. 入群洪水防護（戒備模式）
4. 閾值可配置化（環境變數）
5. 未通過驗證者的入群服務訊息刪除

## 已確認的需求決策

| 決策點 | 結論 |
|---|---|
| 儲存後端 | SQLite（better-sqlite3），單機部署 |
| 入群洪水回應 | 戒備模式：洪水期間新加入者踢出（可重加入）、群內通知一次、冷卻後自動解除 |
| 設定方式 | 純環境變數 + 預設值，改設定需重啟 |
| CAS 命中處理 | 直接永久封鎖，解封由管理員手動 |
| 服務訊息刪除範圍 | 只刪未通過驗證者（答錯、超時、CAS 封鎖、戒備踢出）的入群訊息 |
| 重啟時的 pending | 恢復驗證流程：按剩餘時間重建 timer，已過期者踢出 |

## 架構

```
src/
├── index.ts              # 入口：載入 config、初始化 db、啟動時恢復 pending
├── config.ts             # [新] 所有閾值集中，從環境變數讀取、附預設值、啟動時驗證
├── db.ts                 # [新] better-sqlite3 初始化與 schema
├── handlers/
│   ├── newMember.ts      # [改] 入群流程：戒備模式檢查 → CAS 檢查 → 驗證題
│   ├── serviceMessage.ts # [新] 捕捉「加入群組」服務訊息，記錄或即刪
│   ├── message.ts        # [改] 閾值改讀 config
│   └── callback.ts       # [改] 失敗路徑順帶刪除入群服務訊息
├── services/
│   ├── cas.ts            # [新] CAS 查詢（fail-open）
│   ├── joinFlood.ts      # [新] 入群洪水偵測與戒備模式狀態（記憶體）
│   ├── captcha.ts        # 不變
│   ├── rateLimit.ts      # [改] 閾值改讀 config
│   └── linkFilter.ts     # 不變
└── store/
    └── pending.ts        # [改] SQLite 持久化 + 記憶體 timer 註冊表
```

新增依賴：`better-sqlite3`、`@types/better-sqlite3`（dev）。

## 入群流程

新成員（`old_chat_member.status ∈ {left, kicked}` 且 `new_chat_member.status = member`）觸發時依序執行：

1. **入群洪水檢查**（`services/joinFlood.ts`）
   - 每群一個滑動視窗記錄加入時間戳（記憶體）。
   - 視窗內加入數超過 `JOIN_FLOOD_MAX_JOINS` → 進入戒備模式。
   - 戒備模式中：新加入者直接踢出（ban + unban），加入「剛被移除」名單以刪其入群訊息，流程結束。
   - 剛進入戒備時在群內發一則通知（同一次戒備期間只發一次）。
   - 最後一次觸發後經過 `JOIN_FLOOD_COOLDOWN_SECONDS` 自動解除戒備。
2. **CAS 檢查**（`services/cas.ts`）
   - `GET https://api.cas.chat/check?user_id=<id>`，timeout `CAS_TIMEOUT_MS`。
   - 命中 → `banChatMember`（永久）、加入「剛被移除」名單、記 log、流程結束。
   - 查詢失敗或逾時 → fail-open 視為未命中，記 log，繼續流程。
   - `CAS_ENABLED=false` 時跳過。
3. **驗證題流程**：與現行相同（限制發言 → 出題 → 180 秒超時踢出），pending 記錄改寫入 SQLite。

## 資料模型與重啟恢復

SQLite 僅一張表；訊息洪水與入群洪水視窗屬短週期資料，留在記憶體：

```sql
CREATE TABLE IF NOT EXISTS pending (
  chat_id            INTEGER NOT NULL,
  user_id            INTEGER NOT NULL,
  correct_answer     TEXT    NOT NULL,
  joined_at          INTEGER NOT NULL,  -- epoch ms
  captcha_message_id INTEGER NOT NULL,
  join_message_id    INTEGER,           -- 入群服務訊息，可能晚到或缺席
  PRIMARY KEY (chat_id, user_id)
);
```

`store/pending.ts` 對外介面（內部同步寫 DB 並管理記憶體 timer 註冊表）：

- `add(pending, onTimeout)`：寫入 DB、設定超時 timer。
- `get(chatId, userId)`：查詢。
- `attachJoinMessage(chatId, userId, messageId)`：補記服務訊息 id。
- `resolve(chatId, userId)`：驗證完成（成功或管理員處置），刪 DB 列、清 timer。
- `restore(onTimeout)`：啟動時呼叫——已過期者立即執行超時處置；未過期者以剩餘時間重建 timer。

Timer handle 不落地；重啟後驗證訊息與按鈕仍在群內，用戶按鈕照常運作。

## 服務訊息刪除

「XX 加入群組」是帶 `new_chat_members` 的獨立 message update，通常晚於 `chat_member` 事件。`handlers/serviceMessage.ts` 收到時對每位新成員：

- 有 pending 記錄 → `attachJoinMessage` 寫入 DB，供之後失敗路徑一併刪除。
- 在「剛被移除」名單（記憶體 set，TTL 約 60 秒；CAS 封鎖與戒備踢出時加入）→ 立即刪除服務訊息。
- 皆否 → 不處理。

所有失敗路徑（答錯、超時、管理員封鎖/禁言、CAS、戒備踢出）刪除驗證訊息時一併刪除已記錄的入群服務訊息。通過驗證者的入群訊息保留。

已知限制：若服務訊息早於 `chat_member` 事件抵達（罕見），該則訊息不會被刪除，無其他影響。

## 設定（config.ts）

全部環境變數，啟動時讀取一次並驗證（非數字或負值 fail-fast 拋錯）：

| 變數 | 預設 | 用途 |
|---|---|---|
| `VERIFY_TIMEOUT_SECONDS` | 180 | 驗證時限 |
| `FLOOD_WINDOW_SECONDS` | 5 | 訊息洪水視窗 |
| `FLOOD_MAX_MESSAGES` | 5 | 視窗內訊息上限 |
| `FLOOD_MUTE_SECONDS` | 300 | 訊息洪水禁言時長 |
| `JOIN_FLOOD_WINDOW_SECONDS` | 60 | 入群洪水視窗 |
| `JOIN_FLOOD_MAX_JOINS` | 10 | 視窗內加入數上限 |
| `JOIN_FLOOD_COOLDOWN_SECONDS` | 300 | 戒備模式冷卻 |
| `CAS_ENABLED` | true | CAS 開關 |
| `CAS_TIMEOUT_MS` | 3000 | CAS 查詢逾時 |
| `ADMIN_MUTE_SECONDS` | 86400 | 管理員禁言按鈕時長 |
| `DB_PATH` | `./data/antispam.db` | SQLite 路徑（目錄不存在則建立） |

`.env.example` 同步列出全部變數。

## 錯誤處理

- CAS 失敗/逾時：fail-open，記 log。
- SQLite 開啟失敗：啟動時 crash（fail-fast）。
- 執行期 Telegram API 錯誤：沿用既有 `bot.catch` 兜底。
- 戒備通知發送失敗：不影響踢人流程。

## 測試策略

沿用 vitest 與現有測試模式，維持 TDD：

- `services/joinFlood`：fake timers 驗證視窗、觸發、冷卻解除。
- `services/cas`：mock fetch 驗證命中、未命中、逾時 fail-open、停用開關。
- `store/pending`：`:memory:` SQLite 驗證 CRUD、restore 的過期/未過期分支。
- `handlers`：既有測試改配合新介面；新增 CAS 命中封鎖、戒備模式踢出、服務訊息記錄/即刪、失敗路徑連帶刪除四類行為測試。
- `config`：預設值與非法值 fail-fast。
