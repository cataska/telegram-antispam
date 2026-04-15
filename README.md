# Telegram Anti-Spam Bot

Telegram 群組防 spam 機器人。

## 功能

- **新成員驗證**：加入後需回答問題，60 秒內答對才能發言
- **新成員禁止發連結**：驗證通過前禁止發送 URL
- **洪水偵測**：5 秒內超過 5 則訊息自動禁言 5 分鐘

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

## 執行

```bash
# 開發模式
npm run dev

# 正式環境
npm run build
npm start
```

## Bot 權限需求

Bot 需要以下群組權限：
- 刪除訊息
- 封鎖用戶
- 限制用戶

## 專案結構

```
src/
├── index.ts           # 入口
├── handlers/
│   ├── index.ts       # Handler 設定
│   ├── newMember.ts   # 新成員驗證
│   ├── message.ts     # 訊息檢查
│   └── callback.ts    # 按鈕回調
├── services/
│   ├── captcha.ts     # 驗證題目產生
│   ├── rateLimit.ts   # 洪水偵測
│   └── linkFilter.ts  # 連結過濾
└── store/
    ├── pending.ts     # 待驗證用戶
    └── verified.ts    # 已驗證用戶
```
