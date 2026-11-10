import { describe, expect, it } from 'vitest';
import { compileChart, orbiterAngle } from '../src/core/chart';
import { validateLevel } from '../src/core/level';
import { VisualTimeline } from '../src/core/timeline';
import { convertAdofai } from '../src/levels/adofai';

function level(obj: Record<string, unknown>) {
  const text = JSON.stringify({ ...obj, settings: { bpm: 100, offset: 500, songFilename: 'song.ogg', ...((obj.settings as object) ?? {}) } });
  const r = convertAdofai(text);
  const v = validateLevel(r.level);
  expect(v.ok, v.ok ? '' : v.errors.join('\n')).toBe(true);
  return r;
}

describe('원작 이벤트: 홀드·자동 진행·공전 곡선·조건 연출', () => {
  it('Hold 추가 바퀴 0 → 다음 타일까지 누르는 홀드 (박은 그대로)', () => {
    const r = level({ angleData: [0, 0, 0, 0], actions: [{ floor: 1, eventType: 'Hold', duration: 0 }] });
    expect(r.level.actions).toContainEqual({ floor: 1, type: 'Hold', beats: 0, toNext: true });
    expect(r.warnings.join(' ')).not.toContain('Hold');
    const ch = compileChart(r.level);
    expect(ch.tiles[1].holdToNext).toBe(true);
    expect(ch.tiles[1].beats).toBe(1);
    expect(ch.tiles[2].holdToNext).toBe(false);
  });

  it('AutoPlayTiles → 그 타일부터 자동 진행, 끄면 다시 직접', () => {
    const r = level({
      angleData: [0, 0, 0, 0, 0],
      actions: [
        { floor: 1, eventType: 'AutoPlayTiles', enabled: true },
        { floor: 3, eventType: 'AutoPlayTiles', enabled: false },
      ],
    });
    const ch = compileChart(r.level);
    expect(ch.tiles.map((t) => t.auto)).toEqual([false, true, true, false, false, false]);
    expect(r.warnings.join(' ')).not.toContain('AutoPlayTiles');
  });

  it('SetPlanetRotation → 공전 곡선 (도착 시각·각도는 그대로, 중간만 곡선)', () => {
    const r = level({ angleData: [0, 0, 0], actions: [{ floor: 1, eventType: 'SetPlanetRotation', ease: 'InSine', easeParts: 2, easePartBehavior: 'Mirror' }] });
    expect(r.level.actions).toContainEqual({ floor: 1, type: 'PlanetEase', ease: 'inSine', parts: 2, mirror: true });
    const ch = compileChart(r.level);
    const t = ch.tiles[1];
    expect(t.orbitEase).toEqual({ ease: 'inSine', parts: 2, mirror: true });
    const lin = (p: number) => t.start + (t.dir === 'CW' ? -1 : 1) * t.sweep * p;
    const at = (p: number) => orbiterAngle(t, t.time + t.duration * p);
    expect(at(0)).toBeCloseTo(lin(0));
    expect(at(0.5)).toBeCloseTo(lin(0.5));
    expect(at(1)).toBeCloseTo(lin(1));
    // 첫 조각 inSine: 처음엔 느리다
    expect(Math.abs(at(0.1) - t.start)).toBeLessThan(Math.abs(lin(0.1) - t.start));
    // 거울 조각: 둘째 조각은 처음에 빠르다
    expect(Math.abs(at(0.6) - t.start)).toBeGreaterThan(Math.abs(lin(0.6) - t.start));
    expect(ch.tiles[0].orbitEase).toBeNull();
  });

  it('SetHoldSound는 경고 없이 넘긴다', () => {
    const r = level({ angleData: [0, 0, 0], actions: [{ floor: 1, eventType: 'SetHoldSound', holdStartSound: 'Fuse' }] });
    expect(r.warnings.join(' ')).not.toContain('SetHoldSound');
  });

  it('SetConditionalEvents: 같은 타일의 태그 이벤트는 제자리에서 실행하지 않고 판정이 부를 때만', () => {
    const r = level({
      angleData: [0, 0, 0, 0],
      decorations: [{ floor: 0, eventType: 'AddDecoration', decorationImage: 'panel.png', tag: 'panel', opacity: 0 }],
      actions: [
        { floor: 1, eventType: 'SetConditionalEvents', perfectTag: 'NONE', lossTag: 'dead', hitTag: 'NONE' },
        { floor: 1, eventType: 'MoveDecorations', tag: 'panel', opacity: 100, duration: 0, eventTag: 'dead' },
        { floor: 1, eventType: 'Flash', duration: 1, eventTag: 'other' },
      ],
    });
    expect(r.level.actions).toContainEqual({ floor: 1, type: 'Conditional', on: { loss: 'dead' } });
    const mv = r.level.actions.find((a) => a.type === 'MoveDecorations');
    expect(mv?.cond).toBe('dead');
    const fl = r.level.actions.find((a) => a.type === 'Flash');
    expect(fl?.cond).toBeUndefined();
    expect(r.warnings.join(' ')).not.toContain('SetConditionalEvents');
    const ch = compileChart(r.level);
    expect(ch.visual.some((v) => v.action.type === 'MoveDecorations')).toBe(false);
    expect(ch.cond.get('dead')?.length).toBe(1);
    expect(ch.tiles[1].conds).toEqual({ loss: 'dead' });
    // 실행: 부르기 전에는 숨은 채, 부르면 나타난다
    const tl = new VisualTimeline(ch);
    tl.update(ch.times[3]);
    expect(tl.decos[0].opacity).toBe(0);
    tl.trigger('dead', ch.times[3]);
    tl.update(ch.times[3] + 0.01);
    expect(tl.decos[0].opacity).toBe(1);
  });

  it("그림 이름이 아닌 구분용 이름('============= ACT 0')은 그림 없는 것으로", () => {
    const r = level({
      angleData: [0, 0, 0],
      decorations: [
        { floor: 0, eventType: 'AddDecoration', decorationImage: '============= ACT 0', tag: 'a' },
        { floor: 0, eventType: 'AddDecoration', decorationImage: 'real.png', tag: 'b' },
      ],
    });
    expect((r.level.decorations ?? []).map((d) => d.image)).toEqual(['real.png']);
  });

  it('AddObject 타일: 색 알파로 숨긴 오브젝트는 투명', () => {
    const r = level({ angleData: [0, 0, 0], decorations: [{ floor: 0, eventType: 'AddObject', objectType: 'Floor', trackColor: 'debb7b00', tag: 'o' }] });
    expect(r.level.decorations?.[0].opacity).toBe(0);
  });

  it('AddObject: 타일 번호 없으면 0번, 트랙 스타일·미드스핀 모양, MoveDecorations pivotOffset', () => {
    const r = level({
      angleData: [0, 0, 0],
      decorations: [
        { eventType: 'AddObject', objectType: 'Floor', trackType: 'Midspin', trackStyle: 'Minimal', trackColor: 'ffffffff', trackOpacity: 50, tag: 'rock', pivotOffset: [9, 0] },
        { floor: 1, eventType: 'AddObject', objectType: 'Floor', trackStyle: 'Neon', tag: 'n' },
      ],
      actions: [{ floor: 1, eventType: 'MoveDecorations', tag: 'rock', pivotOffset: [-2, null], duration: 1 }],
    });
    const [rock, neon] = r.level.decorations ?? [];
    expect(rock).toMatchObject({ floor: 0, tileStyle: 'minimal', midspin: true, opacity: 0.5, pivot: [900, 0] });
    expect(neon).toMatchObject({ floor: 1, tileStyle: 'neon' });
    const mv = r.level.actions.find((a) => a.type === 'MoveDecorations');
    expect(mv && 'pivot' in mv ? mv.pivot : null).toEqual([-200, null]);
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    tl.update(ch.times[3] + 5);
    expect(tl.decos[0].pvx).toBe(-200);
    expect(tl.decos[0].pvy).toBe(0);
  });

  it('AddObject: 행성 기준(RedPlanet/BluePlanet), 꺾임 각도·아이콘, SetObject로 바꾸기', () => {
    const r = level({
      angleData: [0, 0, 0],
      decorations: [
        { floor: 0, eventType: 'AddObject', objectType: 'Planet', relativeTo: 'RedPlanet', tag: 'p0' },
        { floor: 0, eventType: 'AddObject', objectType: 'Planet', relativeTo: 'BluePlanet', tag: 'p1' },
        { floor: 1, eventType: 'AddObject', objectType: 'Floor', trackAngle: 30, trackIcon: 'DoubleRabbit', relativeTo: 'Tile', tag: 'f' },
      ],
      actions: [{ floor: 1, eventType: 'SetObject', tag: 'f', trackAngle: 150, trackIcon: 'Snail', duration: 0 }],
    });
    const [p0, p1, f] = r.level.decorations ?? [];
    expect(p0.relativeTo).toBe('red');
    expect(p1.relativeTo).toBe('blue');
    expect(f).toMatchObject({ tileAngle: 30, tileIcon: 'speedUp2' });
    expect(f.rotation).toBeUndefined();
    expect(r.level.actions).toContainEqual(expect.objectContaining({ type: 'MoveDecorations', tag: 'f', tileAngle: 150, tileIcon: 'speedDown' }));
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    tl.update(ch.times[2]);
    expect(tl.decos[2].tileAngle).toBe(150);
    expect(tl.decos[2].tileIcon).toBe('speedDown');
  });
});
