import type { MessageEntity } from 'grammy/types';

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+/i;

// 藏在顯示文字底下的超連結（text_link）在純文字裡看不到，
// 廣告訊息常用這招；entity 由 Telegram 標好，直接讀比 regex 可靠。
const LINK_ENTITY_TYPES = new Set<MessageEntity['type']>(['url', 'text_link']);

export function containsLink(text: string, entities: readonly MessageEntity[] = []): boolean {
  if (entities.some((entity) => LINK_ENTITY_TYPES.has(entity.type))) return true;
  return URL_REGEX.test(text);
}
