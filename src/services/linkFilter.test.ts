import { describe, it, expect } from 'vitest';
import { containsLink, containsBotMention, containsExternalCarrier } from './linkFilter.js';

describe('containsLink', () => {
  it('偵測 http/https 連結', () => {
    expect(containsLink('看看這個 https://example.com')).toBe(true);
    expect(containsLink('http://spam.site/abc')).toBe(true);
  });

  it('偵測 www 與 t.me 連結', () => {
    expect(containsLink('www.example.com 很棒')).toBe(true);
    expect(containsLink('加入 t.me/somegroup')).toBe(true);
  });

  it('一般文字不誤判', () => {
    expect(containsLink('大家好，今天天氣不錯')).toBe(false);
    expect(containsLink('')).toBe(false);
  });

  it('連續檢測同一段文字結果一致（不受 regex lastIndex 影響）', () => {
    const text = 'https://spam.example.com';
    expect(containsLink(text)).toBe(true);
    expect(containsLink(text)).toBe(true);
    expect(containsLink(text)).toBe(true);
  });
});

describe('containsLink：entity', () => {
  it('偵測藏在顯示文字底下的超連結（text_link）', () => {
    expect(
      containsLink('點我看好康', [
        { type: 'text_link', offset: 0, length: 5, url: 'https://spam.example.com' },
      ])
    ).toBe(true);
  });

  it('偵測 Telegram 標記為 url 的 entity', () => {
    expect(containsLink('example.com/abc', [{ type: 'url', offset: 0, length: 15 }])).toBe(true);
  });

  it('@提及不算連結：群內 @人是正常行為', () => {
    expect(containsLink('@someone 早安', [{ type: 'mention', offset: 0, length: 8 }])).toBe(false);
  });

  it('一般格式 entity 不誤判', () => {
    expect(containsLink('大家好', [{ type: 'bold', offset: 0, length: 3 }])).toBe(false);
  });
});

describe('containsBotMention', () => {
  it('偵測 @bot 提及（使用者名稱以 bot 結尾）', () => {
    expect(
      containsBotMention('@uyqhdlbot @koeufkafbot', [
        { type: 'mention', offset: 0, length: 10 },
        { type: 'mention', offset: 11, length: 12 },
      ])
    ).toBe(true);
  });

  it('bot 結尾不分大小寫', () => {
    expect(
      containsBotMention('快加 @SpamBOT', [{ type: 'mention', offset: 3, length: 8 }])
    ).toBe(true);
  });

  it('@提及一般人不誤判：群內 @人是正常行為', () => {
    expect(
      containsBotMention('@someone 早安', [{ type: 'mention', offset: 0, length: 8 }])
    ).toBe(false);
  });

  it('偵測 text_mention 指向 bot 帳號', () => {
    expect(
      containsBotMention('點這個', [
        {
          type: 'text_mention',
          offset: 0,
          length: 3,
          user: { id: 1, is_bot: true, first_name: 'Spam' },
        },
      ])
    ).toBe(true);
  });

  it('text_mention 指向一般人不誤判', () => {
    expect(
      containsBotMention('叫他', [
        {
          type: 'text_mention',
          offset: 0,
          length: 2,
          user: { id: 2, is_bot: false, first_name: 'Someone' },
        },
      ])
    ).toBe(false);
  });

  it('純文字裡出現 bot 字樣不誤判', () => {
    expect(containsBotMention('這個 bot 很好用')).toBe(false);
  });

  it('偵測帶 @ 的指令（/start@SomeBot 點下去會開啟那個 bot，即使名稱不以 bot 結尾）', () => {
    expect(
      containsBotMention('/start@SpamCollectible', [{ type: 'bot_command', offset: 0, length: 22 }])
    ).toBe(true);
  });

  it('指向本 bot 的指令不算（不分大小寫）', () => {
    expect(
      containsBotMention('/help@Test_Bot', [{ type: 'bot_command', offset: 0, length: 14 }], 'test_bot')
    ).toBe(false);
  });

  it('不帶 @ 的指令不算', () => {
    expect(containsBotMention('/help', [{ type: 'bot_command', offset: 0, length: 5 }])).toBe(false);
  });
});

describe('containsExternalCarrier', () => {
  const base = { message_id: 1, date: 0, chat: { id: 1, type: 'supergroup' as const, title: 't' } };

  it('轉發訊息算外部載體', () => {
    expect(
      containsExternalCarrier({
        ...base,
        text: 'x',
        forward_origin: { type: 'hidden_user', sender_user_name: 'X', date: 0 },
      })
    ).toBe(true);
  });

  it('透過 inline bot 送出的訊息算外部載體', () => {
    expect(
      containsExternalCarrier({
        ...base,
        text: 'x',
        via_bot: { id: 7, is_bot: true, first_name: 'Inline' },
      })
    ).toBe(true);
  });

  it('帶 inline keyboard 的訊息算外部載體', () => {
    expect(
      containsExternalCarrier({
        ...base,
        text: 'x',
        reply_markup: { inline_keyboard: [[{ text: 'go', url: 'https://x.example' }]] },
      })
    ).toBe(true);
  });

  it('只有 callback 按鈕的 inline keyboard 不算', () => {
    expect(
      containsExternalCarrier({
        ...base,
        text: 'x',
        reply_markup: { inline_keyboard: [[{ text: 'ok', callback_data: 'ok' }]] },
      })
    ).toBe(false);
  });

  it('guest bot 代發的訊息算外部載體', () => {
    expect(
      containsExternalCarrier({
        ...base,
        text: 'x',
        guest_bot_caller_user: { id: 3, is_bot: false, first_name: 'C' },
      })
    ).toBe(true);
  });

  it('rich message 算外部載體（只有 bot 能送）', () => {
    expect(containsExternalCarrier({ ...base, rich_message: { blocks: [] } })).toBe(true);
  });

  it('一般文字訊息不算', () => {
    expect(containsExternalCarrier({ ...base, text: '早安' })).toBe(false);
  });
});
