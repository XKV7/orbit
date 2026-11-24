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
