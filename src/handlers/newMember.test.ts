import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleNewMember } from './newMember.js';
import { pendingUsers } from '../store/pending.js';

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
    pendingUsers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('新成員（left → member）觸發驗證', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).toHaveBeenCalled();
    expect(ctx.api.sendMessage).toHaveBeenCalled();
    expect(pendingUsers.has(`${chatId}:${user.id}`)).toBe(true);
  });

  it('管理員被降級（administrator → member）不觸發驗證', async () => {
    const ctx = makeCtx('administrator', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(pendingUsers.has(`${chatId}:${user.id}`)).toBe(false);
  });

  it('解除禁言（restricted → member）不觸發驗證', async () => {
    const ctx = makeCtx('restricted', 'member');

    await handleNewMember(ctx);

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(pendingUsers.has(`${chatId}:${user.id}`)).toBe(false);
  });

  it('驗證超時會踢出用戶並刪除驗證訊息', async () => {
    const ctx = makeCtx('left', 'member');

    await handleNewMember(ctx);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(ctx.api.banChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(ctx.api.unbanChatMember).toHaveBeenCalledWith(chatId, user.id);
    expect(pendingUsers.has(`${chatId}:${user.id}`)).toBe(false);
  });

  it('超時前重新入群，第一次的超時 timer 不會誤踢第二次驗證', async () => {
    // 第一次入群
    const ctx1 = makeCtx('left', 'member');
    await handleNewMember(ctx1);

    // 100 秒後答錯被踢（callback 會刪除 pending），隨即重新入群
    await vi.advanceTimersByTimeAsync(100_000);
    pendingUsers.delete(`${chatId}:${user.id}`);
    const ctx2 = makeCtx('kicked', 'member');
    await handleNewMember(ctx2);

    // 到第一次入群的 180 秒時限：不應踢人（第二次驗證還剩 100 秒）
    await vi.advanceTimersByTimeAsync(85_000);
    expect(ctx1.api.banChatMember).not.toHaveBeenCalled();
    expect(ctx2.api.banChatMember).not.toHaveBeenCalled();
    expect(pendingUsers.has(`${chatId}:${user.id}`)).toBe(true);

    // 第二次的 180 秒到期才踢
    await vi.advanceTimersByTimeAsync(100_000);
    expect(ctx2.api.banChatMember).toHaveBeenCalled();
  });
});
