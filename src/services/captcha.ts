export interface Captcha {
  question: string;
  options: string[];
  correctAnswer: string;
}

const QUESTIONS: Captcha[] = [
  {
    question: '1 + 1 = ?',
    options: ['1', '2', '3', '4'],
    correctAnswer: '2',
  },
  {
    question: '3 + 2 = ?',
    options: ['4', '5', '6', '7'],
    correctAnswer: '5',
  },
  {
    question: '5 - 3 = ?',
    options: ['1', '2', '3', '4'],
    correctAnswer: '2',
  },
  {
    question: '2 × 3 = ?',
    options: ['5', '6', '7', '8'],
    correctAnswer: '6',
  },
  {
    question: '8 ÷ 2 = ?',
    options: ['2', '3', '4', '5'],
    correctAnswer: '4',
  },
  {
    question: '哪個是水果？',
    options: ['蘋果', '椅子', '汽車', '電腦'],
    correctAnswer: '蘋果',
  },
  {
    question: '哪個是動物？',
    options: ['桌子', '貓咪', '手機', '書本'],
    correctAnswer: '貓咪',
  },
  {
    question: '天空是什麼顏色？',
    options: ['紅色', '綠色', '藍色', '黃色'],
    correctAnswer: '藍色',
  },
];

export function generateCaptcha(): Captcha {
  const index = Math.floor(Math.random() * QUESTIONS.length);
  const captcha = QUESTIONS[index];

  // 打亂選項順序
  const shuffledOptions = [...captcha.options].sort(() => Math.random() - 0.5);

  return {
    question: captcha.question,
    options: shuffledOptions,
    correctAnswer: captcha.correctAnswer,
  };
}
