export interface Config {
  verifyTimeoutMs: number;
  floodWindowMs: number;
  floodMaxMessages: number;
  floodMuteSeconds: number;
  joinFloodWindowMs: number;
  joinFloodMaxJoins: number;
  joinFloodCooldownMs: number;
  casEnabled: boolean;
  casTimeoutMs: number;
  adminMuteSeconds: number;
  linkRestrictWindowMs: number;
  dbPath: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`環境變數 ${name} 必須是正整數，收到：${raw}`);
  }
  return value;
}

// 與 positiveInt 的差別：允許 0，用來表示「停用該功能」
function nonNegativeInt(env: Env, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`環境變數 ${name} 必須是非負整數，收到：${raw}`);
  }
  return value;
}

function booleanFlag(env: Env, name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`環境變數 ${name} 必須是 true 或 false，收到：${raw}`);
}

export function loadConfig(env: Env = process.env): Config {
  return {
    verifyTimeoutMs: positiveInt(env, 'VERIFY_TIMEOUT_SECONDS', 180) * 1000,
    floodWindowMs: positiveInt(env, 'FLOOD_WINDOW_SECONDS', 5) * 1000,
    floodMaxMessages: positiveInt(env, 'FLOOD_MAX_MESSAGES', 5),
    floodMuteSeconds: positiveInt(env, 'FLOOD_MUTE_SECONDS', 300),
    joinFloodWindowMs: positiveInt(env, 'JOIN_FLOOD_WINDOW_SECONDS', 60) * 1000,
    joinFloodMaxJoins: positiveInt(env, 'JOIN_FLOOD_MAX_JOINS', 10),
    joinFloodCooldownMs: positiveInt(env, 'JOIN_FLOOD_COOLDOWN_SECONDS', 300) * 1000,
    casEnabled: booleanFlag(env, 'CAS_ENABLED', true),
    casTimeoutMs: positiveInt(env, 'CAS_TIMEOUT_MS', 3000),
    adminMuteSeconds: positiveInt(env, 'ADMIN_MUTE_SECONDS', 86_400),
    // 0 表示停用「新成員禁連結」
    linkRestrictWindowMs: nonNegativeInt(env, 'LINK_RESTRICT_HOURS', 24) * 3_600_000,
    dbPath: env.DB_PATH || './data/antispam.db',
  };
}

export const config = loadConfig();
