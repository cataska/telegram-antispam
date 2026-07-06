import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from './rateLimit.js';

// 每個測試用不同 chatId 避免模組狀態互相干擾
let nextChatId = 30_000;

describe('checkRateLimit', () => {
  let chatId: number;
  const userId = 42;

  beforeEach(() => {
    chatId = nextChatId++;
  });

  it('視窗內超過上限判定為洪水', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(chatId, userId)).toBe(false);
    }
    expect(checkRateLimit(chatId, userId)).toBe(true);
  });

  it('同一相簿（media_group_id）的多則訊息只計一次', () => {
    // 一組 10 張的相簿：第一則計數，其餘不計
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(chatId, userId, 'album-1')).toBe(false);
    }
    // 相簿只佔一個名額，再發 4 則一般訊息仍未超標
    for (let i = 0; i < 4; i++) {
      expect(checkRateLimit(chatId, userId)).toBe(false);
    }
    expect(checkRateLimit(chatId, userId)).toBe(true);
  });

  it('不同相簿各自計一次', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(chatId, userId, `album-${i}`)).toBe(false);
    }
    expect(checkRateLimit(chatId, userId, 'album-6')).toBe(true);
  });
});
