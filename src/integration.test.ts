import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bot } from 'grammy';
import { setupHandlers } from './handlers/index.js';
import { initPendingStore, getPending } from './store/pending.js';
import { openDb } from './db.js';

// 整合測試：用真實 Bot 實例走 bot.handleUpdate()，驗證事件路由接線
// （filter 匹配、註冊順序），API 呼叫由 transformer 攔截不出網路。

interface ApiCall {
  method: string;
  payload: any;
}

let nextMessageId = 900;

function fakeResult(method: string, payload: any): unknown {
  switch (method) {
    case 'sendMessage':
      return {
        message_id: nextMessageId++,
        date: 0,
        chat: { id: payload.chat_id, type: 'supergroup' },
        text: payload.text,
      };
    case 'getChat':
      return {
        id: payload.chat_id,
        type: 'supergroup',
        permissions: {
          can_send_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: false,
        },
      };
    case 'getChatMember':
      return {
        status: 'member',
        user: { id: payload.user_id, is_bot: false, first_name: 'U' },
      };
    default:
      return true;
  }
}

function createTestBot() {
  const bot = new Bot('42:TEST_TOKEN', {
    botInfo: {
      id: 424242,
      is_bot: true,
      first_name: 'TestBot',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
    } as any,
  });

  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: fakeResult(method, payload) } as any;
  });

  setupHandlers(bot);
  return { bot, calls };
}

let updateId = 1;
const user = { id: 42, is_bot: false, first_name: 'New' };

function joinUpdate(chatId: number, joiner = user, oldStatus = 'left') {
  return {
    update_id: updateId++,
    chat_member: {
      chat: { id: chatId, type: 'supergroup', title: 'Test' },
      from: joiner,
      date: 0,
      old_chat_member: { status: oldStatus, user: joiner },
      new_chat_member: { status: 'member', user: joiner },
    },
  } as any;
}

function serviceMessageUpdate(chatId: number, members: any[], messageId: number) {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId,
      date: 0,
      chat: { id: chatId, type: 'supergroup' },
      from: members[0],
      new_chat_members: members,
    },
  } as any;
}

function callbackUpdate(chatId: number, from: any, data: string, messageId: number) {
  return {
    update_id: updateId++,
    callback_query: {
      id: 'cb1',
      from,
      chat_instance: 'ci',
      data,
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: chatId, type: 'supergroup' },
      },
    },
  } as any;
}

function textUpdate(chatId: number, from: any, text: string) {
  return {
    update_id: updateId++,
    message: {
      message_id: nextMessageId++,
      date: 0,
      chat: { id: chatId, type: 'supergroup' },
      from,
      text,
    },
  } as any;
}

// 每個測試用不同 chatId，避免 joinFlood / rateLimit 模組狀態互相干擾
let nextChatId = -200_000;

describe('整合：事件路由接線', () => {
  let chatId: number;

  beforeEach(() => {
    chatId = nextChatId--;
    vi.useFakeTimers();
    initPendingStore(openDb(':memory:'));
    // CAS 一律未命中，避免真實網路
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('chat_member 事件路由到驗證流程：禁言 + 出題', async () => {
    const { bot, calls } = createTestBot();

    await bot.handleUpdate(joinUpdate(chatId));

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('restrictChatMember');
    expect(methods).toContain('sendMessage');
    const sent = calls.find((c) => c.method === 'sendMessage')!;
    expect(sent.payload.text).toContain('入群驗證');
    expect(getPending(chatId, user.id)).toBeDefined();
  });

  it('完整流程：入群 → 服務訊息補記 → 答對解禁（群組預設權限）', async () => {
    const { bot, calls } = createTestBot();

    await bot.handleUpdate(joinUpdate(chatId));
    const captchaMessageId = getPending(chatId, user.id)!.captchaMessageId;

    // 「加入群組」服務訊息抵達 → 應被 message:new_chat_members handler 補記
    await bot.handleUpdate(serviceMessageUpdate(chatId, [user], 777));
    expect(getPending(chatId, user.id)?.joinMessageId).toBe(777);

    // 本人按正確答案
    const answer = getPending(chatId, user.id)!.correctAnswer;
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(chatId, user, `verify:${user.id}:${answer}`, captchaMessageId));

    // 以 getChat 的群組預設權限解禁（can_add_web_page_previews: false）
    const restrict = calls.find((c) => c.method === 'restrictChatMember')!;
    expect(restrict.payload.permissions).toMatchObject({
      can_send_messages: true,
      can_add_web_page_previews: false,
    });
    expect(getPending(chatId, user.id)).toBeUndefined();
    // 只刪驗證訊息，保留入群訊息
    const deleted = calls.filter((c) => c.method === 'deleteMessage').map((c) => c.payload.message_id);
    expect(deleted).toContain(captchaMessageId);
    expect(deleted).not.toContain(777);
  });

  it('答錯：踢出且驗證訊息與入群訊息一併刪除', async () => {
    const { bot, calls } = createTestBot();

    await bot.handleUpdate(joinUpdate(chatId));
    const captchaMessageId = getPending(chatId, user.id)!.captchaMessageId;
    await bot.handleUpdate(serviceMessageUpdate(chatId, [user], 778));

    const correct = getPending(chatId, user.id)!.correctAnswer;
    const wrong = correct === '999' ? '998' : '999';
    calls.length = 0;
    await bot.handleUpdate(callbackUpdate(chatId, user, `verify:${user.id}:${wrong}`, captchaMessageId));

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('banChatMember');
    expect(methods).toContain('unbanChatMember');
    const deleted = calls.filter((c) => c.method === 'deleteMessage').map((c) => c.payload.message_id);
    expect(deleted).toContain(captchaMessageId);
    expect(deleted).toContain(778);
  });

  it('一般訊息路由到訊息檢查：連發超標會被禁言', async () => {
    const { bot, calls } = createTestBot();
    const member = { id: 77, is_bot: false, first_name: 'Chatty' };

    for (let i = 0; i < 6; i++) {
      await bot.handleUpdate(textUpdate(chatId, member, `msg ${i}`));
    }

    const mute = calls.find(
      (c) => c.method === 'restrictChatMember' && c.payload.until_date !== undefined
    );
    expect(mute).toBeDefined();
    expect(mute!.payload.user_id).toBe(77);
  });

  it('服務訊息 handler 不會攔截一般訊息（註冊順序正確）', async () => {
    const { bot, calls } = createTestBot();
    const member = { id: 88, is_bot: false, first_name: 'Normal' };

    // 一般訊息（無 new_chat_members）不該進 serviceMessage handler，
    // 也不該被刪除或觸發任何 API 呼叫
    await bot.handleUpdate(textUpdate(chatId, member, '哈囉'));

    expect(calls.filter((c) => c.method === 'deleteMessage')).toHaveLength(0);
  });
});
