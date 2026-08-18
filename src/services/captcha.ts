export interface Captcha {
  question: string;
  options: string[];
  correctAnswer: string;
}

const OPTION_COUNT = 4;

function randomInt(min: number, maxInclusive: number): number {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  // Fisher–Yates
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 執行期隨機生成算式，而非從固定題庫抽。
// 固定題庫即使洗牌選項，題目與答案文字仍是有限集合，
// 針對性腳本一次就能把答案全部硬編碼。
export function generateCaptcha(): Captcha {
  let question: string;
  let answer: number;

  if (Math.random() < 0.5) {
    const a = randomInt(2, 19);
    const b = randomInt(2, 19);
    question = `${a} + ${b} = ?`;
    answer = a + b;
  } else {
    const a = randomInt(6, 20);
    const b = randomInt(1, a - 1); // 保證答案為正數
    question = `${a} - ${b} = ?`;
    answer = a - b;
  }

  // 干擾項取答案附近的數字：夠接近，隨手亂點猜不中，又不會出現負數選項
  const distractors = new Set<number>();
  while (distractors.size < OPTION_COUNT - 1) {
    const offset = randomInt(1, 5) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = answer + offset;
    if (candidate >= 0 && candidate !== answer) distractors.add(candidate);
  }

  return {
    question,
    options: shuffle([answer, ...distractors]).map(String),
    correctAnswer: String(answer),
  };
}
