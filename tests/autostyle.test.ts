import { describe, expect, it } from 'vitest';
import { countOverlaps, layoutBest, levelFromHits, multiHitCount, overlapsBesidesMultiHits } from '../src/core/autochart';
import { compileChart } from '../src/core/chart';

/** 64마디: 정박 + 가끔 반박, 16박마다 크래시 */
function hits(): number[] {
  const out: number[] = [];
  // 대부분 정박, 4마디마다 반박 장식 (자동 맵에서 흔한 모양)
  // 4마디마다 강박 뒤 반박 (센 소리 + 바로 꺾이는 리듬)
  for (let bar = 1; bar <= 64; bar++) for (const f of bar % 4 === 0 ? [0, 0.5, 1, 2, 3] : bar % 4 === 3 ? [0, 0.5, 1, 1.5, 2, 3] : bar % 4 === 1 ? [0, 1, 2, 2.5, 3] : [0, 1, 2, 3]) out.push(bar * 4 + f);
  return out;
}
const accent = (b: number) => (Math.abs(b / 16 - Math.round(b / 16)) < 1e-6 ? 3 : 1);

describe('자동 맵 꾸미기 (원작 맵처럼)', () => {
  it('트윌을 구간마다 더 넣고, 겹침은 늘지 않는다', () => {
    const r = levelFromHits(hits(), 140, 1, { style: 3, accent })!;
    const tws = r.level.actions.filter((a) => a.type === 'Twirl');
    const n = r.level.path.length;
    // 원작 맵(100타일당 17~32개)보다 조금 적게
    expect(tws.length / n).toBeGreaterThan(0.1);
    expect(tws.length / n).toBeLessThanOrEqual(0.32);
    const intervals = hits().map((b, i, a) => b - (i ? a[i - 1] : 0));
    const mids = r.level.actions.filter((a) => a.type === 'Midspin').map((a) => a.floor);
    expect(overlapsBesidesMultiHits(r.level.path, mids)).toBeLessThanOrEqual(countOverlaps(layoutBest(intervals).path));
  });

  it('센 강박에 동타(미드스핀) — 같은 순간 두 번, 나머지 박자는 그대로', () => {
    const r = levelFromHits(hits(), 140, 1, { style: 3, accent })!;
    const ch = compileChart(r.level);
    const mids = ch.tiles.filter((t) => t.midspin);
    expect(mids.length).toBeGreaterThan(0);
    // 타일 시각 = 원래 타격 시각 (+ 미드스핀 자리는 같은 시각 두 번)
    const times = ch.tiles.slice(1).map((t) => t.time);
    const want = hits().map((b) => 1 + (b * 60) / 140);
    // 원래 타격이 모두 그 시각에 있고 (앞쪽 빈 곳은 1박 타일로 채움), 같은 시각 두 번은 미드스핀 자리뿐
    for (const w of want) expect(times.some((t) => Math.abs(t - w) < 1e-6)).toBe(true);
    const dup = times.filter((t, i) => i > 0 && Math.abs(t - times[i - 1]) < 1e-6).length;
    expect(dup).toBe(mids.length);
    // 쉬움·보통은 동타 없음
    expect(compileChart(levelFromHits(hits(), 140, 1, { style: 1, accent })!.level).tiles.some((t) => t.midspin)).toBe(false);
  });

  it('길게 끄는 소리는 빈 곳을 채우지 않고 홀드', () => {
    const hs = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const r = levelFromHits(hs, 120, 1, { style: 1, sustain: (b0) => Math.abs(b0 - 4) < 1e-6 })!;
    const holds = r.level.actions.filter((a) => a.type === 'Hold');
    expect(holds.length).toBe(1);
    const ch = compileChart(r.level);
    // 홀드 타일(4박에 친 타일)에서 다음 타일(6박)까지 2박
    const h = ch.tiles[holds[0].floor];
    expect(h.time).toBeCloseTo(1 + (4 * 60) / 120, 6);
    expect(ch.tiles[holds[0].floor + 1].time - h.time).toBeCloseTo(1, 6);
  });

  it('16분 연타 구간은 속도를 올려 길을 편다', () => {
    const hs: number[] = [];
    for (let k = 0; k < 32; k++) hs.push(k + 1);
    for (let k = 0; k < 64; k++) hs.push(33 + k * 0.25);
    for (let k = 0; k < 16; k++) hs.push(49 + k);
    const r = levelFromHits(hs, 130, 1, { style: 3, minBeats: 0.25, minGapSec: 0.1 })!;
    const sp = r.level.actions.filter((a) => a.type === 'SetSpeed');
    expect(sp.length).toBeGreaterThanOrEqual(1);
    const ch = compileChart(r.level);
    // 보이는 꺾임이 45°(0.25박)인 타일이 없다
    expect(ch.tiles.filter((t) => Math.abs(t.beats - 0.25) < 1e-6).length).toBe(0);
  });

  it('동타 수는 소리가 셀수록 많다 (2·3·4·6·8·10·12·16, 난이도별 최대)', () => {
    expect(multiHitCount(0, 5)).toBe(2);
    expect(multiHitCount(1, 5)).toBe(16);
    expect(multiHitCount(0.5, 5)).toBe(8);
    expect(multiHitCount(1, 2)).toBe(3);
    expect(multiHitCount(1, 3)).toBe(6);
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => multiHitCount(r, 4));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    // 실제 맵: 가장 센 강박의 동타가 더 많다
    const r = levelFromHits(hits(), 140, 1, { style: 5, accent: (b) => (Math.abs(b / 64 - Math.round(b / 64)) < 1e-6 ? 9 : accent(b)) })!;
    const ch = compileChart(r.level);
    const groups: number[] = [];
    let run = 0;
    for (const t of ch.tiles) {
      if (t.midspin) run++;
      else if (run) {
        groups.push(run + 1);
        run = 0;
      }
    }
    expect(groups.length).toBeGreaterThan(0);
    expect(Math.max(...groups)).toBeGreaterThan(2);
    const mids = r.level.actions.filter((a) => a.type === 'Midspin').map((a) => a.floor);
    const intervals = hits().map((b, i, a) => b - (i ? a[i - 1] : 0));
    expect(overlapsBesidesMultiHits(r.level.path, mids)).toBeLessThanOrEqual(countOverlaps(layoutBest(intervals).path));
  });
});
