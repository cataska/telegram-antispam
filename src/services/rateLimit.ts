import { config } from '../config.js';

// 訊息記錄：chatId:userId -> 時間戳陣列
const messageTimestamps: Map<string, number[]> = new Map();

// 每個用戶最近一次的相簿 id：同一相簿的多則訊息只計一次
const lastMediaGroup: Map<string, string> = new Map();

export function checkRateLimit(
  chatId: number,
  userId: number,
  mediaGroupId?: string
): boolean {
  const key = `${chatId}:${userId}`;

  // 相簿（album）會被 Telegram 拆成多則幾乎同時抵達的訊息，
  // 後續同組訊息不重複計數，避免傳一組照片就被誤判洪水
  if (mediaGroupId !== undefined) {
    if (lastMediaGroup.get(key) === mediaGroupId) {
      return false;
    }
    lastMediaGroup.set(key, mediaGroupId);
  }

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
