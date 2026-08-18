# Telegram Anti-Spam Bot

Telegram 群組防 spam 機器人。

## 功能

- **新成員驗證**：加入後需回答隨機生成的算式，限時內（預設 180 秒）答對才能發言
- **CAS 整合**：入群時查詢 [CAS](https://cas.chat) 名單，已知 spammer 直接永久封鎖
- **入群洪水防護**：短時間大量帳號湧入時進入戒備模式，期間新加入者暫時移除，冷卻後自動解除
- **新成員禁止發連結**：加入後一段時間內（預設 24 小時）禁止發送連結，含藏在顯示文字底下的 `text_link`（管理員豁免）
- **洪水偵測**：預設 5 秒內超過 5 則訊息自動禁言 5 分鐘（管理員豁免；相簿多張圖片視為一則）
- **狀態持久化**：進行中的驗證存於 SQLite，重啟後自動恢復
- **服務訊息清理**：未通過驗證者的「加入群組」訊息自動刪除
- **並行處理**：以 [@grammyjs/runner](https://github.com/grammyjs/runner) 依「群組 + 觸發者」分流，CAS 查詢不會卡住其他人的訊息

## 安裝

```bash
npm install
```

## 設定

1. 向 [@BotFather](https://t.me/BotFather) 建立 Bot 並取得 Token
2. 複製 `.env.example` 為 `.env`
3. 填入 Bot Token

```bash
cp .env.example .env
```

所有閾值都可用環境變數調整（見 `.env.example`），不設定則使用預設值。

## 執行

```bash
# 開發模式
npm run dev

# 正式環境
npm run build
npm start
```

## 測試

```bash
npm test
```

## Bot 權限需求

Bot 需要設為群組管理員，並開啟以下兩個權限：

- **刪除訊息**
- **封鎖用戶**（即 API 的 `can_restrict_members`，踢出與禁言共用同一個權限，介面上沒有獨立的「限制用戶」開關）

另需在 [@BotFather](https://t.me/BotFather) 對該 bot 執行 `/setprivacy` → **Disable**，否則收不到一般訊息，洪水偵測與連結過濾不會生效。

## 專案結構

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
│   ├── pendingActions.ts  # 踢出與訊息清理
│   └── restrictions.ts    # 靜音與解除限制
├── services/
│   ├── captcha.ts         # 驗證題目產生
│   ├── cas.ts             # CAS 查詢
│   ├── joinFlood.ts       # 入群洪水偵測
│   ├── rateLimit.ts       # 訊息洪水偵測
│   └── linkFilter.ts      # 連結過濾
└── store/
    ├── index.ts           # store 初始化
    ├── pending.ts         # 待驗證用戶（SQLite）
    ├── members.ts         # 成員加入時間（SQLite）
    └── recentlyRemoved.ts # 剛被移除用戶（記憶體）
```
