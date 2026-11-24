import { describe, expect, it } from 'vitest';
import { beatGrid, chartSong, GENRES } from '../src/audio/chartsong';
import { compileChart } from '../src/core/chart';
import { fitRhythm } from '../src/core/editorOps';
import { emptyLevel } from '../src/core/level';

function lv(n = 24, bpm = 150) {
  const l = emptyLevel();
  l.settings.bpm = bpm;
  l.settings.offset = 1;
  l.path = new Array(n).fill(0);
  l.actions = [];
  return l;
}

/** t 근처 짧은 구간의 에너지 */
const energy = (s: Float32Array, sr: number, t: number, w = 0.02) => {
  let e = 0;
  const a = Math.floor(t * sr);
  for (let i = a; i < a + w * sr; i++) e += s[i] * s[i];
  return e;
};

describe('채보에 맞춰 노래 만들기', () => {
  const sr = 8000;
  for (const g of GENRES) {
    it(`${g.label}: 마지막 타일 뒤까지, 타일 치는 순간에 소리가 시작`, () => {
      const ch = compileChart(lv());
      const s = chartSong(ch, g.value, 42, sr);
      expect(s.length / sr).toBeGreaterThan(ch.tiles[ch.finish].time + 2);
      expect(s.every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
      // 치는 순간 직후가 바로 앞보다 소리가 크다 (멜로디·드럼 시작)
      let louder = 0;
      for (let i = 2; i < ch.finish; i++) {
        const t = ch.tiles[i].time;
        if (energy(s, sr, t + 0.002) > energy(s, sr, t - 0.03)) louder++;
      }
      expect(louder / (ch.finish - 2)).toBeGreaterThan(0.8);
    });
  }
  it('같은 seed면 같은 곡, 다르면 다른 곡', () => {
    const ch = compileChart(lv());
    const a = chartSong(ch, 'chiptune', 1, sr);
    expect(chartSong(ch, 'chiptune', 1, sr)).toEqual(a);
    expect(chartSong(ch, 'chiptune', 2, sr)).not.toEqual(a);
  });
  it('박은 첫 타일에 맞고, 마법진(타일마다 바뀌는 BPM)에는 흔들리지 않는다', () => {
    const l = lv(40, 120);
    l.path = [0, 0, 0, 0, 60, 300, 90, 210, 45, 135, 0, 0, ...new Array(28).fill(0)];
    const fitted = fitRhythm(l, 4, 10, 1).level;
    const ch = compileChart(fitted);
    const grid = beatGrid(ch, ch.tiles[ch.finish].time + 1);
    expect(new Set(grid.map((g) => g.bpm))).toEqual(new Set([120]));
    // 모든 타일 치는 순간이 박 위
    for (let i = 1; i <= ch.finish; i++) expect(grid.some((g) => Math.abs(g.t - ch.tiles[i].time) < 1e-4)).toBe(true);
  });
  it('오래 이어진 BPM 변화는 따라간다', () => {
    const l = lv(40, 120);
    l.actions.push({ floor: 20, type: 'SetSpeed', bpm: 180 });
    const ch = compileChart(l);
    const grid = beatGrid(ch, ch.tiles[ch.finish].time + 1);
    expect(grid.some((g) => g.bpm === 180)).toBe(true);
    for (let i = 20; i <= ch.finish; i++) expect(grid.some((g) => Math.abs(g.t - ch.tiles[i].time) < 1e-4)).toBe(true);
  });
});

describe('곡 구조 (맵 밀도로 구간)', () => {
  it('드문 곳 = 쉼, 빽빽한 곳 = 드랍, 드랍 앞 마디 = 빌드업, 처음 = 도입', async () => {
    const { planSections } = await import('../src/audio/chartsong');
    // 4마디씩: 보통, 드묾, 보통, 빽빽, 빽빽, 드묾, 빽빽
    const bars = [...Array(4).fill(4), ...Array(4).fill(1), ...Array(4).fill(4), ...Array(8).fill(12), ...Array(4).fill(1), ...Array(4).fill(12)];
    const s = planSections(bars);
    expect(s[0]).toBe('intro');
    expect(s[4]).toBe('break');
    expect(s[11]).toBe('build');
    expect(s[12]).toBe('drop');
    expect(s[19]).toBe('drop');
    expect(s[20]).toBe('break');
    expect(s[23]).toBe('build');
    expect(s[24]).toBe('drop');
  });
  it('구간마다 크기가 다르다 (예전엔 처음부터 끝까지 같았다)', () => {
    const l = emptyLevel();
    l.settings.bpm = 150;
    l.settings.offset = 1;
    l.actions = [];
    // 16마디 드문 길(1박) → 16마디 빽빽한 길(반박: 매 타일 90° 꺾임)
    const p: number[] = [];
    let a = 0;
    for (let i = 0; i < 64; i++) p.push(a);
    for (let i = 0; i < 128; i++) {
      a = (a + 90) % 360;
      p.push(a);
    }
    l.path = p;
    const ch = compileChart(l);
    expect(ch.tiles[100].beats).toBeCloseTo(0.5, 6);
    const sr = 8000;
    const s = chartSong(ch, 'speedcore', 3, sr);
    const rms = (t0: number, t1: number) => {
      let e = 0;
      for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) e += s[i] * s[i];
      return Math.sqrt(e / ((t1 - t0) * sr));
    };
    const calm = rms(ch.tiles[20].time, ch.tiles[50].time);
    const loud = rms(ch.tiles[120].time, ch.tiles[180].time);
    expect(loud).toBeGreaterThan(calm * 1.3);
  });
});
