import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleServiceMessage } from './serviceMessage.js';
import { initPendingStore, addPending, getPending } from '../store/pending.js';
import { markRemoved } from '../store/recentlyRemoved.js';
import { openDb } from '../db.js';

let nextChatId = 5000;

function makeCtx(chatId: number, members: Array<{ id: number; is_bot: boolean }>) {
  return {
    chat: { id: chatId, type: 'supergroup' },
    message: { message_id: 777, new_chat_members: members },
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as any;
}

describe('handleServiceMessage', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId++;
    initPendingStore(openDb(':memory:'));
  });

  it('驗證中用戶的入群訊息被記錄到 pending', async () => {
    addPending(
      { userId: 42, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 99 },
      180_000,
      () => {}
    );
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(getPending(chatId, 42)?.joinMessageId).toBe(777);
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it('剛被移除用戶的入群訊息立即刪除', async () => {
    markRemoved(chatId, 42);
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 777);
  });

  it('與 bot 無關的入群訊息不處理', async () => {
    const ctx = makeCtx(chatId, [{ id: 42, is_bot: false }]);

    await handleServiceMessage(ctx);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });
});
