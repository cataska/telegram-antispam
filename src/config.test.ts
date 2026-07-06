import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('無環境變數時使用預設值', () => {
    const config = loadConfig({});
    expect(config.verifyTimeoutMs).toBe(180_000);
    expect(config.floodWindowMs).toBe(5_000);
    expect(config.floodMaxMessages).toBe(5);
    expect(config.floodMuteSeconds).toBe(300);
    expect(config.joinFloodWindowMs).toBe(60_000);
    expect(config.joinFloodMaxJoins).toBe(10);
    expect(config.joinFloodCooldownMs).toBe(300_000);
    expect(config.casEnabled).toBe(true);
    expect(config.casTimeoutMs).toBe(3000);
    expect(config.adminMuteSeconds).toBe(86_400);
    expect(config.dbPath).toBe('./data/antispam.db');
  });

  it('環境變數可覆寫預設值', () => {
    const config = loadConfig({
      VERIFY_TIMEOUT_SECONDS: '60',
      JOIN_FLOOD_MAX_JOINS: '20',
      CAS_ENABLED: 'false',
      DB_PATH: '/tmp/test.db',
    });
    expect(config.verifyTimeoutMs).toBe(60_000);
    expect(config.joinFloodMaxJoins).toBe(20);
    expect(config.casEnabled).toBe(false);
    expect(config.dbPath).toBe('/tmp/test.db');
  });

  it('非法數值直接拋錯（fail-fast）', () => {
    expect(() => loadConfig({ VERIFY_TIMEOUT_SECONDS: 'abc' })).toThrow('VERIFY_TIMEOUT_SECONDS');
    expect(() => loadConfig({ FLOOD_MAX_MESSAGES: '-1' })).toThrow('FLOOD_MAX_MESSAGES');
    expect(() => loadConfig({ CAS_ENABLED: 'yes' })).toThrow('CAS_ENABLED');
  });
});
