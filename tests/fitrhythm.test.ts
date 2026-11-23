import { describe, expect, it } from 'vitest';
import { compileChart } from '../src/core/chart';
import { fitRhythm } from '../src/core/editorOps';
import { emptyLevel, validateLevel } from '../src/core/level';

/** 마법진처럼 각도가 제각각인 길 + 뒤에 곧은 길 */
function shaped() {
  const lv = emptyLevel();
  lv.settings.bpm = 120;
  lv.settings.offset = 0;
  // 0~7: 모양(각도 제각각), 8~11: 곧은 길
  lv.path = [0, 60, 300, 90, 210, 45, 135, 0, 0, 0, 0, 0];
  lv.actions = [];
  return lv;
}

describe('박자 맞추기 (마법진)', () => {
  it('범위 안 타일이 모두 같은 간격으로 쳐진다', () => {
    const lv = shaped();
    const r = fitRhythm(lv, 1, 7, 0.5);
    expect(validateLevel(JSON.parse(JSON.stringify(r.level))).ok).toBe(true);
    expect(r.baseBpm).toBe(120);
    const ch = compileChart(r.level);
    // 반 박 = 0.25초 (120 BPM)
    for (let i = 1; i <= 7; i++) expect(ch.tiles[i + 1].time - ch.tiles[i].time).toBeCloseTo(0.25, 6);
  });

  it('범위 뒤 박자는 그대로 (원래 BPM으로 돌아온다)', () => {
    const lv = shaped();
    const before = compileChart(lv);
    const r = fitRhythm(lv, 1, 7, 0.5);
    const ch = compileChart(r.level);
    // 범위 뒤 타일 간격은 원래와 같다
    for (let i = 8; i < before.finish; i++) expect(ch.tiles[i + 1].time - ch.tiles[i].time).toBeCloseTo(before.tiles[i + 1].time - before.tiles[i].time, 6);
    expect(ch.tiles[9].bpm).toBeCloseTo(120);
  });

  it('미드스핀은 건너뛰고, 기준 BPM을 정할 수 있다', () => {
    const lv = shaped();
    // 3번을 미드스핀으로 (회전 0)
    lv.path[3] = (lv.path[2] + 180) % 360;
    lv.actions.push({ floor: 3, type: 'Midspin' });
    const r = fitRhythm(lv, 1, 6, 1, 90);
    expect(r.skipped).toBe(1);
    expect(r.baseBpm).toBe(90);
    const ch = compileChart(r.level);
    // 미드스핀 앞뒤를 합쳐 한 박씩 (90 BPM 한 박 = 2/3초): 미드스핀 타일은 길이 0
    const beat = 60 / 90;
    expect(ch.tiles[2].time - ch.tiles[1].time).toBeCloseTo(beat, 6);
    expect(ch.tiles[3].time - ch.tiles[2].time).toBeCloseTo(beat, 6);
    expect(ch.tiles[4].time - ch.tiles[3].time).toBeCloseTo(0, 6);
    expect(ch.tiles[5].time - ch.tiles[4].time).toBeCloseTo(beat, 6);
    expect(ch.tiles[7].time - ch.tiles[6].time).toBeCloseTo(beat, 6);
  });

  it('범위 안 원래 속도 바꾸기는 바꾸고, 뒤의 배율(×) 속도 바꾸기는 원래 결과 BPM으로 고정한다', () => {
    const lv = shaped();
    lv.actions.push({ floor: 3, type: 'SetSpeed', bpm: 200 });
    lv.actions.push({ floor: 8, type: 'SetSpeed', multiplier: 0.5 });
    const before = compileChart(lv);
    const r = fitRhythm(lv, 1, 7, 0.5, 120);
    const sp = r.level.actions.filter((a) => a.type === 'SetSpeed' && a.floor === 8);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ bpm: before.tiles[8].bpm });
    const ch = compileChart(r.level);
    expect(ch.tiles[8].bpm).toBeCloseTo(before.tiles[8].bpm);
  });
});

describe('각도를 바꿔도 박자 유지', () => {
  it('나가는 각도를 바꾸면 그 타일과 다음 타일 길이가 예전과 같고, 뒤는 그대로', async () => {
    const { keepTiming, setOutAngle } = await import('../src/core/editorOps');
    const lv = shaped();
    const before = compileChart(lv);
    const after = keepTiming(lv, setOutAngle(lv, 3, lv.path[3] + 45), 3, 4);
    const ch = compileChart(after);
    expect(after.path[3]).toBe((lv.path[3] + 45) % 360);
    for (let i = 0; i < before.finish; i++) expect(ch.tiles[i + 1].time - ch.tiles[i].time).toBeCloseTo(before.tiles[i + 1].time - before.tiles[i].time, 6);
  });
  it('길이가 안 바뀌면 속도 바꾸기를 더하지 않는다', async () => {
    const { keepTiming } = await import('../src/core/editorOps');
    const lv = shaped();
    expect(keepTiming(lv, lv, 2, 3).actions).toHaveLength(0);
  });
});
