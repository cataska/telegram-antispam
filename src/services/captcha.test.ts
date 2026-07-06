import { describe, it, expect } from 'vitest';
import { generateCaptcha } from './captcha.js';

describe('generateCaptcha', () => {
  it('選項洗牌後仍是原選項的排列，且包含正確答案', () => {
    for (let i = 0; i < 100; i++) {
      const captcha = generateCaptcha();
      expect(captcha.options).toHaveLength(4);
      expect(new Set(captcha.options).size).toBe(4);
      expect(captcha.options).toContain(captcha.correctAnswer);
    }
  });
});
