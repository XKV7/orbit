// 원작 에디터에서 시험 레벨을 직접 돌려 잰 규칙 (2026-11, 사용자 PC의 원작 ADOFAI)
import { describe, expect, it } from 'vitest';
import { compileChart } from '../src/core/chart';
import { validateLevel } from '../src/core/level';
import { VisualTimeline } from '../src/core/timeline';
import { convertAdofai } from '../src/levels/adofai';

function level(obj: Record<string, unknown>) {
  const text = JSON.stringify({ ...obj, settings: { bpm: 60, offset: 0, songFilename: 'song.ogg', ...((obj.settings as object) ?? {}) } });
  const r = convertAdofai(text);
  const v = validateLevel(r.level);
  expect(v.ok, v.ok ? '' : v.errors.join('\n')).toBe(true);
  return r;
}
const flash = (floor: number, plane: string, op0: number, op1: number, duration = 1) => ({
  floor,
  eventType: 'Flash',
  duration,
  plane,
  startColor: 'ffffff',
  startOpacity: op0,
  endColor: 'ffffff',
  endOpacity: op1,
});

describe('원작 legacyFlash', () => {
  const acts = [flash(1, 'Background', 0, 100), flash(3, 'Foreground', 100, 0)];
  it('새 플래시가 다른 면에 남아 있던 플래시를 지운다', () => {
    const r = level({ angleData: [0, 0, 0, 0, 0, 0, 0], settings: { legacyFlash: true }, actions: acts });
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    tl.update(ch.tiles[2].time + 0.5);
    expect(tl.bgFlashAlpha).toBeCloseTo(1); // 배경 플래시 끝 상태 유지
    tl.update(ch.tiles[5].time);
    expect(tl.flashAlpha).toBeCloseTo(0);
    expect(tl.bgFlashAlpha).toBe(0); // 전경 플래시가 지웠다
  });
  it('칸이 없는 예전 레벨도 legacy', () => {
    const r = level({ angleData: [0, 0, 0, 0, 0], actions: acts });
    expect(r.level.actions.find((a) => a.type === 'Flash')).toMatchObject({ legacy: true });
  });
  it('legacyFlash false면 면마다 따로', () => {
    const r = level({ angleData: [0, 0, 0, 0, 0, 0, 0], settings: { legacyFlash: false }, actions: acts });
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    tl.update(ch.tiles[5].time);
    expect(tl.bgFlashAlpha).toBeCloseTo(1);
  });
});

describe('원작 MoveCamera 줌 보간', () => {
  it('줌 값(보이는 영역)을 보간한다: 0% → 270%의 가운데는 약 138%', () => {
    const r = level({
      angleData: [0, 0, 0, 0, 0, 0],
      actions: [
        { floor: 1, eventType: 'MoveCamera', duration: 0, relativeTo: 'Player', zoom: 0 },
        { floor: 2, eventType: 'MoveCamera', duration: 2, relativeTo: 'Player', zoom: 270, ease: 'Linear' },
      ],
    });
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    tl.update(ch.tiles[2].time + 1); // 2박 중 1박
    // 줌 0은 배율 최대 20배(= 5%)로 막힌다 → (5 + 270) / 2 = 137.5% → 배율 100/137.5
    // (배율로 보간하면 (20 + 0.37) / 2 ≈ 10배 확대라 화면이 타일 몇 개로 꽉 찼다)
    expect(tl.camera.zoom).toBeCloseTo(100 / 137.5, 3);
  });
});

describe('원작 CustomBackground imageColor 알파', () => {
  it('알파가 배경 그림 불투명도가 된다', () => {
    const r = level({
      angleData: [0, 0, 0],
      actions: [{ floor: 1, eventType: 'CustomBackground', color: '000000', bgImage: 'bg.png', imageColor: 'ffffff70', bgDisplayMode: 'FitToScreen' }],
    });
    const bg = r.level.actions.find((a) => a.type === 'Background' && a.floor === 1);
    expect(bg).toMatchObject({ image: 'bg.png' });
    expect((bg as { opacity?: number }).opacity).toBeCloseTo(0x70 / 255);
  });
});

describe('원작 MoveDecorations (DOTween)', () => {
  it('새 이동이 같은 장식·같은 속성의 진행 중인 움직임을 멈춘다', () => {
    const r = level({
      angleData: [0, 0, 0, 0, 0, 0, 0, 0],
      decorations: [{ floor: 0, eventType: 'AddDecoration', decorationImage: 'a.png', tag: 'ff5', position: [0, 0], relativeTo: 'Tile', scale: [100, 100] }],
      actions: [
        { floor: 1, eventType: 'MoveDecorations', tag: 'ff5', duration: 4, scale: [2222, 2222], ease: 'Linear' },
        { floor: 3, eventType: 'MoveDecorations', tag: 'ff5', duration: 0, scale: [0, 0] },
      ],
    });
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    for (let t = ch.tiles[1].time; t <= ch.tiles[7].time; t += 0.05) tl.update(t);
    const d = tl.decos.find((x) => x.tags.includes('ff5'))!;
    expect(d.sx).toBe(0); // 예전: 앞의 키우기가 끝까지 돌아 22배
  });
  it('다른 속성의 움직임은 계속된다', () => {
    const r = level({
      angleData: [0, 0, 0, 0, 0, 0, 0, 0],
      decorations: [{ floor: 0, eventType: 'AddDecoration', decorationImage: 'a.png', tag: 'd', position: [0, 0], relativeTo: 'Tile', scale: [100, 100] }],
      actions: [
        { floor: 1, eventType: 'MoveDecorations', tag: 'd', duration: 4, rotationOffset: 90, ease: 'Linear' },
        { floor: 2, eventType: 'MoveDecorations', tag: 'd', duration: 0, scale: [50, 50] },
      ],
    });
    const ch = compileChart(r.level);
    const tl = new VisualTimeline(ch);
    for (let t = ch.tiles[1].time; t <= ch.tiles[7].time; t += 0.05) tl.update(t);
    const d = tl.decos.find((x) => x.tags.includes('d'))!;
    expect(d.rot).toBeCloseTo(90);
    expect(d.sx).toBeCloseTo(0.5);
  });
});

describe('원작 가림막 깊이 범위 (useMaskingDepth)', () => {
  it('가림막의 front/back 깊이를 범위로 옮긴다', () => {
    const r = level({
      angleData: [0, 0, 0],
      decorations: [
        { floor: 0, eventType: 'AddDecoration', decorationImage: 'm.png', tag: 'm', maskingType: 'Mask', useMaskingDepth: true, maskingFrontDepth: -66, maskingBackDepth: -67 },
        { floor: 0, eventType: 'AddDecoration', decorationImage: 'n.png', tag: 'n', maskingType: 'Mask', useMaskingDepth: false },
      ],
    });
    const ds = r.level.decorations ?? [];
    expect(ds.find((d) => d.tag === 'm')).toMatchObject({ mask: 'mask', maskRange: [-67, -66] });
    expect(ds.find((d) => d.tag === 'n')?.maskRange).toBeUndefined();
  });
});
