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

describe('generateCaptcha：執行期生成', () => {
  it('題目是可解的算式，答案與算式相符且非負', () => {
    for (let i = 0; i < 200; i++) {
      const { question, correctAnswer } = generateCaptcha();
      const match = question.match(/^(\d+) ([+-]) (\d+) = \?$/);
      expect(match).not.toBeNull();

      const [, left, op, right] = match!;
      const expected = op === '+' ? Number(left) + Number(right) : Number(left) - Number(right);
      expect(Number(correctAnswer)).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(0);
    }
  });

  it('選項皆為非負整數', () => {
    for (let i = 0; i < 200; i++) {
      for (const option of generateCaptcha().options) {
        expect(Number(option)).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(Number(option))).toBe(true);
      }
    }
  });

  it('題目不是固定的少數幾題', () => {
    const questions = new Set<string>();
    for (let i = 0; i < 200; i++) questions.add(generateCaptcha().question);
    expect(questions.size).toBeGreaterThan(50);
  });
});
