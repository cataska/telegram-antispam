import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleNewMember } from './newMember.js';
import { initPendingStore, getPending } from '../store/pending.js';
import { openDb } from '../db.js';
import { recordJoin } from '../services/joinFlood.js';

const chatId = -100123;
const user = { id: 42, is_bot: false, first_name: 'New' };

function makeCtx(oldStatus: string, newStatus: string) {
  return {
    chatMember: {
      chat: { id: chatId, type: 'supergroup' },
      old_chat_member: { status: oldStatus, user },
      new_chat_member: { status: newStatus, user },
    },
    api: {
      restrictChatMember: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 99 }),
      banChatMember: vi.fn().mockResolvedValue(true),
      unbanChatMember: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as any;
}

describe('handleNewMember', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
    // 避免 CAS 檢查打到真實網路（Task 7 之前 handler 尚未接 CAS，先備妥 stub 也無害）
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('新成員（left → member）觸發驗證', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalled();
    expect(ctx.api.sendMessage).toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeDefined();
  });

  it('管理員被降級（administrator → member）不觸發驗證', async () => {
    const ctx = makeCtx('administrator', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('解除禁言（restricted → member）不觸發驗證', async () => {
    const ctx = makeCtx('restricted', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('驗證超時會踢出用戶並刪除驗證訊息', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(chatId, 99);
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('超時前重新入群，第一次的超時 timer 不會誤踢第二次驗證', async () => {
    const ctx1 = makeCtx('left', 'member');
    await handleNewMember(ctx1);

    await vi.advanceTimersByTimeAsync(100_000);
    const ctx2 = makeCtx('kicked', 'member');
    await handleNewMember(ctx2);

    await vi.advanceTimersByTimeAsync(85_000); // 第一次的 180 秒已過
    expect(ctx1.api.banChatMember).not.toHaveBeenCalled();
    expect(ctx2.api.banChatMember).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(100_000); // 第二次的 180 秒到期
    expect(ctx2.api.banChatMember).toHaveBeenCalled();
  });

  it('CAS 命中者直接永久封鎖，不出驗證題', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.unbanChatMember).not.toHaveBeenCalled(); // 永久封鎖
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(getPending(chatId, user.id)).toBeUndefined();
  });

  it('戒備模式中新加入者被踢出（可重新加入），剛觸發時發通知', async () => {
    const alertChatId = -100999;
    const floodOpts = { windowMs: 60_000, maxJoins: 10, cooldownMs: 300_000 };
    // 先灌 10 次讓下一次入群觸發戒備
    for (let i = 0; i < 10; i++) recordJoin(alertChatId, floodOpts);

    const makeAlertCtx = () => {
      const ctx = makeCtx('left', 'member');
      ctx.chatMember.chat.id = alertChatId;
      return ctx;
    };

    const first = makeAlertCtx();
    await handleNewMember(first);
    expect(first.api.banChatMember).toHaveBeenCalledWith(alertChatId, user.id);
    expect(first.api.unbanChatMember).toHaveBeenCalledWith(alertChatId, user.id);
    expect(first.api.sendMessage).toHaveBeenCalledTimes(1); // 戒備通知
    expect(getPending(alertChatId, user.id)).toBeUndefined();

    const second = makeAlertCtx();
    await handleNewMember(second);
    expect(second.api.banChatMember).toHaveBeenCalled();
    expect(second.api.sendMessage).not.toHaveBeenCalled(); // 通知只發一次
  });
});
