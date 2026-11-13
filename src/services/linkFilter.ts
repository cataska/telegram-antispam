import type { InlineKeyboardButton, Message, MessageEntity } from 'grammy/types';

const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+/i;

// 藏在顯示文字底下的超連結（text_link）在純文字裡看不到，
// 廣告訊息常用這招；entity 由 Telegram 標好，直接讀比 regex 可靠。
const LINK_ENTITY_TYPES = new Set<MessageEntity['type']>(['url', 'text_link']);

export function containsLink(text: string, entities: readonly MessageEntity[] = []): boolean {
  if (entities.some((entity) => LINK_ENTITY_TYPES.has(entity.type))) return true;
  return URL_REGEX.test(text);
}

// 顯示名稱不會被 Telegram 標 entity，廣告帳號寫的也多半是不帶 http 的裸網域
// （例：「不降智AI中转站（gptzzz.ai）」），URL_REGEX 抓不到。
// 只認常見 TLD：任意「字.字」會誤判 "J.Smith"、"Mr.Lin" 這類正常名字。
const BARE_DOMAIN_REGEX =
  /(?<![a-z0-9@.-])(?:t\.me|[a-z0-9-]{2,}\.(?:com|net|org|io|ai|cc|xyz|top|vip|app|dev|shop|site|info|biz|tv|cn|ru|tw|hk|gg|icu|club|online|link))(?![a-z0-9-])/i;

// 顯示名稱本身就是廣告：名字會出現在成員列表、每則訊息的標頭與推播通知上，
// 發一句無害的純文字就能把網址送到所有人眼前。
export function nameContainsLink(user: { first_name: string; last_name?: string }): boolean {
  const name = `${user.first_name} ${user.last_name ?? ''}`;
  return URL_REGEX.test(name) || BARE_DOMAIN_REGEX.test(name);
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

// 會把人帶離群組的按鈕：開網址、登入、小程式、切換到 inline bot。
// callback、複製文字、付款等按鈕留在原地，不算。
function opensExternal(button: InlineKeyboardButton): boolean {
  return (
    'url' in button ||
    'login_url' in button ||
    'web_app' in button ||
    'switch_inline_query' in button ||
    'switch_inline_query_current_chat' in button ||
    'switch_inline_query_chosen_chat' in button
  );
}

// 訊息本身就是可點擊的外部入口，不需要文字裡有連結：
// - 轉發：來源頻道／使用者的標頭可點擊，純圖片轉發也能宣傳
// - via_bot：透過 inline bot 送出的內容，標頭就是那個 bot
// - guest bot 代發：訊息的發送者就是那個 bot
// - rich_message：只有 bot 能送，內容結構自帶連結與按鈕，出現即代表 bot 產生的內容
// - contact：聯絡人卡片附「傳訊息／加入聯絡人」按鈕，點下去直接開私訊，
//   名稱欄位就是廣告詞（例：「免稅香烟全网最低价」+ 電話）
// - inline keyboard 裡會開外部目標的按鈕
export function containsExternalCarrier(msg: Message): boolean {
  if (msg.forward_origin) return true;
  if (msg.via_bot) return true;
  if (msg.guest_bot_caller_user || msg.guest_bot_caller_chat) return true;
  if (msg.rich_message) return true;
  if (msg.contact) return true;
  if (msg.reply_markup?.inline_keyboard?.some((row) => row.some(opensExternal))) return true;
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
