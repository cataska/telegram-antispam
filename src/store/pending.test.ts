import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDb } from '../db.js';
import {
  initPendingStore,
  addPending,
  getPending,
  attachJoinMessage,
  resolvePending,
  restorePending,
  PendingUser,
} from './pending.js';

function makePending(overrides: Partial<PendingUser> = {}): PendingUser {
  return {
    userId: 42,
    chatId: -100,
    correctAnswer: '2',
    joinedAt: Date.now(),
    captchaMessageId: 99,
    ...overrides,
  };
}

describe('pending store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('add 之後可以 get 回同樣內容', () => {
    addPending(makePending(), 180_000, () => {});
    const got = getPending(-100, 42);
    expect(got).toMatchObject({ userId: 42, chatId: -100, correctAnswer: '2', captchaMessageId: 99 });
    expect(got?.joinMessageId).toBeUndefined();
  });

  it('attachJoinMessage 補記服務訊息 id，無此列時回傳 false', () => {
    addPending(makePending(), 180_000, () => {});
    expect(attachJoinMessage(-100, 42, 123)).toBe(true);
    expect(getPending(-100, 42)?.joinMessageId).toBe(123);
    expect(attachJoinMessage(-100, 999, 123)).toBe(false);
  });

  it('超時觸發 onTimeout 並清除記錄', async () => {
    const onTimeout = vi.fn();
    addPending(makePending(), 180_000, onTimeout);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }));
    expect(getPending(-100, 42)).toBeUndefined();
  });

  it('resolve 之後超時不再觸發', async () => {
    const onTimeout = vi.fn();
    addPending(makePending(), 180_000, onTimeout);
    resolvePending(-100, 42);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('同用戶重複 add：舊 timer 作廢，只有新的 180 秒有效', async () => {
    const first = vi.fn();
    const second = vi.fn();
    addPending(makePending(), 180_000, first);
    await vi.advanceTimersByTimeAsync(100_000);
    addPending(makePending({ joinedAt: Date.now() }), 180_000, second);

    await vi.advanceTimersByTimeAsync(85_000); // 第一次的時限已過
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100_000); // 第二次時限到
    expect(second).toHaveBeenCalled();
  });

  it('restore：未過期者按剩餘時間重建 timer', async () => {
    const onTimeout = vi.fn();
    addPending(makePending({ joinedAt: Date.now() - 100_000 }), 180_000, () => {});
    // restorePending 會先清空 timer 註冊表再重建，等同重啟後的狀態
    const count = restorePending(180_000, onTimeout);
    expect(count).toBe(1);

    await vi.advanceTimersByTimeAsync(75_000);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); // 剩餘 80 秒到期
    expect(onTimeout).toHaveBeenCalled();
  });

  it('restore：已過期者立即（delay 0）觸發 onTimeout', async () => {
    const onTimeout = vi.fn();
    addPending(makePending({ joinedAt: Date.now() - 200_000 }), 180_000, () => {});
    restorePending(180_000, onTimeout);

    await vi.advanceTimersByTimeAsync(0);
    expect(onTimeout).toHaveBeenCalled();
    expect(getPending(-100, 42)).toBeUndefined();
  });
});
