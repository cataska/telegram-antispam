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

  it('多成員訊息：命中剛被移除者即刪除整則訊息並停止，後續成員不再記錄', async () => {
    // 成員 43 驗證中、成員 42 剛被移除；42 排在 43 前面
    addPending(
      { userId: 43, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 98 },
      180_000,
      () => {}
    );
    markRemoved(chatId, 42);
    const ctx = makeCtx(chatId, [
      { id: 7, is_bot: true },
      { id: 42, is_bot: false },
      { id: 43, is_bot: false },
    ]);

    await handleServiceMessage(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 777);
    // 刪除後即停止：43 的 pending 不會被補記 join_message_id
    expect(getPending(chatId, 43)?.joinMessageId).toBeUndefined();
  });

  it('多成員訊息：排在後面的「剛被移除」標記也會被消費掉', async () => {
    markRemoved(chatId, 42);
    markRemoved(chatId, 43);
    const first = makeCtx(chatId, [
      { id: 42, is_bot: false },
      { id: 43, is_bot: false },
    ]);

    await handleServiceMessage(first);
    expect(first.api.deleteMessage).toHaveBeenCalledWith(chatId, 777);

    // 43 在 TTL 內重新加入並正常進入驗證：標記若沒被消費掉，
    // 這則正常的入群訊息會被誤刪
    addPending(
      { userId: 43, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 98 },
      180_000,
      () => {}
    );
    const second = makeCtx(chatId, [{ id: 43, is_bot: false }]);
    second.message.message_id = 888;

    await handleServiceMessage(second);

    expect(second.api.deleteMessage).not.toHaveBeenCalled();
    expect(getPending(chatId, 43)?.joinMessageId).toBe(888);
  });
});
