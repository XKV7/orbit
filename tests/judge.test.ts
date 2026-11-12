import { describe, expect, it } from 'vitest';
import { adofaiWindows, DIFFICULTY_MULT, judgeError, judgeWindows, OverloadTracker } from '../src/core/judge';
import { PlayStats } from '../src/core/stats';

const w = judgeWindows(500); // 120bpm: 상한 125ms → 기본 창 그대로
const J = (e: number) => judgeError(e, w, 250);

describe('판정 경계값', () => {
  it('완벽 ±35ms', () => {
    expect(J(0)).toBe('perfect');
    expect(J(35)).toBe('perfect');
    expect(J(-35)).toBe('perfect');
    expect(J(35.01)).toBe('latePerfect');
    expect(J(-35.01)).toBe('earlyPerfect');
  });
  it('약간 ±70ms', () => {
    expect(J(70)).toBe('latePerfect');
    expect(J(-70)).toBe('earlyPerfect');
    expect(J(70.01)).toBe('late');
    expect(J(-70.01)).toBe('early');
  });
  it('빠름·느림 ±110ms', () => {
    expect(J(110)).toBe('late');
    expect(J(-110)).toBe('early');
    expect(J(110.01)).toBe('miss');
    expect(J(-110.01)).toBe('tooEarly');
  });
  it('너무 빠름 하한 이전 입력은 무시', () => {
    expect(J(-250)).toBe('tooEarly');
    expect(J(-250.01)).toBeNull();
  });
  it('창 상한 beatMs × 0.25', () => {
    const fast = judgeWindows(200); // 300bpm → 상한 50ms
    expect(fast.perfect).toBe(35);
    expect(fast.near).toBe(50);
    expect(fast.far).toBe(50);
    expect(judgeError(50, fast, 100)).toBe('latePerfect');
    expect(judgeError(50.01, fast, 100)).toBe('miss');
    expect(judgeError(-50.01, fast, 100)).toBe('tooEarly');
  });
  it('앞뒤 음표 간격 기반 하한 (속도 올린 구간)', () => {
    // 보이는 박 83ms(720BPM)라도 실제 음표 간격 83ms면 창 상한 ≈ 41.7ms
    const w2 = judgeWindows(83.3, 1, 83.3 / 2);
    expect(w2.perfect).toBe(35);
    expect(w2.far).toBeCloseTo(41.65, 1);
    // 일반 타일은 창이 그대로 (근접 여유만 추가)
    const { grace: _g, ...plain } = judgeWindows(500, 1, 250);
    const { grace: _h, ...base } = judgeWindows(500);
    expect(plain).toEqual(base);
  });

  it('근접 입력 여유: far를 조금 넘겨도 빠름·느림 (이웃 음표 간격 절반까지)', () => {
    // 125BPM 1박 타일, 보통: far ±126.5ms, 여유 ±189.75ms
    const g = judgeWindows(480, DIFFICULTY_MULT.normal, 240);
    expect(g.far).toBeCloseTo(126.5);
    expect(g.grace).toBeCloseTo(189.75);
    expect(judgeError(170, g, 240)).toBe('late');
    expect(judgeError(-170, g, 240)).toBe('early');
    expect(judgeError(191, g, 240)).toBe('miss');
    // 연타(간격 120ms)에서는 이웃과 헷갈리지 않게 여유 없음
    const s = judgeWindows(120, DIFFICULTY_MULT.normal, 60);
    expect(s.grace).toBeCloseTo(s.far);
  });

  it('난이도 배율 (보통 ±40 / ±80 / ±126ms)', () => {
    const normal = judgeWindows(1000, DIFFICULTY_MULT.normal);
    expect(normal.perfect).toBeCloseTo(40.25);
    expect(normal.near).toBeCloseTo(80.5);
    expect(normal.far).toBeCloseTo(126.5);
    const lenient = judgeWindows(1000, DIFFICULTY_MULT.lenient);
    expect(lenient.perfect).toBeCloseTo(56);
    expect(lenient.far).toBeCloseTo(176);
    const strict = judgeWindows(1000, DIFFICULTY_MULT.strict);
    expect(strict.perfect).toBeCloseTo(28);
    expect(strict.near).toBeCloseTo(56);
    // 모든 배율이 이전보다 넓다
    expect(DIFFICULTY_MULT.normal).toBeGreaterThan(1);
    // 배율 적용 후에도 상한 유지
    expect(judgeWindows(400, 1.4).far).toBe(100);
  });
});

describe('과부하 실패 (원작 실패 게이지)', () => {
  it('너무 빠름 한 번에 0.5, 1을 넘으면 실패 — 연달아 세 번째에 실패', () => {
    const o = new OverloadTracker();
    expect(o.push()).toBe(false); // 0.5
    expect(o.push()).toBe(false); // 1.0 (넘지 않음)
    expect(o.push()).toBe(true); // 1.5
  });
  it('1박에 0.4씩 회복', () => {
    const o = new OverloadTracker();
    o.push();
    o.push(); // 1.0
    o.recover(1); // 0.6
    expect(o.push()).toBe(true); // 1.1
    const p = new OverloadTracker();
    p.push();
    p.push();
    p.recover(2.5); // 0
    expect(p.value).toBe(0);
    expect(p.push()).toBe(false);
  });
  it('reset', () => {
    const o = new OverloadTracker();
    o.push();
    o.push();
    o.reset();
    expect(o.push()).toBe(false);
  });
});

describe('멀티프레스 (원작 같은 프레임의 남는 키)', () => {
  it('연속 5번까지는 봐주고, 그 뒤로 0.35씩 — 1을 넘으면 실패', () => {
    const o = new OverloadTracker();
    for (let i = 0; i < 5; i++) expect(o.pushMulti()).toBe(false);
    expect(o.pushMulti()).toBe(false); // 0.35
    expect(o.pushMulti()).toBe(false); // 0.70
    expect(o.pushMulti()).toBe(true); // 1.05
  });
  it('한 프레임에 한 키만 누르면 연속 횟수가 끊긴다', () => {
    const o = new OverloadTracker();
    for (let i = 0; i < 5; i++) o.pushMulti();
    o.single();
    expect(o.pushMulti()).toBe(false);
    expect(o.multi).toBe(0);
  });
  it('1박에 0.2 회복, 6박 동안 없으면 0', () => {
    const o = new OverloadTracker();
    for (let i = 0; i < 7; i++) o.pushMulti(); // 0.70
    o.recover(1);
    expect(o.multi).toBeCloseTo(0.5);
    o.recover(1);
    o.recover(4.5); // 조용한 6.5박
    expect(o.multi).toBe(0);
    expect(o.value).toBe(0);
  });
});

describe('통계', () => {
  it('정확도와 체크포인트 재개', () => {
    const s = new PlayStats();
    s.recordHit(1, 'perfect');
    s.recordHit(2, 'perfect');
    s.recordHit(3, 'early');
    expect(s.accuracy()).toBeCloseTo((2 + 0.4) / 3 * 100);
    expect(s.maxStreak).toBe(2);
    s.truncateAfter(2);
    expect(s.accuracy()).toBe(100);
    expect(s.isAllPerfect()).toBe(true);
    s.recordTooEarly(3);
    expect(s.isAllPerfect()).toBe(false);
    expect(s.isFlawless()).toBe(false);
  });
  it('빠른 연타 구간도 최소 범위(원작 약 65ms)는 받아준다', () => {
    // 720 BPM (박 83ms), 음표 간격 83ms → 전에는 ±41ms였다
    const w = judgeWindows(83.3, 1.15, 41.7, 65);
    expect(w.far).toBeCloseTo(65);
    expect(w.near).toBeCloseTo(65);
    expect(w.perfect).toBeCloseTo(35 * 1.15);
    expect(judgeError(-60, w, 41.7)).toBe('earlyPerfect');
    expect(judgeError(60, w, 41.7)).toBe('latePerfect');
    expect(judgeError(70, w, 41.7)).toBe('miss');
  });
});

describe('원작(ADOFAI) 판정 창', () => {
  it('보통 BPM은 각도 기준: 120bpm 한 박 500ms → 완벽 ±83ms · 약간 ±125ms · 빠름/느림 ±167ms', () => {
    const w = adofaiWindows(500, 'normal');
    expect(w.perfect).toBeCloseTo(83.33, 1);
    expect(w.near).toBeCloseTo(125, 1);
    expect(w.far).toBeCloseTo(166.67, 1);
    expect(judgeError(-100, w, Infinity)).toBe('earlyPerfect');
    expect(judgeError(150, w, Infinity)).toBe('late');
    expect(judgeError(170, w, Infinity)).toBe('miss');
  });
  it('아주 빠른 곡은 최소 시간 (PC 20 · 30 · 65ms, 엄격 40ms, 모바일 50 · 70 · 90ms)', () => {
    const fast = adofaiWindows(50, 'normal'); // 1200bpm
    expect([fast.perfect, fast.near, fast.far]).toEqual([25, 30, 65]);
    expect(adofaiWindows(50, 'strict').far).toBe(40);
    expect(adofaiWindows(50, 'lenient').far).toBe(91);
    const m = adofaiWindows(50, 'normal', true);
    expect([m.perfect, m.near, m.far]).toEqual([50, 70, 90]);
  });
});
