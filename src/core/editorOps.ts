import { compileChart } from './chart';
import { cloneLevel } from './level';
import { flipDir, mod, normDeg, snap } from './math';
import type { Action, Dir, LevelData } from './types';

/** 선택 타일 뒤에 새 타일 추가. 반환: 새 레벨과 새로 선택할 타일. */
export function insertTileAfter(level: LevelData, sel: number, angle: number): { level: LevelData; sel: number } {
  const lv = cloneLevel(level);
  const a = normDeg(angle);
  lv.path.splice(sel, 0, a);
  for (const act of lv.actions) shiftAction(act, sel, +1);
  return { level: lv, sel: sel + 1 };
}

/** 타일 sel 삭제 (타일 0은 삭제 불가). */
export function deleteTile(level: LevelData, sel: number): { level: LevelData; sel: number } {
  if (sel <= 0 || level.path.length <= 1) return { level, sel };
  const lv = cloneLevel(level);
  lv.path.splice(sel - 1, 1);
  lv.actions = lv.actions.filter((a) => a.floor !== sel);
  for (const act of lv.actions) shiftAction(act, sel, -1);
  const n = lv.path.length + 1;
  lv.actions = lv.actions.filter((a) => a.floor < n);
  return { level: lv, sel: sel - 1 };
}

function shiftAction(a: Action, pivot: number, d: 1 | -1): void {
  if (a.floor > pivot) a.floor += d;
  if (a.type === 'RecolorTrack' || a.type === 'MoveTrack' || a.type === 'TrackBase') {
    if (a.from > pivot) a.from += d;
    if (d > 0 ? a.to > pivot : a.to >= pivot) a.to += d;
    if (a.to < a.from) a.to = a.from;
  }
}

/** 타일 sel 뒤를 모두 지운다 (sel이 도착 타일이 됨). 녹화 덮어쓰기용. */
export function truncateAfter(level: LevelData, sel: number): LevelData {
  const lv = cloneLevel(level);
  lv.path = lv.path.slice(0, Math.max(1, sel));
  const last = lv.path.length;
  lv.actions = lv.actions
    .filter((a) => a.floor <= last && !(a.floor === last && (a.type === 'Hold' || a.type === 'Pause' || a.type === 'Midspin')))
    .filter((a) => !((a.type === 'RecolorTrack' || a.type === 'MoveTrack') && a.from > last));
  for (const a of lv.actions) if ((a.type === 'RecolorTrack' || a.type === 'MoveTrack' || a.type === 'TrackBase') && a.to > last) a.to = last;
  return lv;
}

/** 선택 타일의 나가는 방향 설정. */
export function setOutAngle(level: LevelData, sel: number, angle: number): LevelData {
  if (sel >= level.path.length) return level;
  const lv = cloneLevel(level);
  lv.path[sel] = normDeg(angle);
  return lv;
}

export function addAction(level: LevelData, action: Action): LevelData {
  const lv = cloneLevel(level);
  lv.actions.push(action);
  if (action.type === 'Midspin' && action.floor > 0 && action.floor < lv.path.length) {
    lv.path[action.floor] = normDeg(lv.path[action.floor - 1] + 180);
  }
  return lv;
}

export function removeAction(level: LevelData, index: number): LevelData {
  const lv = cloneLevel(level);
  lv.actions.splice(index, 1);
  return lv;
}

export function replaceAction(level: LevelData, index: number, action: Action): LevelData {
  const lv = cloneLevel(level);
  lv.actions[index] = action;
  return lv;
}

export type RecordMode = 'zigzag' | 'oneway' | 'straight';

export interface RecordResult {
  angles: number[];
  /** 추가 타일 기준 상대 floor에 넣을 Twirl (0 = 첫 추가 타일의 출발 타일). */
  twirls: number[];
}

/**
 * 녹화 모드: 누른 간격(초) → 박 수 → θ(15° 스냅) → 각도.
 * @param entry 첫 출발 타일의 공전 시작 각도
 * @param dir 첫 출발 타일의 회전 방향
 */
export function recordToAngles(
  intervals: number[],
  bpm: number,
  entry: number,
  dir: Dir,
  mode: RecordMode,
): RecordResult {
  const angles: number[] = [];
  const twirls: number[] = [];
  let start = entry;
  let d = dir;
  let turnSign = 1;
  intervals.forEach((sec, k) => {
    const beats = (sec * bpm) / 60;
    let theta = snap(beats * 180, 15);
    theta = Math.min(360, Math.max(15, theta));
    if (mode === 'straight' && Math.abs(theta - 180) <= 30) theta = 180;
    const isTurn = theta !== 180 && theta !== 360;
    if (mode === 'zigzag' && isTurn) {
      // 좌·우 꺾임을 번갈아: 필요하면 Twirl로 회전 방향 반전.
      const want: Dir = turnSign > 0 ? dir : flipDir(dir);
      if (want !== d) {
        twirls.push(k);
        d = want;
      }
      turnSign = -turnSign;
    }
    const target = d === 'CW' ? start - theta : start + theta;
    const a = normDeg(target);
    angles.push(a);
    start = mod(a + 180, 360);
  });
  return { angles, twirls };
}

/** 선택 타일 뒤에 1박 직진 타일 count개 채우기. */
export function fillStraight(level: LevelData, sel: number, count: number, bpm?: number): { level: LevelData; sel: number } {
  let lv = level;
  let s = sel;
  const dir = s === 0 ? 0 : lv.path[s - 1];
  if (bpm && bpm > 0) {
    lv = cloneLevel(lv);
    lv.actions = lv.actions.filter((a) => !(a.floor === s && a.type === 'SetSpeed'));
    lv.actions.push({ floor: s, type: 'SetSpeed', bpm });
  }
  for (let i = 0; i < count; i++) {
    const r = insertTileAfter(lv, s, dir);
    lv = r.level;
    s = r.sel;
  }
  return { level: lv, sel: s };
}

export interface FitRhythmResult {
  level: LevelData;
  /** BPM을 정한 타일 수 */
  changed: number;
  /** 건너뛴 타일 (미드스핀 등 회전이 0인 타일) */
  skipped: number;
  /** 쓴 기준 BPM */
  baseBpm: number;
}

/**
 * 정박 맞추기 (마법진): from번 타일부터 to번 타일까지, 치는 순간이 모두 정박(기준 BPM의 targetBeats 박 간격)에 오게
 * 타일마다 BPM을 정한다 — 원작 에디터 가이드의 'magic shape': 각도가 제각각인 모양을 180° 직선을 정박으로 치는 것처럼.
 *   BPM_i = 기준 BPM × (그 타일의 박 수 = 회전각/180) ÷ 목표 박 수   (쉼·홀드 박이 있으면 양쪽에 더한다)
 * - from~to-1 타일(=from에서 to까지 가는 구간)의 속도 바꾸기(SetSpeed)는 지우고 새로 넣는다.
 * - to번 타일에는 원래 그 자리의 BPM을 다시 넣어 뒤쪽 박자는 바뀌지 않는다 (이미 BPM 속도 바꾸기가 있으면 그대로).
 * - 회전이 0인 타일(미드스핀)은 건너뛴다 (앞뒤를 합쳐 한 박).
 * baseBpm을 비우면 범위 안 속도 바꾸기를 뺐을 때 from번 타일의 BPM (같은 범위에 다시 눌러도 결과가 같다).
 */
export function fitRhythm(level: LevelData, from: number, to: number, targetBeats: number, baseBpm?: number): FitRhythmResult {
  const before = compileChart(level);
  const last = before.finish;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(last, Math.max(from, to)) - 1;
  const lv = cloneLevel(level);
  lv.actions = lv.actions.filter((x) => !(x.type === 'SetSpeed' && x.floor >= a && x.floor <= b));
  const base = baseBpm && baseBpm > 0 ? baseBpm : (compileChart(lv).tiles[a]?.bpm ?? level.settings.bpm);
  if (!(targetBeats > 0) || b < a) return { level, changed: 0, skipped: 0, baseBpm: base };
  let changed = 0;
  let skipped = 0;
  for (let i = a; i <= b; i++) {
    const t = before.tiles[i];
    const turn = t.theta / 180;
    if (!(turn > 1e-9)) {
      skipped++;
      continue;
    }
    const extra = t.pauseBeats + t.holdBeats;
    const bpm = (base * (turn + extra)) / (targetBeats + extra);
    lv.actions.push({ floor: i, type: 'SetSpeed', bpm: Math.round(bpm * 1e6) / 1e6 });
    changed++;
  }
  // 뒤쪽 박자 지키기: 범위 다음 타일은 원래 BPM으로
  const next = b + 1;
  if (next <= last) {
    const own = lv.actions.filter((x) => x.type === 'SetSpeed' && x.floor === next);
    // 배율(×)로 된 속도 바꾸기는 앞 타일 BPM에 곱하므로, 앞이 바뀐 지금은 원래 결과 BPM으로 바꿔 둔다
    if (own.length === 0 || own.some((x) => x.type === 'SetSpeed' && x.bpm === undefined)) {
      lv.actions = lv.actions.filter((x) => !(x.type === 'SetSpeed' && x.floor === next));
      lv.actions.push({ floor: next, type: 'SetSpeed', bpm: before.tiles[next].bpm });
    }
  }
  return { level: lv, changed, skipped, baseBpm: base };
}

/**
 * 각도를 바꿔도 박자 유지: before → after 로 바뀐 타일(from~to)의 길이(초)가 예전과 같도록 그 타일들에 속도 바꾸기(BPM)를 넣는다.
 * 마법진을 만들 때 각도를 꺾을 때마다 박자가 틀어지지 않게 (나가는 각도를 바꾸면 그 타일과 다음 타일 회전이 함께 바뀐다).
 * 뒤 타일은 예전 BPM으로 돌려놓는다. 회전이 0인 타일(미드스핀)은 그대로.
 */
export function keepTiming(before: LevelData, after: LevelData, from: number, to: number): LevelData {
  const b = compileChart(before);
  const c = compileChart(after);
  const last = c.finish;
  const lo = Math.max(0, from);
  const hi = Math.min(last - 1, to);
  if (hi < lo) return after;
  const lv = cloneLevel(after);
  for (let i = lo; i <= hi; i++) {
    const dur = b.tiles[i]?.duration ?? 0;
    const beats = c.tiles[i].beats;
    if (!(dur > 1e-9) || !(beats > 1e-9)) continue;
    // 길이가 그대로면 손대지 않는다
    if (Math.abs(c.tiles[i].duration - dur) < 1e-9) continue;
    lv.actions = lv.actions.filter((x) => !(x.type === 'SetSpeed' && x.floor === i));
    lv.actions.push({ floor: i, type: 'SetSpeed', bpm: Math.round(((beats * 60) / dur) * 1e6) / 1e6 });
  }
  const next = hi + 1;
  if (next <= last && b.tiles[next]) {
    const own = lv.actions.filter((x) => x.type === 'SetSpeed' && x.floor === next);
    if (own.length === 0 || own.some((x) => x.type === 'SetSpeed' && x.bpm === undefined)) {
      lv.actions = lv.actions.filter((x) => !(x.type === 'SetSpeed' && x.floor === next));
      const prev = compileChart(lv).tiles[next];
      // 이미 예전 BPM이면 속도 바꾸기를 더하지 않는다
      if (Math.abs(prev.bpm - b.tiles[next].bpm) > 1e-9) lv.actions.push({ floor: next, type: 'SetSpeed', bpm: b.tiles[next].bpm });
    }
  }
  return lv;
}
