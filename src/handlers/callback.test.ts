import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCallback } from './callback.js';
import { initPendingStore, addPending, getPending, attachJoinMessage } from '../store/pending.js';
import { openDb } from '../db.js';

const chatId = -100456;
const userId = 42;
const adminId = 7;

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
  addPending(
    { userId, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 99 },
    180_000,
    () => {}
  );
}

// 解除限制帶 35 秒後到期的 until_date：到期後 Telegram 才會把使用者恢復成一般
// member，只把權限設回預設值會讓人永遠停在 restricted。
const liftUntil = () => Math.floor(Date.now() / 1000) + 35;

describe('handleCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
    setPending();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('答對後以群組預設權限恢復發言，且限制會到期回歸 member', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(chatId, userId, chatPermissions, {
      until_date: liftUntil(),
    });
    expect(getPending(chatId, userId)).toBeUndefined();
  });

  it('答對後清除超時 timer', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, userId);

    await handleCallback(ctx);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('答錯會被踢出，驗證訊息與入群訊息一併刪除', async () => {
    attachJoinMessage(chatId, userId, 123);
    const ctx = makeCtx(`verify:${userId}:3`, userId);

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 99);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 123);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('非本人點驗證按鈕會被拒絕', async () => {
    const ctx = makeCtx(`verify:${userId}:2`, 999);

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, userId)).toBeDefined();
  });

  it('管理員手動通過時以群組預設權限恢復發言並清除 timer', async () => {
    const ctx = makeCtx(`admin:${userId}:pass`, adminId, 'administrator');

    await handleCallback(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(chatId, userId, chatPermissions, {
      until_date: liftUntil(),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('不認得的 callback data 仍會回應，避免按鈕一直轉圈', async () => {
    const ctx = makeCtx('somethingelse:1', userId);

    await handleCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it('管理員封鎖時入群訊息一併刪除', async () => {
    attachJoinMessage(chatId, userId, 123);
    const ctx = makeCtx(`admin:${userId}:ban`, adminId, 'administrator');

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, userId);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 123);
  });

  it('非管理員點管理員按鈕會被拒絕', async () => {
    const ctx = makeCtx(`admin:${userId}:ban`, 999, 'member');

    await handleCallback(ctx);

    expect(ctx.api.banChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, userId)).toBeDefined();
  });
});
