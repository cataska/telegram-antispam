import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCasBanned } from './cas.js';

const opts = { enabled: true, timeoutMs: 3000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCasBanned', () => {
  it('CAS 回傳 ok=true 視為命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { offenses: 3 } }),
    }));
    expect(await isCasBanned(42, opts)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cas.chat/check?user_id=42',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('CAS 回傳 ok=false 視為未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Record not found.' }),
    }));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('查詢失敗時 fail-open 回傳未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('HTTP 非 2xx 視為未命中', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    expect(await isCasBanned(42, opts)).toBe(false);
  });

  it('停用時不發出查詢', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await isCasBanned(42, { enabled: false, timeoutMs: 3000 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
