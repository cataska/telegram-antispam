import { config } from '../config.js';

export interface CasOptions {
  enabled: boolean;
  timeoutMs: number;
}

// 查詢 CAS（Combot Anti-Spam）名單；查詢失敗一律視為未命中（fail-open），
// 避免 CAS 服務異常時擋住正常人入群
export async function isCasBanned(
  userId: number,
  opts: CasOptions = { enabled: config.casEnabled, timeoutMs: config.casTimeoutMs }
): Promise<boolean> {
  if (!opts.enabled) return false;

  try {
    const res = await fetch(`https://api.cas.chat/check?user_id=${userId}`, {
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch (e) {
    console.log(`[CAS] 查詢失敗，視為未命中：${e}`);
    return false;
  }
}
