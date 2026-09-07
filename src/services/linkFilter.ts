import type { Message, MessageEntity } from 'grammy/types';

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
// `/start@SomeBot` 這種帶 @ 的指令是 bot_command entity 而非 mention，
// 但點下去一樣會開啟那個 bot，一併視為 bot 提及；指向本 bot 的指令除外。
export function containsBotMention(
  text: string,
  entities: readonly MessageEntity[] = [],
  ownBotUsername?: string
): boolean {
  return entities.some((entity) => {
    if (entity.type === 'text_mention') return entity.user.is_bot;
    // entity 的 offset/length 以 UTF-16 code unit 計算，與 JS 字串索引一致
    const slice = text.slice(entity.offset, entity.offset + entity.length);
    if (entity.type === 'mention') return /bot$/i.test(slice);
    if (entity.type === 'bot_command') {
      const at = slice.indexOf('@');
      if (at === -1) return false;
      const target = slice.slice(at + 1);
      return !ownBotUsername || target.toLowerCase() !== ownBotUsername.toLowerCase();
    }
    return false;
  });
}

// 訊息本身就是可點擊的外部入口，不需要文字裡有連結：
// - 轉發：來源頻道／使用者的標頭可點擊，純圖片轉發也能宣傳
// - via_bot：透過 inline bot 送出的內容，標頭就是那個 bot
// - inline keyboard：一般使用者無法自帶按鈕，會出現代表是 inline bot 產生的內容，
//   按鈕可帶 URL 或觸發其他 bot
export function containsExternalCarrier(msg: Message): boolean {
  if (msg.forward_origin) return true;
  if (msg.via_bot) return true;
  if (msg.reply_markup?.inline_keyboard?.some((row) => row.length > 0)) return true;
  return false;
}

// 新成員在限制期內不得發送的內容：連結、@bot 提及、以及上述外部載體。
export function containsRestrictedContent(msg: Message, ownBotUsername?: string): boolean {
  const text = msg.text || msg.caption || '';
  const entities = msg.entities ?? msg.caption_entities ?? [];
  return (
    containsLink(text, entities) ||
    containsBotMention(text, entities, ownBotUsername) ||
    containsExternalCarrier(msg)
  );
}
