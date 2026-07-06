import { describe, it, expect } from 'vitest';
import { containsLink } from './linkFilter.js';

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
