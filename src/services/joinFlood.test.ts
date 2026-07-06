import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordJoin } from './joinFlood.js';

const opts = { windowMs: 60_000, maxJoins: 10, cooldownMs: 300_000 };

// 每個測試用不同 chatId 避免模組狀態互相干擾
let nextChatId = 1;

describe('recordJoin', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('視窗內加入數未超標時不進入戒備', () => {
    for (let i = 0; i < 10; i++) {
      const result = recordJoin(chatId, opts);
      expect(result.inAlert).toBe(false);
    }
  });

  it('視窗內超標的那一次加入觸發戒備，justEntered 只在第一次為 true', () => {
    for (let i = 0; i < 10; i++) recordJoin(chatId, opts);

    const eleventh = recordJoin(chatId, opts);
    expect(eleventh).toEqual({ inAlert: true, justEntered: true });

    const twelfth = recordJoin(chatId, opts);
    expect(twelfth).toEqual({ inAlert: true, justEntered: false });
  });

  it('舊的加入記錄滑出視窗後不觸發戒備', () => {
    for (let i = 0; i < 10; i++) recordJoin(chatId, opts);
    vi.advanceTimersByTime(61_000); // 全部滑出視窗

    const result = recordJoin(chatId, opts);
    expect(result.inAlert).toBe(false);
  });

  it('最後一次觸發後經過冷卻時間自動解除戒備', () => {
    for (let i = 0; i < 11; i++) recordJoin(chatId, opts); // 第 11 次觸發戒備

    vi.advanceTimersByTime(301_000); // 超過冷卻
    const result = recordJoin(chatId, opts);
    expect(result.inAlert).toBe(false);
  });

  it('不同群組的狀態互不影響', () => {
    for (let i = 0; i < 11; i++) recordJoin(chatId, opts);
    const other = recordJoin(chatId + 100_000, opts);
    expect(other.inAlert).toBe(false);
  });
});
