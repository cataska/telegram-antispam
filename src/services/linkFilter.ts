import type { MessageEntity } from 'grammy/types';

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+/i;

// 藏在顯示文字底下的超連結（text_link）在純文字裡看不到，
// 廣告訊息常用這招；entity 由 Telegram 標好，直接讀比 regex 可靠。
const LINK_ENTITY_TYPES = new Set<MessageEntity['type']>(['url', 'text_link']);

export function containsLink(text: string, entities: readonly MessageEntity[] = []): boolean {
  if (entities.some((entity) => LINK_ENTITY_TYPES.has(entity.type))) return true;
  return URL_REGEX.test(text);
}

// @bot 提及點一下就開啟該 bot 對話，效果等同連結，是廣告繞過連結過濾的載體。
// 只認 bot（Telegram 規定 bot 帳號名必須以 bot 結尾）：@一般人是群內正常行為。
export function containsBotMention(
  text: string,
  entities: readonly MessageEntity[] = []
): boolean {
  return entities.some((entity) => {
    if (entity.type === 'text_mention') return entity.user.is_bot;
    if (entity.type !== 'mention') return false;
    // entity 的 offset/length 以 UTF-16 code unit 計算，與 JS 字串索引一致
    const username = text.slice(entity.offset, entity.offset + entity.length);
    return /bot$/i.test(username);
  });
}
