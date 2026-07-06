import { config } from '../config.js';

export interface JoinFloodOptions {
  windowMs: number;
  maxJoins: number;
  cooldownMs: number;
}

export interface JoinFloodResult {
  inAlert: boolean;     // 本次加入落在戒備模式，應踢出
  justEntered: boolean; // 剛觸發戒備，應發通知
}

interface ChatState {
  joins: number[];    // 加入時間戳（epoch 毫秒）
  alertUntil: number; // 戒備截止時間，0 表示未戒備
}

const states = new Map<number, ChatState>();

export function recordJoin(
  chatId: number,
  opts: JoinFloodOptions = {
    windowMs: config.joinFloodWindowMs,
    maxJoins: config.joinFloodMaxJoins,
    cooldownMs: config.joinFloodCooldownMs,
  }
): JoinFloodResult {
  const now = Date.now();
  const state = states.get(chatId) ?? { joins: [], alertUntil: 0 };

  state.joins = state.joins.filter((ts) => now - ts < opts.windowMs);
  state.joins.push(now);

  const wasAlert = now < state.alertUntil;
  if (state.joins.length > opts.maxJoins) {
    // 每次觸發都刷新冷卻：持續湧入時戒備不會中途解除
    state.alertUntil = now + opts.cooldownMs;
  }
  const inAlert = now < state.alertUntil;

  states.set(chatId, state);
  return { inAlert, justEntered: inAlert && !wasAlert };
}
