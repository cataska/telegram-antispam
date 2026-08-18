import { describe, it, expect, beforeEach } from 'vitest';
import { initStores } from './index.js';
import { recordMemberJoin, isRecentMember, pruneMembers } from './members.js';
import { openDb } from '../db.js';

const chatId = -100;
const userId = 42;
const DAY_MS = 86_400_000;

describe('members store', () => {
  beforeEach(() => {
    initStores(openDb(':memory:'));
  });

  it('剛加入的成員在限制期內', () => {
    recordMemberJoin(chatId, userId);
    expect(isRecentMember(chatId, userId, DAY_MS)).toBe(true);
  });

  it('超過限制期後不再受限', () => {
    const now = Date.now();
    recordMemberJoin(chatId, userId, now - DAY_MS - 1);
    expect(isRecentMember(chatId, userId, DAY_MS, now)).toBe(false);
  });

  it('沒有加入記錄的老成員不受限', () => {
    expect(isRecentMember(chatId, 999, DAY_MS)).toBe(false);
  });

  it('重新加入時限制期重新起算', () => {
    const now = Date.now();
    recordMemberJoin(chatId, userId, now - DAY_MS - 1);
    recordMemberJoin(chatId, userId, now);
    expect(isRecentMember(chatId, userId, DAY_MS, now)).toBe(true);
  });

  it('windowMs 為 0（停用）時一律不受限', () => {
    recordMemberJoin(chatId, userId);
    expect(isRecentMember(chatId, userId, 0)).toBe(false);
  });

  it('prune 只清掉已過限制期的記錄', () => {
    const now = Date.now();
    recordMemberJoin(chatId, 1, now - DAY_MS - 1);
    recordMemberJoin(chatId, 2, now - 1_000);

    expect(pruneMembers(DAY_MS, now)).toBe(1);
    expect(isRecentMember(chatId, 2, DAY_MS, now)).toBe(true);
  });

  it('停用時 prune 不動任何記錄', () => {
    recordMemberJoin(chatId, userId, Date.now() - DAY_MS * 10);
    expect(pruneMembers(0)).toBe(0);
  });
});
