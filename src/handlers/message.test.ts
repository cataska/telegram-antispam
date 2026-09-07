import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleMessage } from './message.js';
import { openDb } from '../db.js';
import { initStores } from '../store/index.js';
import { recordMemberJoin } from '../store/members.js';
import { _resetAlbumTracker } from '../services/albumTracker.js';

interface CtxOptions {
  chatId: number;
  userId: number;
  chatType?: string;
  text?: string;
  mediaGroupId?: string;
  messageId?: number;
  memberStatus?: string;
  entities?: Array<Record<string, unknown>>;
  edited?: boolean;
  forwardOrigin?: Record<string, unknown>;
  viaBot?: Record<string, unknown>;
  replyMarkup?: Record<string, unknown>;
}

function makeCtx(opts: CtxOptions) {
  const msg = {
    message_id: opts.messageId ?? 1,
    text: opts.text ?? '',
    media_group_id: opts.mediaGroupId,
    entities: opts.entities,
    forward_origin: opts.forwardOrigin,
    via_bot: opts.viaBot,
    reply_markup: opts.replyMarkup,
  };
  return {
    chat: { id: opts.chatId, type: opts.chatType ?? 'supergroup' },
    from: { id: opts.userId, first_name: 'Test' },
    me: { username: 'test_bot' },
    msg,
    message: opts.edited ? undefined : msg,
    editedMessage: opts.edited ? msg : undefined,
    deleteMessage: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue({}),
    api: {
      restrictChatMember: vi.fn().mockResolvedValue(true),
      deleteMessages: vi.fn().mockResolvedValue(true),
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
    initStores(openDb(':memory:'));
    _resetAlbumTracker();
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

  it('限制期內的新成員發連結會被刪除', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({ chatId, userId, text: '快來 https://spam.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('先潛伏、通過驗證後才發廣告仍會被擋（限制期未過）', async () => {
    // 加入已 12 小時：早就通過驗證、沒有 pending 記錄，但仍在 24 小時限制期內
    recordMemberJoin(chatId, userId, Date.now() - 12 * 3_600_000);
    const ctx = makeCtx({ chatId, userId, text: '福利群 t.me/spamgroup' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('藏在顯示文字底下的連結（text_link）也會被刪', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '點我看好康',
      entities: [{ type: 'text_link', offset: 0, length: 5, url: 'https://spam.example.com' }],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('限制期內的新成員把訊息編輯成含連結也會被刪除（先發無害文字再改成廣告）', async () => {
    recordMemberJoin(chatId, userId, Date.now() - 3 * 3_600_000);
    const ctx = makeCtx({ chatId, userId, edited: true, text: '改好了 https://spam.example.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('編輯訊息不計入洪水偵測', async () => {
    const next = vi.fn();
    let ctx;
    for (let i = 0; i < 10; i++) {
      ctx = makeCtx({ chatId, userId, edited: true, text: `修改 ${i}` });
      await handleMessage(ctx, next);
    }

    expect(ctx.api.restrictChatMember).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(10);
  });

  it('限制期內的新成員發 @bot 提及會被刪除（廣告改用 bot 提及繞過連結過濾）', async () => {
    // 通過驗證後潛伏 5 小時，再發只含 @bot 提及、不含連結的廣告
    recordMemberJoin(chatId, userId, Date.now() - 5 * 3_600_000);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '@uyqhdlbot @koeufkafbot',
      entities: [
        { type: 'mention', offset: 0, length: 10 },
        { type: 'mention', offset: 11, length: 12 },
      ],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('限制期內的新成員發 /start@SomeBot 指令會被刪除（bot_command 形式的 bot 提及）', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '/start@SpamCollectible',
      entities: [{ type: 'bot_command', offset: 0, length: 22 }],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('限制期內的新成員對本 bot 下指令不會被刪', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '/help@test_bot',
      entities: [{ type: 'bot_command', offset: 0, length: 14 }],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  it('限制期內的新成員轉發訊息會被刪除（轉發來源標頭可點擊）', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '看看這個',
      forwardOrigin: { type: 'channel', chat: { id: -100999, type: 'channel' }, message_id: 1, date: 0 },
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('限制期內的新成員透過 inline bot 送出的內容會被刪除', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '結果',
      viaBot: { id: 7, is_bot: true, first_name: 'Inline', username: 'inlinebot' },
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('限制期內的新成員訊息帶按鈕會被刪除', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '點下面',
      replyMarkup: { inline_keyboard: [[{ text: '進入', url: 'https://spam.example.com' }]] },
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it('限制期已過的成員轉發訊息不受影響', async () => {
    recordMemberJoin(chatId, userId, Date.now() - 25 * 3_600_000);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '轉一下',
      forwardOrigin: { type: 'user', sender_user: { id: 5, is_bot: false, first_name: 'A' }, date: 0 },
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  it('相簿只有一張帶連結 caption：整組相簿都會被刪，含先到與後到的圖片', async () => {
    recordMemberJoin(chatId, userId);
    const next = vi.fn();

    // 前兩張沒有 caption，先抵達
    for (const id of [101, 102]) {
      const ctx = makeCtx({ chatId, userId, mediaGroupId: 'ad-album', messageId: id });
      await handleMessage(ctx, next);
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    }

    // 第三張帶廣告 caption
    const hit = makeCtx({
      chatId,
      userId,
      mediaGroupId: 'ad-album',
      messageId: 103,
      text: '加入 t.me/spamgroup',
    });
    await handleMessage(hit, next);
    expect(hit.deleteMessage).toHaveBeenCalled();
    expect(hit.api.deleteMessages).toHaveBeenCalledWith(chatId, [101, 102]);

    // 第四張晚到、沒有 caption，也要刪
    const late = makeCtx({ chatId, userId, mediaGroupId: 'ad-album', messageId: 104 });
    await handleMessage(late, next);
    expect(late.deleteMessage).toHaveBeenCalled();
  });

  it('限制期內正常的相簿不會被刪', async () => {
    recordMemberJoin(chatId, userId);
    const next = vi.fn();
    for (const id of [201, 202, 203]) {
      const ctx = makeCtx({ chatId, userId, mediaGroupId: 'ok-album', messageId: id, text: id === 201 ? '出遊照片' : '' });
      await handleMessage(ctx, next);
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    }
  });

  it('限制期內的新成員 @一般人不會被刪', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '@someone 請問這裡可以問問題嗎',
      entities: [{ type: 'mention', offset: 0, length: 8 }],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('限制期已過的成員發 @bot 提及不受影響', async () => {
    recordMemberJoin(chatId, userId, Date.now() - 25 * 3_600_000);
    const ctx = makeCtx({
      chatId,
      userId,
      text: '@somebot 查一下',
      entities: [{ type: 'mention', offset: 0, length: 8 }],
    });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('限制期已過的成員發連結不受影響', async () => {
    recordMemberJoin(chatId, userId, Date.now() - 25 * 3_600_000);
    const ctx = makeCtx({ chatId, userId, text: '分享 https://example.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('bot 進群前就在的老成員（無加入記錄）發連結不受影響', async () => {
    const ctx = makeCtx({ chatId, userId, text: '分享 https://example.com' });
    const next = vi.fn();

    await handleMessage(ctx, next);

    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('管理員在限制期內發連結不會被刪', async () => {
    recordMemberJoin(chatId, userId);
    const ctx = makeCtx({
      chatId,
      userId,
      memberStatus: 'administrator',
      text: '公告 https://example.com',
    });
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
