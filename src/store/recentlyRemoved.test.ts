import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { markRemoved, consumeRecentlyRemoved } from './recentlyRemoved.js';

let nextChatId = 1;

describe('recentlyRemoved', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('標記後可查到一次，讀取即消費', () => {
    markRemoved(chatId, 42);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(true);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(false);
  });

  it('未標記者查不到', () => {
    expect(consumeRecentlyRemoved(chatId, 999)).toBe(false);
  });

  it('超過 TTL 後失效', () => {
    markRemoved(chatId, 42);
    vi.advanceTimersByTime(61_000);
    expect(consumeRecentlyRemoved(chatId, 42)).toBe(false);
  });
});
