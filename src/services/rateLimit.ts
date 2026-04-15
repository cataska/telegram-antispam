// 訊息記錄：chatId:userId -> 時間戳陣列
const messageTimestamps: Map<string, number[]> = new Map();

const WINDOW_MS = 5_000; // 5 秒
const MAX_MESSAGES = 5;  // 5 秒內最多 5 則

export function checkRateLimit(chatId: number, userId: number): boolean {
  const key = `${chatId}:${userId}`;
  const now = Date.now();

  let timestamps = messageTimestamps.get(key) || [];

  // 移除過期的時間戳
  timestamps = timestamps.filter((ts) => now - ts < WINDOW_MS);

  // 加入新的時間戳
  timestamps.push(now);
  messageTimestamps.set(key, timestamps);

  // 檢查是否超過限制
  return timestamps.length > MAX_MESSAGES;
}
