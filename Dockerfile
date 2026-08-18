# ---- build ----
FROM node:22-slim AS builder

# better-sqlite3 若抓不到 prebuilt binary 需要這些才能自行編譯
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 移除 devDependencies，保留已編譯好的原生模組
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# SQLite 資料目錄，需掛載 volume
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node

CMD ["node", "dist/index.js"]
