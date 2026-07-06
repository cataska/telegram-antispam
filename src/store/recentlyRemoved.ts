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
