import { describe, expect, it } from 'vitest';
import { compileChart } from '../src/core/chart';
import { spinCamera } from '../src/core/editorOps';
import { emptyLevel } from '../src/core/level';
import { VisualTimeline } from '../src/core/timeline';

function lv() {
  const l = emptyLevel();
  l.settings.bpm = 120;
  l.settings.offset = 0;
  l.path = new Array(20).fill(0);
  l.actions = [];
  return l;
}

const rotAt = (level: ReturnType<typeof lv>, t: number) => {
  const tl = new VisualTimeline(compileChart(level));
  tl.update(t);
  return tl.camera.rotation;
};

describe('카메라 계속 회전', () => {
  it('n번부터 m번 타일까지 일정한 속도로 p도', () => {
    const r = spinCamera(lv(), 4, 12, 360)!;
    expect(r.from).toBe(0);
    expect(r.to).toBe(360);
    expect(r.beats).toBeCloseTo(8, 9);
    const ch = compileChart(r.level);
    const t4 = ch.tiles[4].time;
    const t12 = ch.tiles[12].time;
    expect(rotAt(r.level, t4)).toBeCloseTo(0, 3);
    expect(rotAt(r.level, (t4 + t12) / 2)).toBeCloseTo(180, 1);
    expect(rotAt(r.level, t12 + 1)).toBeCloseTo(360, 3);
  });
  it('앞 카메라 회전에서 이어서 돈다 · BPM이 바뀌어도 m번 타일에 끝난다', () => {
    const l = lv();
    l.actions.push({ floor: 1, type: 'Camera', rotation: 30 });
    l.actions.push({ floor: 6, type: 'SetSpeed', bpm: 240 });
    const r = spinCamera(l, 4, 10, -90)!;
    expect(r.from).toBe(30);
    expect(r.to).toBe(-60);
    const ch = compileChart(r.level);
    expect(rotAt(r.level, ch.tiles[10].time - 1e-4)).toBeCloseTo(-60, 0);
    expect(rotAt(r.level, ch.tiles[10].time - 0.1)).toBeGreaterThan(-60);
  });
  it('범위가 없거나 0도면 아무것도 안 한다', () => {
    expect(spinCamera(lv(), 5, 5, 90)).toBeNull();
    expect(spinCamera(lv(), 2, 8, 0)).toBeNull();
  });
});
