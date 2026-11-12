export type Judgment = 'perfect' | 'earlyPerfect' | 'latePerfect' | 'early' | 'late' | 'tooEarly' | 'miss';
export type HitJudgment = Exclude<Judgment, 'tooEarly' | 'miss'>;
export type JudgeDifficulty = 'lenient' | 'normal' | 'strict';

/** 판정 창 배율. 설계서 값(1.4 / 1.0 / 0.7)보다 약 15% 후하게 조정. */
export const DIFFICULTY_MULT: Record<JudgeDifficulty, number> = {
  lenient: 1.6,
  normal: 1.15,
  strict: 0.8,
};

export const BASE_WINDOWS = { perfect: 35, near: 70, far: 110 } as const;

export interface Windows {
  perfect: number;
  near: number;
  far: number;
  /** far를 조금 넘긴 입력도 '빠름·느림'으로 받아주는 여유 한계 (없으면 far). 이웃 음표와 헷갈리지 않는 범위. */
  grace?: number;
}

/**
 * 원작처럼 아무리 빠른 구간이어도 '빠름·느림'으로 받아주는 최소 범위 (ms, 보통 난이도).
 * 판정은 순서대로(다음 타일만) 하므로 음표 간격보다 넓어도 헷갈리지 않는다.
 */
export const MIN_FAR_MS = 65;

/**
 * 판정 창 (ms). window(x) = min(x × 배율, cap), cap = max(beatMs × 0.25, minCapMs, 최소 범위).
 * minCapMs: 앞뒤 음표 간격의 절반 — 속도를 올린 구간(보이는 박이 짧음)에서도 창이 지나치게 좁아지지 않게.
 * minFarMs: 빠른 연타 구간의 최소 '빠름·느림' 범위 (원작 기준 약 65ms). 완벽 범위도 비율로 함께 넓힌다.
 */
export function judgeWindows(beatMs: number, mult = 1, minCapMs = 0, minFarMs = 0): Windows {
  const cap = Math.max(beatMs * 0.25, minCapMs, minFarMs);
  const far = Math.min(BASE_WINDOWS.far * mult, cap);
  return {
    perfect: Math.min(BASE_WINDOWS.perfect * mult, cap),
    near: Math.min(BASE_WINDOWS.near * mult, cap),
    far,
    // 근접 입력 여유: far의 1.5배까지, 단 이웃 음표 간격의 절반(minCapMs)을 넘지 않게
    grace: minCapMs > 0 ? Math.max(far, Math.min(far * 1.5, minCapMs)) : far,
  };
}

/**
 * 원작(ADOFAI)과 같은 판정 창 (ms). 각도 기준 — 완벽 ±30°, 약간 빠름·느림 ±45°, 빠름·느림 ±60° (반 박 = 180°) —
 * 이고, 아주 빠른 곡에서도 최소 시간은 보장한다:
 *   PC: 완벽 20ms · 약간 30ms · 빠름/느림 (느슨함 91 / 보통 65 / 엄격 40)ms, 모바일: 50 · 70 · 90ms.
 * 플레이 속도를 늦추면 최소 시간도 그만큼 길어진다 (원작 속도 연습과 같음).
 * beatMs: 이 타일 속도의 한 박 (실제 ms).
 */
export function adofaiWindows(beatMs: number, difficulty: JudgeDifficulty, mobile = false, speed = 1): Windows {
  const deg = (d: number) => (d / 180) * beatMs;
  const s = speed > 0 ? speed : 1;
  const counted = mobile ? 90 : { lenient: 91, normal: 65, strict: 40 }[difficulty] / s;
  const perfect = mobile ? 70 : 30 / s;
  const pure = mobile ? 50 : 20 / s;
  const far = Math.max(deg(60), Math.max(25, counted));
  const near = Math.max(deg(45), Math.max(25, perfect));
  const perf = Math.max(deg(30), Math.max(25, pure));
  return { perfect: perf, near, far, grace: far };
}

/**
 * 입력 오차 e (ms, 음수 = 빠름) 판정.
 * tooEarlyLimitMs: 이보다 더 이른 입력은 무시 (null). 원작은 판정 창보다 이른 입력이 모두 너무 빠름 → Infinity.
 */
export function judgeError(e: number, w: Windows, tooEarlyLimitMs: number): Judgment | null {
  const a = Math.abs(e);
  if (a <= w.perfect) return 'perfect';
  if (a <= w.near) return e < 0 ? 'earlyPerfect' : 'latePerfect';
  if (a <= (w.grace ?? w.far)) return e < 0 ? 'early' : 'late';
  if (e > 0) return 'miss';
  if (-e <= tooEarlyLimitMs) return 'tooEarly';
  return null;
}

/** 진행하는 판정인가 (너무 빠름·놓침 제외). */
export function advances(j: Judgment): j is HitJudgment {
  return j !== 'tooEarly' && j !== 'miss';
}

export const JUDGE_LABEL: Record<Judgment, string> = {
  perfect: '완벽',
  earlyPerfect: '약간 빠름',
  latePerfect: '약간 느림',
  early: '빠름',
  late: '느림',
  tooEarly: '너무 빠름',
  miss: '놓침',
};

export const JUDGE_COLOR: Record<Judgment, number> = {
  perfect: 0x5cf07a,
  earlyPerfect: 0xc6f25a,
  latePerfect: 0xf2e45a,
  early: 0xff9d3c,
  late: 0xff9d3c,
  tooEarly: 0xff4a4a,
  miss: 0xff4a4a,
};

/** 정확도 가중치. */
export const JUDGE_WEIGHT: Record<Judgment, number> = {
  perfect: 1,
  earlyPerfect: 0.75,
  latePerfect: 0.75,
  early: 0.4,
  late: 0.4,
  tooEarly: 0,
  miss: 0,
};

/**
 * 과부하 게이지 (원작 실패 게이지 scrFailBar.overloadCounter): 너무 빠름 한 번에 +0.5,
 * 1박(그 타일 BPM 기준)마다 0.4씩 줄고, 1을 **넘으면** 과부하로 실패.
 * 값은 원작 DLL에서 옮겨 적은 공개 시뮬레이터(kineticnapier/DoMachinesDreamOfDeparture rules.py)의 상수.
 */
export const OVERLOAD_DAMAGE = 0.5;
export const OVERLOAD_RECOVERY_PER_BEAT = 0.4;
export const OVERLOAD_LIMIT = 1;
export class OverloadTracker {
  /** 지금 게이지 (0 ~) */
  value = 0;
  /** 너무 빠름 한 번. 과부하면 true. */
  push(): boolean {
    this.value += OVERLOAD_DAMAGE;
    return this.value > OVERLOAD_LIMIT;
  }
  /** 박이 지나간 만큼 회복 */
  recover(beats: number): void {
    if (beats > 0) this.value = Math.max(0, this.value - OVERLOAD_RECOVERY_PER_BEAT * beats);
  }
  reset(): void {
    this.value = 0;
  }
}
