import { describe, it, expect, beforeEach } from 'vitest';
import { trackAlbumMessage, flagAlbum, _resetAlbumTracker } from './albumTracker.js';

describe('albumTracker', () => {
  beforeEach(() => _resetAlbumTracker());

  it('未標記的相簿回傳 false', () => {
    expect(trackAlbumMessage(1, 'a', 10)).toBe(false);
    expect(trackAlbumMessage(1, 'a', 11)).toBe(false);
  });

  it('標記後回傳先前記錄的其他訊息 id，之後抵達的訊息看得到標記', () => {
    trackAlbumMessage(1, 'a', 10);
    trackAlbumMessage(1, 'a', 11);
    trackAlbumMessage(1, 'a', 12);

    expect(flagAlbum(1, 'a', 12)).toEqual([10, 11]);
    expect(trackAlbumMessage(1, 'a', 13)).toBe(true);
  });

  it('不同群組或不同相簿互不影響', () => {
    trackAlbumMessage(1, 'a', 10);
    flagAlbum(1, 'a', 10);

    expect(trackAlbumMessage(2, 'a', 20)).toBe(false);
    expect(trackAlbumMessage(1, 'b', 30)).toBe(false);
  });

  it('沒記錄過的相簿也能直接標記', () => {
    expect(flagAlbum(1, 'x', 5)).toEqual([]);
    expect(trackAlbumMessage(1, 'x', 6)).toBe(true);
  });

  it('沉寂超過一分鐘的相簿記錄會被清掉', () => {
    const t0 = 1_000_000;
    trackAlbumMessage(1, 'a', 10, t0);
    flagAlbum(1, 'a', 10, t0);

    expect(trackAlbumMessage(1, 'a', 11, t0 + 61_000)).toBe(false);
  });
});
