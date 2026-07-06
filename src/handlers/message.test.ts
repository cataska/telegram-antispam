import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleMessage } from './message.js';
import { initPendingStore, addPending } from '../store/pending.js';
import { openDb } from '../db.js';

interface CtxOptions {
  chatId: number;
  userId: number;
  chatType?: string;
  text?: string;
  mediaGroupId?: string;
  memberStatus?: string;
}

function makeCtx(opts: CtxOptions) {
  return {
    chat: { id: opts.chatId, type: opts.chatType ?? 'supergroup' },
    from: { id: opts.userId, first_name: 'Test' },
    message: { text: opts.text ?? '', media_group_id: opts.mediaGroupId },
    deleteMessage: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue({}),
    api: {
      restrictChatMember: vi.fn().mockResolvedValue(true),
      getChatMember: vi
        .fn()
        .mockResolvedValue({ status: opts.memberStatus ?? 'member' }),
    },
  } as any;
}

// 每個測試用不同的 chatId 避免 rateLimit 模組狀態互相干擾
let nextChatId = 1000;

describe('handleMessage', () => {
  let chatId: number;
  const userId = 42;

  beforeEach(() => {
    vi.useFakeTimers();
    chatId = nextChatId++;
    initPendingStore(openDb(':memory:'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('私聊訊息不處理，直接放行', async () => {
    const ctx = makeCtx({ chatId, userId, chatType: 'private', text: 'https://spam.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('驗證中的新成員發連結會被刪除', async () => {
    addPending(
      { userId, chatId, correctAnswer: '2', joinedAt: Date.now(), captchaMessageId: 1 },
      180_000,
      () => {}
    );
    const ctx = makeCtx({ chatId, userId, text: '快來 https://spam.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('不在驗證名單的既有成員發連結不受影響', async () => {
    const ctx = makeCtx({ chatId, userId, text: '分享 https://example.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('一般成員洪水發言會被禁言', async () => {
    const next = vi.fn();
    let ctx;
    for (let i = 0; i < 6; i++) {
      ctx = makeCtx({ chatId, userId, text: `訊息 ${i}` });
      await handleMessage(ctx, next);
    }

    expect(ctx.api.restrictChatMember).toHaveBeenCalledWith(
      chatId,
      userId,
      { can_send_messages: false },
      expect.objectContaining({ until_date: expect.any(Number) })
    );
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('傳相簿（同 media_group_id 的多則訊息）不會被誤判洪水', async () => {
    const next = vi.fn();
    let ctx;
    // 一組 8 張的相簿：Telegram 會拆成 8 則幾乎同時抵達的訊息
    for (let i = 0; i < 8; i++) {
      ctx = makeCtx({ chatId, userId, mediaGroupId: 'album-1' });
      await handleMessage(ctx, next);
    }

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
  });

  it('管理員洪水發言不會被禁言', async () => {
    const next = vi.fn();
    let ctx;
    for (let i = 0; i < 6; i++) {
      ctx = makeCtx({ chatId, userId, memberStatus: 'administrator', text: `公告 ${i}` });
      await handleMessage(ctx, next);
    }

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
  });
});
