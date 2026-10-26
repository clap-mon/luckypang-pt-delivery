export type QuizDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface QuizOption {
  id: string;
  text: string;
  isCorrect: boolean;
  isLotto: boolean;
  isBomb: boolean;
  description?: string;
}

export interface Quiz {
  quiz_id: string;
  question_text: string;
  options: QuizOption[];
  difficulty: QuizDifficulty;
}

// ── 시드 기반 결정론적 RNG (mulberry32) ──────────────────────────
// 같은 시드에서는 항상 같은 난수 시퀀스가 생성됩니다.
// 교사와 학생이 같은 라운드에서 항상 동일한 문제를 받습니다.
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

// 라운드 번호와 방 코드를 결합하여 매 방마다 고유하고 결정론적인 시드 생성
function seedForRound(round: number, roomCode: string = ""): number {
  let hash = 0;
  const str = `${roomCode}_round_${round}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return (hash * 2654435761) >>> 0;
}

// 1. 최대공약수 구하기
export function getGcd(a: number, b: number): number {
  return b === 0 ? a : getGcd(b, a % b);
}

// 2. 최소공배수 구하기
export function getLcm(a: number, b: number): number {
  return (a * b) / getGcd(a, b);
}

// 3. 약수 목록 구하기
export function getFactors(n: number): number[] {
  const factors: number[] = [];
  for (let i = 1; i <= Math.sqrt(n); i++) {
    if (n % i === 0) {
      factors.push(i);
      if (i !== n / i) {
        factors.push(n / i);
      }
    }
  }
  return factors.sort((a, b) => a - b);
}

// 4. 피셔-예이츠 셔플 (rng 파라미터로 결정론적 셔플 가능)
export function shuffleOptions(optionsArray: QuizOption[], rng?: () => number): QuizOption[] {
  const rand = rng ?? Math.random;
  const shuffled = [...optionsArray];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 5. 3개의 정답 보기 중 무작위로 1개를 럭키팡 정답(isLotto: true)으로 지정하는 함수
export function assignLottoAnswer(options: QuizOption[], rng: () => number) {
  const correctIndices: number[] = [];
  options.forEach((opt, idx) => {
    opt.isLotto = false;
    if (opt.isCorrect) {
      correctIndices.push(idx);
    }
  });

  if (correctIndices.length > 0) {
    const lottoIdx = correctIndices[Math.floor(rng() * correctIndices.length)];
    options[lottoIdx].isLotto = true;
  }
}

// [신규 패턴 - 쉬움 1] 단순 약수 고르기
export function generateSimpleFactorQuiz(quizId: string, rng: () => number): Quiz {
  let N = 0;
  let validFactors: number[] = [];
  while (true) {
    N = Math.floor(rng() * 89) + 12; // 12 ~ 100
    const allFactors = getFactors(N);
    validFactors = allFactors.filter(f => f !== 1 && f !== N);
    if (validFactors.length >= 3) break;
  }

  const pickedAnswers = [...validFactors].sort(() => 0.5 - rng()).slice(0, 3);

  let wrong1 = 0;
  while (true) {
    wrong1 = Math.floor(rng() * 89) + 2;
    if (N % wrong1 !== 0) break;
  }

  // 폭탄 오답 무작위 다양화 (N*2, N*3, N+1 등 약수가 아닌 오답)
  const bombCandidates = [N * 2, N * 3, N + 1, Math.max(2, N - 1)].filter(x => N % x !== 0);
  const bomb = bombCandidates[Math.floor(rng() * bombCandidates.length)] || N * 2;

  const options: QuizOption[] = [
    {
      id: "opt_sfac_1",
      text: `${pickedAnswers[0]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[0]} × ${N / pickedAnswers[0]} = ${N} 이므로, ${pickedAnswers[0]}은(는) ${N}을(를) ${N / pickedAnswers[0]}의 몫으로 나누어 떨어지게 하는 약수입니다.`
    },
    {
      id: "opt_sfac_2",
      text: `${pickedAnswers[1]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[1]} × ${N / pickedAnswers[1]} = ${N} 이므로, ${pickedAnswers[1]}은(는) ${N}을(를) ${N / pickedAnswers[1]}의 몫으로 나누어 떨어지게 하는 약수입니다.`
    },
    {
      id: "opt_sfac_3",
      text: `${pickedAnswers[2]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[2]} × ${N / pickedAnswers[2]} = ${N} 이므로, ${pickedAnswers[2]}은(는) ${N}을(를) ${N / pickedAnswers[2]}의 몫으로 나누어 떨어지게 하는 약수가 맞습니다.`
    },
    {
      id: "opt_sfac_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `${wrong1}은(는) 어떠한 수를 곱해도 ${N}이 될 수 없으며, ${N} ÷ ${wrong1} = ${Math.floor(N / wrong1)} (나머지 ${N % wrong1})로 나누어 떨어지지 않으므로 약수가 아닙니다.`
    },
    {
      id: "opt_sfac_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) ${N}의 약수가 아닙니다. 약수는 나누어 떨어지게 하는 수이고, ${bomb}은(는) ${N}을(를) 나누어 떨어지게 하지 못하므로 오답입니다. (오류)`
    }
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `숫자 [ ${N} ] 의 약수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "EASY"
  };
}

// [신규 패턴 - 쉬움 2] 단순 배수 고르기
export function generateSimpleMultipleQuiz(quizId: string, rng: () => number): Quiz {
  const N = Math.floor(rng() * 13) + 3; // 3 ~ 15

  const multipliers = [2, 3, 4, 5, 6].sort(() => 0.5 - rng());
  const pickedAnswers = [
    N * multipliers[0],
    N * multipliers[1],
    N * multipliers[2]
  ];

  let wrong1 = 0;
  const factors = getFactors(N).filter(f => f !== 1 && f !== N);
  if (factors.length > 0) {
    wrong1 = factors[Math.floor(rng() * factors.length)];
  } else {
    wrong1 = N - 1 > 1 ? N - 1 : N + 1;
  }

  // 폭탄 오답 무작위 다양화 (배수가 아닌 인접 오답 수)
  const multBase = Math.floor(rng() * 3) + 2;
  const offset = rng() < 0.5 ? 1 : -1;
  const bomb = N * multBase + offset;

  const options: QuizOption[] = [
    {
      id: "opt_smul_1",
      text: `${pickedAnswers[0]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[0]}은(는) ${N}에 ${multipliers[0]}을(를) 곱한 수이므로 ${N}의 배수입니다.`
    },
    {
      id: "opt_smul_2",
      text: `${pickedAnswers[1]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[1]}은(는) ${N}에 ${multipliers[1]}을(를) 곱한 수이므로 ${N}의 배수입니다.`
    },
    {
      id: "opt_smul_3",
      text: `${pickedAnswers[2]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${pickedAnswers[2]}은(는) ${N}에 ${multipliers[2]}을(를) 곱한 수이므로 ${N}의 배수가 맞습니다.`
    },
    {
      id: "opt_smul_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `${wrong1}은(는) ${N}의 약수(나누어 떨어지게 하는 수)입니다. 배수를 구하는 문제이므로 잘못된 답입니다.`
    },
    {
      id: "opt_smul_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) ${N}의 배수가 아닙니다. 배수는 ${N}으로 나누어 떨어져야 합니다. (오류)`
    }
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `숫자 [ ${N} ] 의 배수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "EASY"
  };
}

// [패턴 A] 곱셈식과 약수·배수 관계 문제 생성
export function generateRelationQuiz(quizId: string, rng: () => number): Quiz {
  let A = 0, B = 0, C = 0;
  while (true) {
    A = Math.floor(rng() * 15) + 3; // 3~17
    B = Math.floor(rng() * 15) + 3; // 3~17
    C = A * B;
    if (C <= 200 && A !== B) break;
  }

  const options: QuizOption[] = [
    {
      id: "opt_rel_1",
      text: `${C}은(는) ${A}의 배수입니다.`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${C}은(는) ${A}에 ${B}를 곱한 수이므로 ${A}의 배수가 맞습니다.`,
    },
    {
      id: "opt_rel_2",
      text: `${B}은(는) ${C}의 약수입니다.`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${C}을(를) ${B}로 나누면 딱 나누어 떨어지므로 ${B}은(는) ${C}의 약수입니다.`,
    },
    {
      id: "opt_rel_3",
      text: `${A}와(과) ${B}은(는) ${C}의 약수입니다.`,
      isCorrect: true,
      isLotto: true,
      isBomb: false,
      description: `${C}은(는) 두 수 ${A}와(과) ${B}의 곱으로 나타낼 수 있으므로, ${A}와(과) ${B} 둘 다 ${C}의 약수입니다.`,
    },
    {
      id: "opt_rel_4",
      text: `${C}은(는) ${A}의 약수입니다.`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `${C}은(는) ${A}의 배수입니다. 배수와 약수를 반대로 혼동하여 설명한 함정 보기입니다.`,
    },
    {
      id: "opt_rel_5",
      text: `${A}은(는) ${B}의 배수입니다.`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `서로 곱해지는 수인 ${A}와(과) ${B} 사이에는 아무런 약수나 배수 관계가 존재하지 않습니다. (오류)`,
    },
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `곱셈식 [ ${A} × ${B} = ${C} ] 을 보고, 약수와 배수의 관계를 나타낸 보기 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "NORMAL"
  };
}

// [패턴 A-2] 최대공약수와 공약수 관계 성질 문제 생성
export function generateGcdRelationQuiz(quizId: string, rng: () => number): Quiz {
  let G = 0, factorsOfG: number[] = [];
  while (true) {
    G = (Math.floor(rng() * 12) + 3) * 4; // 12~60 사이의 4의 배수
    factorsOfG = getFactors(G);
    const validGAnswers = factorsOfG.filter(f => f > 1 && f < G);
    if (validGAnswers.length >= 3) break;
  }

  const validAnswers = factorsOfG.filter(f => f > 1 && f < G);
  const pickedAnswers = [...validAnswers].sort(() => 0.5 - rng()).slice(0, 3);

  let wrong1 = 0;
  while (true) {
    wrong1 = Math.floor(rng() * (G - 2)) + 2;
    if (G % wrong1 !== 0) break;
  }
  const bombCandidates = [G * 2, G * 3, G + 1].filter(x => G % x !== 0);
  const bomb = bombCandidates[Math.floor(rng() * bombCandidates.length)] || G * 2;

  const options: QuizOption[] = [
    {
      id: "opt_gcdr_1",
      text: `${pickedAnswers[0]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수의 공약수는 최대공약수의 약수와 같습니다. 최대공약수 ${G}의 약수인 ${pickedAnswers[0]}은(는) 공약수가 맞습니다.`
    },
    {
      id: "opt_gcdr_2",
      text: `${pickedAnswers[1]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수의 공약수는 최대공약수의 약수와 같습니다. 최대공약수 ${G}의 약수인 ${pickedAnswers[1]}은(는) 공약수가 맞습니다.`
    },
    {
      id: "opt_gcdr_3",
      text: `${pickedAnswers[2]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `최대공약수와 공약수의 관계 성질에 의해, 최대공약수 ${G}의 약수인 ${pickedAnswers[2]}은(는) 올바른 공약수 정답입니다.`
    },
    {
      id: "opt_gcdr_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `두 수의 공약수는 최대공약수의 약수여야 합니다. ${wrong1}은(는) 최대공약수 ${G}의 약수가 아니므로 공약수가 될 수 없습니다.`
    },
    {
      id: "opt_gcdr_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) 최대공약수 ${G}의 약수가 아닙니다. 공약수는 최대공약수를 나누어 떨어지게 하는 약수여야 하므로 잘못된 오답입니다. (오류)`
    }
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `어떤 두 수의 최대공약수가 [ ${G} ] 일 때, 이 두 수의 공약수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "NORMAL"
  };
}

// [패턴 A-3] 최소공배수와 공배수 관계 성질 문제 생성
export function generateLcmRelationQuiz(quizId: string, rng: () => number): Quiz {
  let L = 0;
  while (true) {
    const X = Math.floor(rng() * 10) + 3; // 3~12
    const Y = Math.floor(rng() * 10) + 3; // 3~12
    if (X === Y) continue;
    L = getLcm(X, Y);
    if (L * 3 <= 200) break;
  }

  const ans1 = L;
  const ans2 = L * 2;
  const ans3 = L * 3;
  
  const factorsOfL = getFactors(L).filter(f => f > 1 && f < L);
  const wrong1 = factorsOfL.length > 0 ? factorsOfL[Math.floor(rng() * factorsOfL.length)] : 2;

  const bombCandidates = [L + 1, L + 2, Math.max(2, L - 1)].filter(x => x % L !== 0);
  const bomb = bombCandidates[Math.floor(rng() * bombCandidates.length)] || L + 1;

  const options: QuizOption[] = [
    {
      id: "opt_lcmr_1",
      text: `${ans1}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수의 공배수는 최소공배수의 배수와 같습니다. 최소공배수인 ${L}은(는) 공배수가 맞습니다.`
    },
    {
      id: "opt_lcmr_2",
      text: `${ans2}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수의 공배수는 최소공배수의 배수와 같습니다. 최소공배수 ${L}의 2배수인 ${ans2}은(는) 공배수가 맞습니다.`
    },
    {
      id: "opt_lcmr_3",
      text: `${ans3}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `공배수는 최소공배수의 배수들과 같습니다. 최소공배수 ${L}의 3배수인 ${ans3}은(는) 올바른 공배수 정답입니다.`
    },
    {
      id: "opt_lcmr_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `공배수는 최소공배수의 배수(더 곱해진 수)여야 합니다. 약수 방향의 작은 수인 ${wrong1}은(는) 공배수가 될 수 없습니다.`
    },
    {
      id: "opt_lcmr_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) 최소공배수 ${L}의 배수가 아닙니다. 공배수는 최소공배수로 나누어 떨어져야 합니다. (오류)`
    }
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `어떤 두 수의 최소공배수가 [ ${L} ] 일 때, 이 두 수의 공배수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "NORMAL"
  };
}

// [패턴 B] 공약수와 최대공약수 성질 문제 생성
export function generateGcdQuiz(quizId: string, rng: () => number): Quiz {
  let X = 0, Y = 0, G = 0, factorsOfG: number[] = [];
  let xOnlyFactors: number[] = [];

  while (true) {
    X = (Math.floor(rng() * 15) + 3) * 4; // 12~72 사이의 4의 배수
    Y = (Math.floor(rng() * 15) + 3) * 4; // 12~72 사이의 4의 배수
    if (X === Y) continue;

    G = getGcd(X, Y);
    factorsOfG = getFactors(G);

    const validGAnswers = factorsOfG.filter(f => f > 1);
    const factorsOfX = getFactors(X);
    xOnlyFactors = factorsOfX.filter(f => !factorsOfG.includes(f));

    if (validGAnswers.length >= 3 && xOnlyFactors.length >= 1) break;
  }

  const validAnswers = factorsOfG.filter(f => f > 1);
  const pickedAnswers = [...validAnswers].sort(() => 0.5 - rng()).slice(0, 3);

  const wrong1 = xOnlyFactors[Math.floor(rng() * xOnlyFactors.length)];
  const bomb = X > Y ? X * 2 : Y * 2;

  const options: QuizOption[] = [
    {
      id: "opt_gcd_1",
      text: `${pickedAnswers[0]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수 ${X}와(과) ${Y}의 최대공약수는 ${G}입니다. ${pickedAnswers[0]} × ${G / pickedAnswers[0]} = ${G} 이므로, ${pickedAnswers[0]}은(는) 최대공약수 ${G}의 약수이며, 따라서 두 수의 공약수가 맞습니다.`,
    },
    {
      id: "opt_gcd_2",
      text: `${pickedAnswers[1]}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `두 수 ${X}와(과) ${Y}의 최대공약수는 ${G}입니다. ${pickedAnswers[1]} × ${G / pickedAnswers[1]} = ${G} 이므로, ${pickedAnswers[1]}은(는) 최대공약수 ${G}의 약수이며, 따라서 공약수가 맞습니다.`,
    },
    {
      id: "opt_gcd_3",
      text: `${pickedAnswers[2]}`,
      isCorrect: true,
      isLotto: true,
      isBomb: false,
      description: `공약수는 최대공약수의 약수와 같습니다. 두 수의 최대공약수인 ${G}의 약수 중 ${pickedAnswers[2]} × ${G / pickedAnswers[2]} = ${G} 이므로, ${pickedAnswers[2]}은(는) 올바른 공약수 정답입니다.`,
    },
    {
      id: "opt_gcd_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `${wrong1}은(는) 두 수 중 ${X}의 약수(${wrong1} × ${X / wrong1} = ${X})이지만 ${Y}의 약수는 아닙니다. 공약수는 두 수 모두를 나누어 떨어지게 하는 공통된 약수여야 합니다.`,
    },
    {
      id: "opt_gcd_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) 공약수(나누는 수)가 아니라 공배수 방향으로 두 수보다 훨씬 큰 수입니다. 약수와 배수의 정의를 혼동한 함정입니다. (오류)`,
    },
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `두 수 [ ${X} ] 와(과) [ ${Y} ] 의 공약수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "HARD"
  };
}

// [패턴 C] 공배수와 최소공배수 성질 문제 생성
export function generateLcmQuiz(quizId: string, rng: () => number): Quiz {
  let X = 0, Y = 0, L = 0;

  while (true) {
    X = Math.floor(rng() * 12) + 3; // 3~14
    Y = Math.floor(rng() * 12) + 3; // 3~14
    if (X === Y) continue;
    L = getLcm(X, Y);
    if (L * 3 <= 200) break;
  }

  const ans1 = L;
  const ans2 = L * 2;
  const ans3 = L * 3;
  const G = getGcd(X, Y);
  const wrong1 = G;

  let bomb = 0;
  for (let i = 2; i < 20; i++) {
    const candidate = X * i;
    if (candidate % Y !== 0 && candidate !== wrong1) {
      bomb = candidate;
      break;
    }
  }
  if (bomb === 0) bomb = X * Y + 1;

  const options: QuizOption[] = [
    {
      id: "opt_lcm_1",
      text: `${ans1}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${ans1}은(는) 두 수 ${X}와(과) ${Y}의 최소공배수이므로 두 수의 공배수가 맞습니다.`,
    },
    {
      id: "opt_lcm_2",
      text: `${ans2}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `${ans2}은(는) 최소공배수인 ${L}의 2배수이므로 두 수의 공배수가 맞습니다. (공배수는 최소공배수의 배수)`,
    },
    {
      id: "opt_lcm_3",
      text: `${ans3}`,
      isCorrect: true,
      isLotto: false,
      isBomb: false,
      description: `공배수는 최소공배수의 배수들과 같습니다. 최소공배수인 ${L}의 3배수인 ${ans3}은(는) 올바른 공배수 정답입니다.`,
    },
    {
      id: "opt_lcm_4",
      text: `${wrong1}`,
      isCorrect: false,
      isLotto: false,
      isBomb: false,
      description: `${wrong1}은(는) 두 수 ${X}와(과) ${Y}의 최대공약수(약수)입니다. 공배수를 구해야 하는 문제에서 약수를 고른 오개념 함정입니다.`,
    },
    {
      id: "opt_lcm_5",
      text: `${bomb}`,
      isCorrect: false,
      isLotto: false,
      isBomb: true,
      description: `${bomb}은(는) 두 수 중 ${X}의 배수이지만 ${Y}의 배수는 아닙니다. 공배수는 두 수 모두의 배수여야 합니다. (오류)`,
    },
  ];

  assignLottoAnswer(options, rng);

  return {
    quiz_id: quizId,
    question_text: `두 수 [ ${X} ] 와(과) [ ${Y} ] 의 공배수 중 하나를 고르세요.`,
    options: shuffleOptions(options, rng),
    difficulty: "HARD"
  };
}

// 난이도별 퀴즈 생성기 (특정 난이도로 퀴즈를 무작위 생성하고자 할 때 활용)
export function generateQuizByDifficulty(quizId: string, difficulty: QuizDifficulty): Quiz {
  const rng = makePrng(Math.floor(Math.random() * 0xffffffff));
  if (difficulty === "EASY") {
    // 유형 1 (단순 약수·배수)
    return rng() < 0.5
      ? generateSimpleFactorQuiz(quizId, rng)
      : generateSimpleMultipleQuiz(quizId, rng);
  } else if (difficulty === "HARD") {
    // 유형 2 (공약수·공배수 연산)
    return rng() < 0.5
      ? generateGcdQuiz(quizId, rng)
      : generateLcmQuiz(quizId, rng);
  } else {
    // 유형 3 (약수·배수 관계 및 성질)
    const r = rng();
    if (r < 0.34) {
      return generateRelationQuiz(quizId, rng);
    } else if (r < 0.67) {
      return generateGcdRelationQuiz(quizId, rng);
    } else {
      return generateLcmRelationQuiz(quizId, rng);
    }
  }
}

// 라운드별 자동 동적 퀴즈 생성기 (통합 브릿지)
// ⚠️ 시드 기반 RNG 사용 → 같은 라운드 번호에서는 학생/교사 모두 동일한 문제 생성
export function generateQuizForRound(
  round: number,
  totalRounds: number = 10,
  difficultySetting: string = "normal", // "easy" | "normal" | "hard" | "mix"
  ratioSetting: string = "1:1:1", // "1:1:1" | "3:2:1" | "1:2:3"
  roomCode: string = ""
): Quiz {
  const quizId = `q_round_${round}`;
  const rng = makePrng(seedForRound(round, roomCode));

  // 난이도 판단 로직
  let chosenDifficulty: QuizDifficulty = "NORMAL";

  const diffLower = (difficultySetting || "normal").toLowerCase();

  if (diffLower === "easy") {
    chosenDifficulty = "EASY";
  } else if (diffLower === "normal") {
    chosenDifficulty = "NORMAL";
  } else if (diffLower === "hard") {
    chosenDifficulty = "HARD";
  } else if (diffLower === "mix") {
    // 믹스 모드일 때는 비율에 맞춰 각 라운드 인덱스별로 난이도를 결정론적으로 배치
    // 비율 파싱 (예: "3:2:1" -> [3, 2, 1])
    const parts = (ratioSetting || "1:1:1").split(":").map(Number);
    const sum = parts.reduce((a, b) => a + b, 0) || 6;
    
    // round 번호를 기준으로 sum으로 나눈 나머지를 이용하여 골고루 분포시킴
    // 0 ~ (parts[0]-1) 까지는 EASY
    // parts[0] ~ (parts[0]+parts[1]-1) 까지는 NORMAL
    // 그 외에는 HARD
    const targetIdx = (round - 1) % sum;
    if (targetIdx < parts[0]) {
      chosenDifficulty = "EASY";
    } else if (targetIdx < parts[0] + parts[1]) {
      chosenDifficulty = "NORMAL";
    } else {
      chosenDifficulty = "HARD";
    }
  }

  // 선택된 난이도에 해당하는 퀴즈 타입들을 결정론적으로 셔플하여 생성
  if (chosenDifficulty === "EASY") {
    // 유형 1 (단순 약수·배수)
    return rng() < 0.5
      ? generateSimpleFactorQuiz(quizId, rng)
      : generateSimpleMultipleQuiz(quizId, rng);
  } else if (chosenDifficulty === "HARD") {
    // 유형 2 (공약수·공배수 연산)
    return rng() < 0.5
      ? generateGcdQuiz(quizId, rng)
      : generateLcmQuiz(quizId, rng);
  } else {
    // 유형 3 (약수·배수 관계 및 성질)
    const r = rng();
    if (r < 0.34) {
      return generateRelationQuiz(quizId, rng);
    } else if (r < 0.67) {
      return generateGcdRelationQuiz(quizId, rng);
    } else {
      return generateLcmRelationQuiz(quizId, rng);
    }
  }
}

// ── 5. 익스트림 모드: 수학 미션 조건 추첨 엔진 ──────────────────────
export interface MathMission {
  id: number;
  title: string;
  badgeColor: string; // 'sky' | 'lemon' | 'pink' | 'purple'
  description: string;
  check: (num: number) => boolean;
}

export function generateMathMissions(roomCode: string = "default"): MathMission[] {
  let hash = 0;
  const seedStr = `${roomCode}_math_missions`;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash) || 12345;
  const rng = makePrng(seed);

  const candidatePool = [
    { title: "12의 약수인 수", badgeColor: "sky", check: (num: number) => 12 % num === 0 },
    { title: "5의 배수인 수", badgeColor: "lemon", check: (num: number) => num % 5 === 0 },
    { title: "18과 24의 공약수인 수", badgeColor: "pink", check: (num: number) => 18 % num === 0 && 24 % num === 0 },
    { title: "짝수이면서 4의 배수인 수", badgeColor: "purple", check: (num: number) => num % 2 === 0 && num % 4 === 0 },
    { title: "16의 약수인 수", badgeColor: "sky", check: (num: number) => 16 % num === 0 },
    { title: "3의 배수인 수", badgeColor: "lemon", check: (num: number) => num % 3 === 0 },
    { title: "12와 16의 공약수인 수", badgeColor: "pink", check: (num: number) => 12 % num === 0 && 16 % num === 0 },
    { title: "3과 4의 공배수인 수", badgeColor: "purple", check: (num: number) => num % 3 === 0 && num % 4 === 0 },
    { title: "20의 약수인 수", badgeColor: "sky", check: (num: number) => 20 % num === 0 },
    { title: "7의 배수인 수", badgeColor: "lemon", check: (num: number) => num % 7 === 0 },
  ];

  const shuffled = [...candidatePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, 4).map((m, idx) => ({
    id: idx + 1,
    title: m.title,
    badgeColor: m.badgeColor,
    description: `행운 규칙 ${idx + 1}: ${m.title}`,
    check: m.check,
  }));
}

// 미션 달성 수에 따른 보너스 점수 산출 규칙
export function calculateMissionPoints(clearedCount: number): number {
  switch (clearedCount) {
    case 1:
      return 100;
    case 2:
      return 300;
    case 3:
      return 600;
    case 4:
      return 1000;
    default:
      return 0;
  }
}

// 특정 티켓(숫자 배열)에 대해 주어진 미션 목록(missions)을 대조하여 달성 미션 수와 점수를 산출
export function calculateSingleTicketBonus(
  missions: MathMission[],
  numbers: number[]
): { clearedCount: number; score: number } {
  const uniqueCleared = new Set<number>();
  if (Array.isArray(numbers)) {
    numbers.forEach((num) => {
      missions.forEach((m) => {
        if (m.check(num)) uniqueCleared.add(m.id);
      });
    });
  }
  const clearedCount = uniqueCleared.size;
  return {
    clearedCount,
    score: calculateMissionPoints(clearedCount),
  };
}

// 방 코드와 티켓 목록을 전달받아 전체 티켓의 미션 보너스 총점을 계산 (교사는 4개 미션 전부 공개 기준)
export function calculateTicketBonus(
  roomCode: string = "default",
  tickets: { numbers: number[] }[] | any[] = []
): number {
  const missions = generateMathMissions(roomCode);
  let totalBonus = 0;
  if (Array.isArray(tickets)) {
    tickets.forEach((ticket) => {
      const nums = Array.isArray(ticket?.numbers) ? ticket.numbers : [];
      const res = calculateSingleTicketBonus(missions, nums);
      totalBonus += res.score;
    });
  }
  return totalBonus;
}
