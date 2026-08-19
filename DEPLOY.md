# 部署筆記

`telegram-antispam`（grammY + better-sqlite3，long polling）從零開一台 VPS 到上線的完整流程。

---

## 開始前：程式碼怎麼上機器

程式碼在 **https://github.com/cataska/telegram-antispam**（公開），直接 clone 即可，
不需要 deploy key 或 token。之後更新只要 `git pull` 加上重建容器。

`.env` 在 `.gitignore` 內，token 不會進 repo——每台機器的 `.env` 都是各自建立的。

若本機有還沒推上去的改動要先測，也可以直接傳檔：

```bash
rsync -av --exclude node_modules --exclude dist --exclude data --exclude .env \
  ./ user@<vps-ip>:/opt/telegram-antispam/
```

但正式部署還是走 git，才有版本可回溯。

---

## 機器規格

| 項目 | 需求 |
|---|---|
| RAM | 1GB（實跑約 100MB；別選 512MB，萬一要編譯 better-sqlite3 會不夠） |
| 磁碟 | 最小方案即可，SQLite 只有幾 MB |
| 對外埠 | **不需要**。long polling 只要 outbound HTTPS |
| 架構 | x64 或 arm64 皆可（Node 22 兩者都有 prebuilt） |
| OS | Ubuntu 24.04 LTS |

長輪詢不需要網域、TLS 憑證或固定 IP，防火牆只開 22（SSH）即可。

---

## 步驟 1：開機器

建立 VPS 時：

- **映像檔**選 Ubuntu 24.04 LTS
- **地區**挑離自己近的（bot 對延遲不敏感，但 SSH 進去除錯時有感）
- **SSH key** 在建立階段就掛上去，不要用密碼登入

開好之後以 root 登入：

```bash
ssh root@<vps-ip>
```

---

## 步驟 2：系統初始設定

```bash
# 更新系統
apt update && apt upgrade -y

# 時區設為台北，log 時間才好對照
timedatectl set-timezone Asia/Taipei

# 建立日常使用的非 root 帳號
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# 把 root 的 SSH key 複製給新帳號
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/
```

**關掉密碼登入與 root 直接登入**：

```bash
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

> 改完先**開另一個終端機**測試 `ssh deploy@<vps-ip>` 能登入，再關掉現在這個 session。否則設定寫錯就把自己鎖在門外了。

**防火牆**（只開 SSH，bot 不需要任何入站埠）：

```bash
ufw allow OpenSSH
ufw --force enable
```

**自動安全更新**：

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

**加 swap**（1GB 機器建議加，避免建置時 OOM）：

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 步驟 3：安裝 Docker

以 `deploy` 身分登入後執行。官方腳本會一併裝好 compose v2 plugin：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

**重新登入**讓群組生效，然後確認：

```bash
docker version
docker compose version    # 要能看到 v2.x 以上
```

> 若改用發行版套件（`apt install docker.io docker-compose`），裝到的會是舊的 compose v1，它跟 Docker 29.x 不相容，`up --build` 遇到既有容器會拋 `KeyError: 'ContainerConfig'`。Ubuntu 24.04 可改裝 `docker-compose-v2` 套件解決。

---

## 步驟 4：取得程式碼

```bash
sudo mkdir -p /opt/telegram-antispam
sudo chown $USER:$USER /opt/telegram-antispam
git clone https://github.com/cataska/telegram-antispam.git /opt/telegram-antispam
cd /opt/telegram-antispam
```

repo 是公開的，clone 不需要任何認證。

---

## 步驟 5：設定

```bash
cp .env.example .env
chmod 600 .env      # token 不要讓其他帳號讀到
vim .env
```

填入 `BOT_TOKEN`，其餘保持註解即用預設值。**註解一律獨立成行**，不要寫在值後面——`env_file` 會把行內的 `# ...` 一併算進值裡，而本機開發用的 dotenv 不會，這種差異只有進容器才會爆。

建立資料目錄。容器內以 `node`（uid 1000）執行，目錄必須先交給該 uid，否則 Docker 會以 root 建立而容器寫不進去：

```bash
mkdir -p data && sudo chown 1000:1000 data
```

---

## 步驟 6：啟動

```bash
docker compose up -d --build
docker compose logs -f
```

看到這兩行就是正常運作：

```
[啟動] 恢復 0 筆進行中的驗證，另有 0 筆已逾時將立即處置
Anti-spam bot is running...
```

`restart: always` 會處理程式崩潰與主機重開。

---

## 上線前檢查

- [ ] Bot 已在群組設為管理員，且勾選 **刪除訊息** 與 **封鎖用戶**（後者即 API 的 `can_restrict_members`，踢出與禁言共用，介面上沒有獨立的「限制用戶」）
- [ ] BotFather 中對該 bot 執行 `/setprivacy` → **Disable**（否則收不到一般訊息，洪水偵測與連結過濾會失效）。改完若 bot 已在群裡，要踢出重加才生效
- [ ] 群組是 **supergroup**（`restrictChatMember` 在 basic group 無效，開一次公開連結即可升級）
- [ ] 本機或其他機器上的實例已關閉（同一 token 不能同時跑兩份）
- [ ] token 若曾外流（貼在對話、截圖、commit），先到 BotFather `/revoke` 換一組
- [ ] 先在測試群跑一輪：用小號加入，確認驗證題出現、答對可發言、超時被踢

---

## 日常維運

```bash
docker compose logs -f          # 即時 log
docker compose restart          # 重啟
docker compose down             # 停止（資料留在 ./data）
docker compose up -d --build    # 更新程式後重新部署
```

更新流程：

```bash
cd /opt/telegram-antispam
git pull
docker compose up -d --build
```

---

## 備份

`pending` 表只存進行中的驗證，`members` 表存新成員的加入時間。資料價值不高，丟了頂多是幾個人要重驗一次、部分新成員的連結限制提早解除。

```bash
sqlite3 data/antispam.db ".backup '/tmp/antispam-$(date +%F).db'"
```

想自動化就掛 cron：

```bash
0 4 * * * cd /opt/telegram-antispam && sqlite3 data/antispam.db ".backup '/opt/backups/antispam-$(date +\%F).db'"
```

---

## 已知的維運注意事項

**Graceful shutdown 已內建**
收到 SIGTERM/SIGINT 後會停止拉取新 update、等處理中的 update 收尾、清掉驗證超時 timer，再關閉 SQLite。清 timer 這步是必要的：驗證 timer 最長 3 分鐘，不清的話 Node 會撐到最後一個 timer 到期，`docker stop` 只能空等到 SIGKILL。

即使真的被強制中斷也不會掉狀態——`restorePending()` 會在啟動時從 SQLite 重建進行中的驗證。

**單一實例**
SQLite 與 long polling 都不支援多實例。不要同時跑兩份（例如本機 `npm run dev` 沒關就在 VPS 上線），Telegram 會回 409 衝突。

**CAS 是外部依賴**
`CAS_TIMEOUT_MS` 預設 3 秒。cas.chat 掛掉時該名新成員的驗證會慢 3 秒，查詢失敗一律視為未命中（fail-open），不會把正常人擋在門外。真的出問題可設 `CAS_ENABLED=false`。

update 以 `@grammyjs/runner` 依「群組 + 觸發者」分流處理，所以這 3 秒只影響該名新成員，其他人的訊息與驗證按鈕照常處理。

**新成員連結限制**
預設新成員加入後 24 小時內不能發連結（管理員豁免），用 `LINK_RESTRICT_HOURS` 調整，設 `0` 停用。這條擋的是「先潛伏、通過驗證後隔一段時間再發廣告」的帳號——只在驗證期間擋連結是沒有用的，那段時間本來就全靜音。

**沒有健康監控**
bot 掛掉不會有人通知你，而群組會靜悄悄地失去防護。`restart: always` 只救得了程式崩潰，救不了機器本身當掉或網路斷線。真的在意的話得另外接一個 dead man's switch（例如容器定期 ping healthchecks.io，逾時就發信）。

**權限交接**
建議至少兩位社群成員持有 VPS 存取權與 bot token，避免單點依賴單一維護者。

---

## 不用 Docker 的話

不想裝 Docker 就用 systemd，repo 內附 `telegram-antispam.service`：

```bash
# 建立專用使用者
sudo useradd -r -s /usr/sbin/nologin antispam

# 部署程式（Node 22 建議用 NodeSource 或 fnm 安裝，
# 不要用 Ubuntu 內建的舊版——better-sqlite3 12.x 需要 Node 20+）
cd /opt/telegram-antispam
npm ci && npm run build && npm prune --omit=dev
sudo mkdir -p data
sudo chown -R antispam:antispam /opt/telegram-antispam

# 環境變數（權限鎖死，token 不要進 git）
sudo tee /etc/telegram-antispam.env > /dev/null <<'EOF'
BOT_TOKEN=xxxxx
DB_PATH=/opt/telegram-antispam/data/antispam.db
EOF
sudo chmod 600 /etc/telegram-antispam.env

# 啟動
sudo cp telegram-antispam.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now telegram-antispam
journalctl -u telegram-antispam -f
```
