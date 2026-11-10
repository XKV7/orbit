import { ease } from './ease';
import {
  angularSpeed,
  dirSign,
  entryAngle,
  flipDir,
  floorIndex,
  normDeg,
  rotationTheta,
  thetaToBeats,
  tilePositions,
  TILE_LEN,
} from './math';
import type { Action, CondSlot, Dir, EaseName, LevelData } from './types';

export interface ChartTile {
  floor: number;
  x: number;
  y: number;
  /** 이 타일로 들어온 방향 (path[i-1]). 타일 0은 null. */
  angleIn: number | null;
  /** 다음 타일로 가는 방향 (path[i]). 도착 타일은 null. */
  angleOut: number | null;
  /** 공전 시작 각도. */
  start: number;
  /** 목표 각도. */
  target: number;
  dir: Dir;
  /** 기본 회전량 (도). */
  theta: number;
  pauseBeats: number;
  holdBeats: number;
  /** 원작 0바퀴 홀드: 다음 타일까지 누르고 있다가 도착할 때 뗀다 */
  holdToNext: boolean;
  /** 이 타일에서 나가는 입력을 게임이 자동으로 (원작 AutoPlayTiles) */
  auto: boolean;
  /** 공전 곡선 (원작 SetPlanetRotation). null = 일정한 속도 */
  orbitEase: { ease: EaseName; parts: number; mirror: boolean } | null;
  /** 이 타일에서 나가는 판정에 걸린 조건 연출 (원작 SetConditionalEvents). null = 없음 */
  conds: Partial<Record<CondSlot, string>> | null;
  /** 이 타일에서 다음 타일까지 전체 박 수 (θ/180 + pause + hold). */
  beats: number;
  /** 시각적으로 도는 전체 각도. */
  sweep: number;
  bpm: number;
  /** 이 타일에 도착하는 목표 시각 (곡 기준 초). */
  time: number;
  /** 다음 타일까지 걸리는 시간 (곡 기준 초). */
  duration: number;
  /** 공전 각속도 (°/s, 부호 없음). */
  rate: number;
  midspin: boolean;
  checkpoint: boolean;
  twirl: boolean;
  /** 행성 수 (3이면 셋째 행성이 공전 행성 60° 뒤를 따른다) */
  planets: 2 | 3;
  speed: 'up' | 'down' | null;
  text: string | null;
  /** 타일 기본 회전·크기·불투명도 (원작 PositionTrack) */
  /** 타일 아이콘·판정 글자 숨김 (원작 Hide) */
  hideIcon: boolean;
  hideJudge: boolean;
  baseRot: number;
  baseScale: number;
  baseAlpha: number;
  /** 누적 박 (첫 타일 기준). */
  beatPos: number;
}

export interface TimedAction {
  action: Action;
  time: number;
  /** 초 단위 지속 시간. */
  duration: number;
}

export interface Chart {
  level: LevelData;
  tiles: ChartTile[];
  times: number[];
  /** 연출 이벤트 (시간순). */
  visual: TimedAction[];
  /** 조건 연출: 태그 → 연출 (time은 부른 순간 기준 상대 시각) */
  cond: Map<string, TimedAction[]>;
  finish: number;
  lastTime: number;
}

export const VISUAL_TYPES = new Set(['Camera', 'Flash', 'RecolorTrack', 'MoveTrack', 'Background', 'Filter', 'Bloom', 'Shake', 'TrackAnim', 'MoveDecorations', 'Planets', 'Screen', 'Sound']);

/** 레벨을 컴파일해 모든 타일의 위치·박·시각을 미리 계산한다. */
export function compileChart(level: LevelData): Chart {
  const { path, settings } = level;
  // 미드스핀 타일도 한 칸 나아간다 (path가 되돌아가는 방향이라 다음 타일은 그 앞 타일 자리) — Phantigma에서 원작과 일치 확인.
  // (#74에서 '제자리'로 바꿨다가 Phantigma 길이 뒤틀려 되돌림: ofnr에서 근거로 본 타일은 원작에서 숨겨져 있었다)
  const pos = tilePositions(path, TILE_LEN);
  const n = path.length + 1;
  const byFloor: Action[][] = Array.from({ length: n }, () => []);
  for (const a of level.actions) if (a.floor >= 0 && a.floor < n) byFloor[a.floor].push(a);

  const tiles: ChartTile[] = [];
  const times: number[] = [];
  let dir: Dir = settings.startDirection;
  let bpm = settings.bpm;
  let time = settings.offset;
  let beatPos = 0;
  let planets: 2 | 3 = 2;
  let auto = false;
  let orbitEase: ChartTile['orbitEase'] = null;
  let conds: ChartTile['conds'] = null;
  let hideIcon = false;
  let hideJudge = false;

  // 원작 PositionTrack: 타일 원래 위치 이동 + 기본 회전·크기·불투명도
  const baseRot = new Float64Array(n);
  const baseScale = new Float64Array(n).fill(1);
  const baseAlpha = new Float64Array(n).fill(1);
  for (const a of level.actions) {
    if (a.type !== 'TrackBase') continue;
    const to = Math.min(n - 1, a.to);
    for (let f = Math.max(0, a.from); f <= to; f++) {
      if (a.offset) pos[f] = { ...pos[f], x: pos[f].x + a.offset[0], y: pos[f].y + a.offset[1] };
      if (a.rotation !== undefined) baseRot[f] = a.rotation;
      if (a.scale !== undefined) baseScale[f] = a.scale;
      if (a.opacity !== undefined) baseAlpha[f] = a.opacity;
    }
  }

  for (let i = 0; i < n; i++) {
    let twirl = false;
    let midspin = false;
    let checkpoint = false;
    let pauseBeats = 0;
    let holdBeats = 0;
    let holdToNext = false;
    let text: string | null = null;
    const prevBpm = bpm;
    for (const a of byFloor[i]) {
      switch (a.type) {
        case 'Twirl':
          dir = flipDir(dir);
          twirl = !twirl;
          break;
        case 'SetSpeed':
          bpm = a.bpm !== undefined ? a.bpm : bpm * (a.multiplier ?? 1);
          break;
        case 'Midspin':
          midspin = true;
          break;
        case 'Checkpoint':
          checkpoint = true;
          break;
        case 'Pause':
          pauseBeats += a.beats;
          break;
        case 'Hold':
          holdBeats += a.beats;
          if (a.toNext) holdToNext = true;
          break;
        case 'AutoPlay':
          auto = a.enabled;
          break;
        case 'Hide':
          if (a.icons !== undefined) hideIcon = a.icons;
          if (a.judgment !== undefined) hideJudge = a.judgment;
          break;
        case 'Conditional':
          conds = Object.keys(a.on).length ? { ...a.on } : null;
          break;
        case 'PlanetEase':
          orbitEase = a.ease === 'linear' && !(a.parts && a.parts > 1) ? null : { ease: a.ease, parts: Math.max(1, a.parts ?? 1), mirror: a.mirror === true };
          break;
        case 'Text':
          text = a.text;
          break;
        case 'MultiPlanet':
          planets = a.planets;
          break;
      }
    }
    const isFinish = i === n - 1;
    // 행성 3개: 다음에 내릴 행성이 진행 방향으로 60° 앞에서 출발한다 (원작: 곧은 길 = 120°)
    const start = normDeg(entryAngle(path, i) + (planets === 3 && i > 0 ? dirSign(dir) * 60 : 0));
    const target = isFinish ? start : normDeg(path[i]);
    const theta = isFinish ? 0 : rotationTheta(start, target, dir, midspin);
    if (isFinish) {
      pauseBeats = 0;
      holdBeats = 0;
      holdToNext = false;
    }
    const beats = thetaToBeats(theta) + pauseBeats + holdBeats;
    const extra = pauseBeats + holdBeats;
    // 추가 공전은 온바퀴 단위로 돌아 목표 각도에 정확히 도착한다.
    const turns = extra > 0 ? Math.max(1, Math.round(extra / 2)) : 0;
    const sweep = theta + 360 * turns;
    const duration = (beats * 60) / bpm;
    tiles.push({
      floor: i,
      x: pos[i].x,
      y: pos[i].y,
      angleIn: i === 0 ? null : path[i - 1],
      angleOut: isFinish ? null : path[i],
      start,
      target,
      dir,
      theta,
      pauseBeats,
      holdBeats,
      holdToNext: holdToNext && holdBeats === 0,
      auto,
      orbitEase,
      conds,
      beats,
      sweep,
      bpm,
      time,
      duration,
      rate: duration > 0 ? sweep / duration : angularSpeed(bpm),
      midspin,
      checkpoint,
      twirl,
      planets,
      speed: bpm > prevBpm + 1e-9 ? 'up' : bpm < prevBpm - 1e-9 ? 'down' : null,
      text,
      beatPos,
      hideIcon,
      hideJudge,
      baseRot: baseRot[i],
      baseScale: baseScale[i],
      baseAlpha: baseAlpha[i],
    });
    times.push(time);
    time += duration;
    beatPos += beats;
  }

  const visual: TimedAction[] = [];
  const cond = new Map<string, TimedAction[]>();
  for (const a of level.actions) {
    if (!VISUAL_TYPES.has(a.type) || a.floor >= n) continue;
    const t = tiles[a.floor];
    const beats = 'duration' in a && typeof a.duration === 'number' ? a.duration : 0;
    if (a.cond) {
      let list = cond.get(a.cond);
      if (!list) cond.set(a.cond, (list = []));
      list.push({ action: a, time: ((a.delay ?? 0) * 60) / t.bpm, duration: (beats * 60) / t.bpm });
      continue;
    }
    // delay: 타일을 친 뒤 몇 박 늦게 (그 타일의 BPM 기준 — 원작 angleOffset)
    // 첫 타일의 즉시 이벤트(길이 0, 지연 없음)는 레벨 시작 상태 — 카운트다운 전부터 적용
    const atStart = a.floor === 0 && !a.delay && !(beats > 0);
    visual.push({ action: a, time: atStart ? -1e9 : t.time + ((a.delay ?? 0) * 60) / t.bpm, duration: (beats * 60) / t.bpm });
  }
  visual.sort((a, b) => a.time - b.time);

  for (const list of cond.values()) list.sort((a, b) => a.time - b.time);
  return { level, tiles, times, visual, cond, finish: n - 1, lastTime: times[n - 1] };
}

/** 타일 i가 축일 때 곡 시각 t에서 공전 행성의 각도 (도). */
export function orbiterAngle(tile: ChartTile, t: number): number {
  const oe = tile.orbitEase;
  if (oe && tile.duration > 0) {
    const p = (t - tile.time) / tile.duration;
    if (p > 0 && p < 1) {
      // 구간을 조각으로 나눠 조각마다 곡선 (Mirror면 홀수 조각은 거꾸로)
      const x = p * oe.parts;
      const k = Math.floor(x);
      const f = x - k;
      const e = oe.mirror && k % 2 === 1 ? 1 - ease(oe.ease, 1 - f) : ease(oe.ease, f);
      return tile.start + dirSign(tile.dir) * tile.sweep * ((k + e) / oe.parts);
    }
  }
  return tile.start + dirSign(tile.dir) * tile.rate * (t - tile.time);
}

/** 곡 시각 t에서 누적 박 위치 (비트 펄스, 합성 음원용). */
export function beatPhaseAt(chart: Chart, t: number): number {
  const tiles = chart.tiles;
  if (t < tiles[0].time) return ((t - tiles[0].time) * tiles[0].bpm) / 60;
  const i = floorIndex(chart.times, t);
  const tile = tiles[i];
  return tile.beatPos + ((t - tile.time) * tile.bpm) / 60;
}

/** 1박 길이 (ms, 실제 시간). */
export function beatMs(tile: ChartTile, pitch: number): number {
  return 60000 / tile.bpm / pitch;
}

/** 체크포인트 재개 시 시작할 곡 시각: 해당 타일 2박 전. */
export function resumeTime(chart: Chart, floor: number, beats = 2): number {
  const prev = chart.tiles[Math.max(0, floor - 1)];
  return chart.tiles[floor].time - (beats * 60) / prev.bpm;
}
