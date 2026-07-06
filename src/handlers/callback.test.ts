import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCallback } from './callback.js';
import { pendingUsers } from '../store/pending.js';

const chatId = -100456;
const userId = 42;
const adminId = 7;
const key = `${chatId}:${userId}`;

// 群組預設權限：禁止連結預覽（用來驗證恢復權限時採用群組設定而非硬編碼全開）
const chatPermissions = {
  can_send_messages: true,
  can_send_other_messages: true,
  can_add_web_page_previews: false,
};

function makeCtx(data: string, callerId: number, callerStatus = 'member') {
  return {
    callbackQuery: { data },
    chat: { id: chatId, type: 'supergroup' },
    from: { id: callerId },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    api: {
      getChatMember: vi.fn().mockResolvedValue({ status: callerStatus }),
      getChat: vi.fn().mockResolvedValue({ id: chatId, permissions: chatPermissions }),
      restrictChatMember: vi.fn().mockResolvedValue(true),
      banChatMember: vi.fn().mockResolvedValue(true),
      unbanChatMember: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as any;
}

function setPending() {
  pendingUsers.set(key, {
    userId,
    chatId,
    correctAnswer: '2',
    joinedAt: Date.now(),
    messageId: 99,
    timer: setTimeout(() => {}, 180_000),
  });
}

describe('handleCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pendingUsers.clear();
    setPending();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('答對後以群組預設權限恢復發言', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(
      chatId,
      userId,
      chatPermissions
    );
    expect(pendingUsers.has(key)).toBe(false);
  });

  it('答對後清除超時 timer', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('答錯會被踢出並允許重新加入', async () => {
    const ctx = makeCtx(`verify:${userId}:3`, userId);

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('非本人點驗證按鈕會被拒絕', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, 999);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(pendingUsers.has(key)).toBe(true);
  });

  it('管理員手動通過時以群組預設權限恢復發言並清除 timer', async () => {
    const ctx = makeCtx(`admin:${userId}:pass`, adminId, 'administrator');

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(
      chatId,
      userId,
      chatPermissions
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('非管理員點管理員按鈕會被拒絕', async () => {
    const ctx = makeCtx(`admin:${userId}:ban`, 999, 'member');

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).not.toHaveBeenCalled();
    expect(pendingUsers.has(key)).toBe(true);
  });
});
