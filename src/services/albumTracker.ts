// Telegram 把相簿拆成多則幾乎同時抵達的訊息，通常只有其中一則帶 caption。
// 連結過濾只會命中那一則；其餘圖片若留在群裡，廣告圖等於照樣發出去了。
// 這裡記住限制期內新成員的相簿成員，命中時：
// - 已抵達的：用記下來的 message_id 一併補刪
// - 後抵達的：看到相簿已被標記就直接刪
// 相簿的訊息在幾秒內就會到齊，記錄只需保留很短的時間。

const ALBUM_TTL_MS = 60_000;

interface Album {
  messageIds: Set<number>;
  flagged: boolean;
  touchedAt: number;
}

const albums = new Map<string, Album>();

function key(chatId: number, mediaGroupId: string): string {
  return `${chatId}:${mediaGroupId}`;
}

function sweep(now: number) {
  for (const [k, album] of albums) {
    if (now - album.touchedAt >= ALBUM_TTL_MS) albums.delete(k);
  }
}

// 記下相簿中的一則訊息；回傳這個相簿是否已被判定違規。
export function trackAlbumMessage(
  chatId: number,
  mediaGroupId: string,
  messageId: number,
  now: number = Date.now()
): boolean {
  sweep(now);
  const k = key(chatId, mediaGroupId);
  let album = albums.get(k);
  if (!album) {
    album = { messageIds: new Set(), flagged: false, touchedAt: now };
    albums.set(k, album);
  }
  album.messageIds.add(messageId);
  album.touchedAt = now;
  return album.flagged;
}

// 把相簿標記為違規；回傳目前已記錄、除了 exceptMessageId 以外的訊息 id，供呼叫端補刪。
export function flagAlbum(
  chatId: number,
  mediaGroupId: string,
  exceptMessageId: number,
  now: number = Date.now()
): number[] {
  const k = key(chatId, mediaGroupId);
  let album = albums.get(k);
  if (!album) {
    album = { messageIds: new Set(), flagged: false, touchedAt: now };
    albums.set(k, album);
  }
  album.flagged = true;
  album.touchedAt = now;
  return [...album.messageIds].filter((id) => id !== exceptMessageId);
}

export function _resetAlbumTracker() {
  albums.clear();
}
