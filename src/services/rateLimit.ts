import { config } from '../config.js';

export interface RateLimitOptions {
  windowMs: number;
  maxMessages: number;
}

// 訊息記錄：chatId:userId -> 時間戳陣列
const messageTimestamps: Map<string, number[]> = new Map();

// 每個用戶最近一次的相簿 id：同一相簿的多則訊息只計一次
const lastMediaGroup: Map<string, string> = new Map();

// 兩張表都是每個 chatId:userId 一筆且不會自然消失，長期執行下會無上限成長。
// 每次呼叫全掃太浪費，改成固定間隔清一次沉寂已久的項目。
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweep(now: number, windowMs: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  for (const [key, timestamps] of messageTimestamps) {
    const latest = timestamps[timestamps.length - 1];
    if (latest === undefined || now - latest >= windowMs) {
      messageTimestamps.delete(key);
      lastMediaGroup.delete(key);
    }
  }
}

export function checkRateLimit(
  chatId: number,
  userId: number,
  mediaGroupId?: string,
  opts: RateLimitOptions = {
    windowMs: config.floodWindowMs,
    maxMessages: config.floodMaxMessages,
  }
): boolean {
  const key = `${chatId}:${userId}`;
  const now = Date.now();

  sweep(now, opts.windowMs);

  // 相簿（album）會被 Telegram 拆成多則幾乎同時抵達的訊息，
  // 後續同組訊息不重複計數，避免傳一組照片就被誤判洪水
  if (mediaGroupId !== undefined) {
    if (lastMediaGroup.get(key) === mediaGroupId) {
      return false;
    }
    lastMediaGroup.set(key, mediaGroupId);
  }

  let timestamps = messageTimestamps.get(key) || [];

  // 移除過期的時間戳
  timestamps = timestamps.filter((ts) => now - ts < opts.windowMs);

  // 加入新的時間戳
  timestamps.push(now);
  messageTimestamps.set(key, timestamps);

  // 檢查是否超過限制
  return timestamps.length > opts.maxMessages;
}
