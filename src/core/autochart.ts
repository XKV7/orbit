import { defaultMeta, defaultSettings } from './level';
import { degToRad, flipDir, normDeg, TILE_LEN } from './math';
import { estimateTempo, FRAME_LAG, HOP, onsetEnvelope } from './tempo';
import { detectOnsets } from './onset';
import type { Action, Dir, LevelData } from './types';

/**
 * 음원 → 레벨 자동 생성. 순수 함수.
 *
 * 1. BPM·첫 박 추정 (또는 지정값 사용)
 * 2. 반박 격자 위의 onset 세기를 재고, 백분위 기준으로 타격 지점을 고른다.
 * 3. 간격은 반박~1.5박으로 정리(2박 이상 빈 곳은 1박 타일로 채움), 입력 간격 최소 200ms.
 * 4. 간격(박) → 각도. 트랙이 겹치지 않도록 필요할 때만 회전 반전(Twirl)을 넣는다.
 * 5. 체크포인트·색 변경 같은 이벤트는 넣지 않는다 (Twirl만). 필요하면 에디터에서 직접 추가.
 */
export type AutoDifficulty = 'easy' | 'normal' | 'hard' | 'expert' | 'master' | 'full';

export interface AutoOptions {
  difficulty?: AutoDifficulty;
  /** 지정하면 추정 대신 사용. */
  bpm?: number;
  /** 첫 박 시각 (bpm과 함께 지정). */
  offset?: number;
  title?: string;
  songFile?: string;
  /** '원곡 그대로' 민감도 (0~1). */
  sensitivity?: number;
}

export interface AutoResult {
  level: LevelData;
  bpm: number;
  offset: number;
  tiles: number;
  twirls: number;
}

const MIN_GAP_SEC = 0.2;

interface DiffCfg {
  /** 한 박 안의 격자 위치 (0 = 정박). */
  grid: number[];
  /** 백분위 기준: 정박 / 반박 / 그보다 잘게 (16분·셋잇단). 1이면 쓰지 않음. */
  beat: number;
  half: number;
  fine: number;
  /** 타일 사이 최소 박 / 최소 시간(초). */
  minBeats: number;
  minGapSec: number;
  diff: number;
}

export const DIFF_CFG: Record<AutoDifficulty, DiffCfg> = {
  easy: { grid: [0, 0.5], beat: 0.3, half: 0.9, fine: 1, minBeats: 0.5, minGapSec: 0.2, diff: 2 },
  normal: { grid: [0, 0.5], beat: 0.2, half: 0.72, fine: 1, minBeats: 0.5, minGapSec: 0.2, diff: 4 },
  hard: { grid: [0, 0.5], beat: 0.05, half: 0.45, fine: 1, minBeats: 0.5, minGapSec: 0.2, diff: 6 },
  /** 16분음표까지 */
  expert: { grid: [0, 0.25, 0.5, 0.75], beat: 0.05, half: 0.35, fine: 0.62, minBeats: 0.25, minGapSec: 0.12, diff: 8 },
  /** 16분음표 + 셋잇단 */
  master: { grid: [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75], beat: 0.02, half: 0.3, fine: 0.5, minBeats: 1 / 6, minGapSec: 0.1, diff: 10 },
  /** 원곡 그대로: 격자 대신 정밀 onset 검출(autoChartFull). 여기 값은 생성 곡용 최소 간격. */
  full: { grid: [0], beat: 0, half: 1, fine: 1, minBeats: 1 / 24, minGapSec: 0.06, diff: 10 },
};

export const DIFF_LABEL: Record<AutoDifficulty, string> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
  expert: '매우 어려움',
  master: '극한',
  full: '원곡 그대로',
};

const EPS = 1e-6;


function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/** 박 위치가 minBeats보다 가까운 후보끼리는 세기가 큰 쪽만 남긴다. */
function suppressClose<T extends { b: number; s: number }>(xs: T[], minBeats: number): T[] {
  const byStrength = [...xs].sort((a, b) => b.s - a.s);
  const kept: T[] = [];
  for (const x of byStrength) if (!kept.some((k) => Math.abs(k.b - x.b) < minBeats - EPS)) kept.push(x);
  return kept.sort((a, b) => a.b - b.b);
}

/** 곡 시각 t 근처(±30ms)의 onset 최댓값. */
export function onsetStrength(o: Float32Array, t: number): number {
  const c = Math.round((t - FRAME_LAG) / HOP);
  let m = 0;
  for (let f = c - 3; f <= c + 3; f++) if (f >= 0 && f < o.length && o[f] > m) m = o[f];
  return m;
}

/** 박 간격 목록 → 겹치지 않는 경로 (+ Twirl 위치). 꺾일 때마다 두 방향을 앞으로 몇 칸 시뮬레이션해 더 오래 비어 있는 쪽을 고른다. */
export function layoutBeats(intervals: number[], startDir: Dir = 'CW', lookahead = 12): { path: number[]; twirls: number[] } {
  const path: number[] = [];
  const twirls: number[] = [];
  const xs: number[] = [0];
  const ys: number[] = [0];
  const cell = TILE_LEN;
  const grid = new Map<string, number[]>();
  const addPt = (i: number) => {
    const k = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  };
  addPt(0);
  const LIMIT = TILE_LEN * 0.75;
  /** 기존 점(최근 2개 제외)과 LIMIT 안으로 가까워지는지. */
  const blocked = (x: number, y: number, upto: number): boolean => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (i >= upto) continue;
          if (Math.hypot(xs[i] - x, ys[i] - y) < LIMIT) return true;
        }
    return false;
  };
  const step = (heading: number, first: boolean, b: number, d: Dir) =>
    normDeg(d === 'CW' ? (first ? 180 : heading + 180) - b * 180 : (first ? 180 : heading + 180) + b * 180);
  /** 선택 후 앞으로 몇 칸이나 막히지 않고 갈 수 있는지 (같은 방향 유지 가정, 막히면 반대 방향도 시도). */
  const freeRun = (k: number, angle: number, d: Dir): number => {
    let x = xs[xs.length - 1];
    let y = ys[ys.length - 1];
    let h = angle;
    let dd = d;
    const sim: [number, number][] = [];
    const clash = (px: number, py: number, upto: number) =>
      blocked(px, py, upto) || sim.slice(0, -2).some(([sx, sy]) => Math.hypot(sx - px, sy - py) < LIMIT);
    for (let j = 0; j <= lookahead && k + j < intervals.length; j++) {
      if (j > 0) {
        const b = intervals[k + j];
        let a = step(h, false, b, dd);
        const nx = x + TILE_LEN * Math.cos(degToRad(a));
        const ny = y + TILE_LEN * Math.sin(degToRad(a));
        if (clash(nx, ny, xs.length - 1) && Math.abs(b - 1) > 1e-9) {
          const alt = step(h, false, b, flipDir(dd));
          const ax = x + TILE_LEN * Math.cos(degToRad(alt));
          const ay = y + TILE_LEN * Math.sin(degToRad(alt));
          if (!clash(ax, ay, xs.length - 1)) {
            a = alt;
            dd = flipDir(dd);
          }
        }
        h = a;
      }
      x += TILE_LEN * Math.cos(degToRad(h));
      y += TILE_LEN * Math.sin(degToRad(h));
      if (clash(x, y, xs.length - 1)) return j;
      sim.push([x, y]);
    }
    return lookahead + 1;
  };

  let dir = startDir;
  let heading = 0;
  intervals.forEach((b, k) => {
    const keep = step(heading, k === 0, b, dir);
    let angle = keep;
    if (Math.abs(b - 1) > 1e-9) {
      const runKeep = freeRun(k, keep, dir);
      if (runKeep <= lookahead) {
        const altDir = flipDir(dir);
        const alt = step(heading, k === 0, b, altDir);
        if (freeRun(k, alt, altDir) > runKeep) {
          twirls.push(k);
          dir = altDir;
          angle = alt;
        }
      }
    }
    path.push(angle);
    heading = angle;
    const i = xs.length - 1;
    xs.push(xs[i] + TILE_LEN * Math.cos(degToRad(angle)));
    ys.push(ys[i] + TILE_LEN * Math.sin(degToRad(angle)));
    addPt(xs.length - 1);
  });
  return { path, twirls };
}

/** 경로가 자기와 겹치는 쌍 수 (i와 j가 3칸 이상 떨어졌는데 0.6타일보다 가까움). */
export function countOverlaps(path: number[], same?: (i: number, j: number) => boolean): number {
  const xs = [0];
  const ys = [0];
  for (const a of path) {
    xs.push(xs[xs.length - 1] + TILE_LEN * Math.cos(degToRad(a)));
    ys.push(ys[ys.length - 1] + TILE_LEN * Math.sin(degToRad(a)));
  }
  const grid = new Map<string, number[]>();
  let bad = 0;
  const lim = TILE_LEN * 0.6;
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i] / TILE_LEN);
    const cy = Math.floor(ys[i] / TILE_LEN);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (i - j >= 3 && Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) < lim && !same?.(i, j)) bad++;
    const k = `${cx},${cy}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  }
  return bad;
}

/** 겹침 수 — 동타 묶음(이어진 미드스핀과 그 앞뒤 타일)끼리는 빼고. midspins = 미드스핀 타일 번호 */
export function overlapsBesidesMultiHits(path: number[], midspins: number[]): number {
  const ms = [...midspins].sort((a, b) => a - b);
  const chains: [number, number][] = [];
  for (const m of ms) {
    const c = chains[chains.length - 1];
    if (c && m === c[1]) c[1] = m + 1;
    else chains.push([m - 1, m + 1]);
  }
  return countOverlaps(path, (i, j) => chains.some(([a, b]) => i >= a && i <= b && j >= a && j <= b));
}

/** 정해진 회전 박·Twirl 위치로 경로 계산. */
export function layoutFixed(turns: number[], twirls: number[], startDir: Dir): number[] {
  const tw = new Set(twirls);
  const path: number[] = [];
  let dir = startDir;
  let heading = 0;
  turns.forEach((t, k) => {
    if (tw.has(k)) dir = flipDir(dir);
    const start = k === 0 ? 180 : heading + 180;
    const a = normDeg(dir === 'CW' ? start - t * 180 : start + t * 180);
    path.push(a);
    heading = a;
  });
  return path;
}

// ───────────────────────── 원작 맵처럼 꾸미기 ─────────────────────────
// 사용자가 준 원작 맵(ofnr·QuomodocunquizE·Phantigma·Cardboard)을 세어 보니: 트윌 100타일당 17~32개(겹침 피하기만이 아니라
// 구간마다 방향을 바꿔 모양을 만든다), 곧은 길 18~32%, 미드스핀(동타) 100타일당 2~3개, 빠른 구간은 속도 변경으로 길을 편다.
// 자동 생성은 읽기 쉬워야 하므로 그보다 적게, 난이도에 따라.

/** 꾸미기 수준 (0 쉬움 … 5 원곡 그대로) */
export const STYLE_LEVEL: Record<AutoDifficulty, number> = { easy: 0, normal: 1, hard: 2, expert: 3, master: 4, full: 5 };
/** 100타일당 더 넣을 꾸밈 트윌 수 (겹침 피하기 트윌과 별개, 합쳐 30개까지) · 동타(미드스핀) 수 */
const TWIRL_RATE = [1, 2, 4, 6, 8, 10];
const MIDSPIN_RATE = [0, 0, 1, 1.5, 2, 2.5];
/** 동타 한 번에 치는 수: 소리가 셀수록 많이 (사용자 요청 2·3·4·6·8·10·12·16), 난이도별 최대 */
export const MULTI_HITS = [2, 3, 4, 6, 8, 10, 12, 16];
const MULTI_MAX = [0, 0, 3, 6, 10, 16];
/** 센 정도(0~1) → 동타 수 */
export function multiHitCount(strength: number, level: number): number {
  const list = MULTI_HITS.filter((n) => n <= MULTI_MAX[level]);
  if (!list.length) return 2;
  const r = Math.max(0, Math.min(1, strength));
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

export interface StyledPlan extends PathPlan {
  /** 타일별: 누르고 있다가 다음 타일에서 떼는 홀드 */
  holds: boolean[];
  /** 미드스핀(동타) 타일 번호 */
  midspins: number[];
  path: number[];
  /** 겹침 수 (동타 묶음 안은 빼고) */
  overlaps?: number;
}

/**
 * 원작 맵처럼 꾸며 길을 배치한다 (간격 = 원래 박):
 * 1) 동타: 가장 센 강박(크래시 같은 소리) 뒤가 꺾이는 자리에 미드스핀 — 같은 순간 두 번 치기. 어려움 이상.
 * 2) 트윌: 구간(8·16박) 첫 타격·같은 꺾임이 길게 이어지는 소용돌이 가운데를 '트윌하고 싶은 자리'로 배치기에 알려 준다
 *    (겹침을 피할 수 있을 때만 그쪽을 고른다 — 나중에 트윌을 끼우면 뒤 길이 통째로 바뀌어 겹쳤다).
 * 3) 반박보다 촘촘하면 구간별 속도 변경으로 길을 편다.
 * 꾸민 길이 꾸미지 않은 길보다 더 겹치면 동타부터 빼고 다시.
 * hitBeats[i] = i+1번 타일을 치는 박, accents[i] = 그 소리 세기 (없으면 박 위치로).
 */
export function planStyled(gapsIn: number[], hitBeats: number[], accents: number[] | null, level: number, holdsIn?: boolean[], bpm = 120, maxBpm = 250): StyledPlan {
  const acc0 = accents ?? hitBeats.map((b) => (Math.abs(b / 16 - Math.round(b / 16)) < 1e-6 ? 1 : Math.abs(b / 4 - Math.round(b / 4)) < 1e-6 ? 0.5 : 0.1));
  const onGrid = (b: number, unit: number) => Math.abs(b / unit - Math.round(b / unit)) < 1e-6;
  const straight = (t: number) => Math.abs(t - 1) < 1e-9 || Math.abs(t - 2) < 1e-9;
  const ms = SPEED_MULTS.filter((m) => m <= 2 || bpm * m <= maxBpm + 1e-6);
  const fine = gapsIn.some((g) => g > 0 && g < 0.5 - 1e-9);

  const build = (withMid: boolean, withBias: boolean): StyledPlan => {
    const gaps = gapsIn.slice();
    const holds = holdsIn ? holdsIn.slice() : gaps.map(() => false);
    const hb = hitBeats.slice();
    const acc = acc0.slice();
    const zero = new Set<number>();
    /** 동타 묶음 (타일 번호 범위) — 미드스핀이 이어지면 두 자리를 오가며 겹쳐 놓이는 게 원작 모양이라 겹침으로 세지 않는다 */
    const chains: [number, number][] = [];
    // 1) 동타 자리: 반 마디 위의 센 소리, 앞뒤 간격이 반박 이상이고 뒤가 꺾이는 곳 (곧게 가면 지나온 길로 되돌아간다)
    const wantMid = withMid ? Math.floor((MIDSPIN_RATE[level] * gaps.length) / 100) : 0;
    if (wantMid > 0) {
      const sorted = acc.slice().sort((x, y) => x - y);
      const strong = sorted[Math.floor(sorted.length * 0.9)] ?? Infinity;
      const cand: number[] = [];
      for (let m = 8; m < gaps.length - 4; m++) {
        if (!onGrid(hb[m - 1], 2) || acc[m - 1] < strong) continue;
        if (gaps[m - 1] < 0.5 - 1e-9 || gaps[m] < 0.5 - 1e-9 || gaps[m] > 2 + 1e-9 || straight(gaps[m]) || holds[m] || holds[m - 1]) continue;
        cand.push(m);
      }
      cand.sort((x, y) => acc[y - 1] - acc[x - 1]);
      const chosen: number[] = [];
      for (const m of cand) {
        if (chosen.length >= wantMid) break;
        if (chosen.some((c) => Math.abs(c - m) < 16)) continue;
        chosen.push(m);
      }
      // 동타 수: 고른 자리 중 상대 세기 (가장 센 소리 = 가장 많이)
      const accMax = Math.max(...chosen.map((m) => acc[m - 1]), strong);
      for (const m of chosen.sort((x, y) => y - x)) {
        const r = accMax > strong ? (acc[m - 1] - strong) / (accMax - strong) : 0;
        const k = multiHitCount(r, level) - 1; // 같은 순간 추가 타격 수 = 미드스핀 수
        gaps.splice(m, 0, ...new Array(k).fill(0));
        holds.splice(m, 0, ...new Array(k).fill(false));
        hb.splice(m, 0, ...new Array(k).fill(hb[m - 1]));
        acc.splice(m, 0, ...new Array(k).fill(0));
        for (const c of chains) if (c[0] > m) (c[0] += k), (c[1] += k);
        chains.push([m - 1, m + k]);
      }
      gaps.forEach((g, k) => {
        if (g === 0) zero.add(k);
      });
    }
    // 2) 트윌하고 싶은 자리
    const bias = new Set<number>();
    if (withBias) {
      const want = Math.floor((TWIRL_RATE[level] * gaps.length) / 100);
      const phrase = level >= 2 ? 8 : 16;
      const cands: { k: number; score: number }[] = [];
      for (let k = 4; k < gaps.length - 2; k++) {
        if (zero.has(k) || zero.has(k - 1) || gaps[k] === 0 || straight(gaps[k])) continue;
        let score = 0;
        if (onGrid(hb[k - 1], phrase)) score = 2 + acc[k - 1];
        let run = 1;
        while (k - run >= 0 && Math.abs(gaps[k - run] - gaps[k]) < 1e-9) run++;
        if (run >= 6) score = Math.max(score, 1 + run / 10);
        if (score > 0) cands.push({ k, score });
      }
      cands.sort((x, y) => y.score - x.score);
      for (const { k } of cands) {
        if (bias.size >= want) break;
        let near = false;
        for (const t of bias) if (Math.abs(t - k) < 3) near = true;
        if (!near) bias.add(k);
      }
    }
    const nextNonZero = (k: number) => {
      for (let j = k; j < gaps.length; j++) if (gaps[j] > 0) return gaps[j];
      return 1;
    };
    const fixed = fine ? chooseMults(gaps.map((g, k) => (g > 0 ? g : nextNonZero(k))), 8, ms) : gaps.map(() => 1);
    const same = (i: number, j: number) => chains.some(([a, b]) => i >= a && i <= b && j >= a && j <= b);
    const extra = { twirlBias: bias, zero, holds: new Set(holds.flatMap((h, k) => (h ? [k] : []))) };
    // 앞보기 길이 × 시작 방향 여러 가지 중 가장 덜 겹치는 것
    // 겹침이 가장 적고, 같으면 속도 변경이 적은 것 (속도 아이콘이 많으면 읽기 어렵다)
    let best: { p: PathPlan; path: number[]; score: number } | null = null;
    for (const la of [12, 24, 40]) {
      for (const d of ['CW', 'CCW'] as Dir[]) {
        const p = planPath(gaps, d, la, fixed, fine ? ms : [1], extra);
        const path = layoutFixed(p.turns, p.twirls, p.dir);
        let changes = 0;
        for (let k = 1; k < p.mults.length; k++) if (p.mults[k] !== p.mults[k - 1]) changes++;
        const score = countOverlaps(path, same) * 1000 + changes;
        if (!best || score < best.score) best = { p, path, score };
      }
      if (best && best.score < 1000 && !fine) break;
    }
    return { ...best!.p, holds, midspins: [...zero].sort((x, y) => x - y), path: best!.path, overlaps: Math.floor(best!.score / 1000) };
  };
  const plain = build(false, false);
  let base = countOverlaps(plain.path);
  let fallback: StyledPlan = plain;
  // 반박보다 촘촘하지 않으면 예전 배치기(겹칠 때만 트윌)도 후보 — 꾸민 길이 이것보다 더 겹치면 쓰지 않는다
  if (!fine) {
    const hl = holdsIn ?? gapsIn.map(() => false);
    const turnsF = gapsIn.map((g, k) => (hl[k] && g > 1.5 + 1e-9 && g <= 3 + 1e-9 ? g - 1 : g));
    const lay = layoutBest(turnsF);
    const b = countOverlaps(lay.path);
    if (b < base) {
      base = b;
      fallback = { turns: turnsF, pauses: gapsIn.map((g, k) => g - turnsF[k]), mults: gapsIn.map(() => 1), twirls: lay.twirls, dir: lay.dir, holds: hl.slice(), midspins: [], path: lay.path };
    }
  }
  const changes = (p: PathPlan) => p.mults.reduce((a, x, k) => a + (k && x !== p.mults[k - 1] ? 1 : 0), 0);
  const plainCh = changes(fallback);
  for (const [m, t] of [
    [true, true],
    [false, true],
  ] as const) {
    if (level === 0 && m) continue;
    const st = build(m, t);
    // 겹침이 늘거나 속도 변경이 크게 늘면(아이콘이 많아 읽기 어렵다) 쓰지 않는다
    if ((st.overlaps ?? countOverlaps(st.path)) <= base && changes(st) <= plainCh + Math.max(2, Math.ceil(plainCh * 0.1))) return st;
  }
  return fallback;
}

/** 꾸민 길 → 이벤트 (트윌·일시 공전·속도 변경·미드스핀·홀드) */
export function styledActions(st: StyledPlan, bpm: number): Action[] {
  const actions: Action[] = st.twirls.map((k) => ({ floor: k, type: 'Twirl' as const }));
  st.pauses.forEach((p, k) => {
    if (p > 0) actions.push({ floor: k, type: 'Pause', beats: p });
  });
  for (let k = 1; k < st.mults.length; k++) if (st.mults[k] !== st.mults[k - 1]) actions.push({ floor: k, type: 'SetSpeed', bpm: Math.round(bpm * st.mults[k] * 1000) / 1000 });
  for (const m of st.midspins) actions.push({ floor: m, type: 'Midspin' });
  st.holds.forEach((h, k) => {
    if (h) actions.push({ floor: k, type: 'Hold', beats: 0, toNext: true });
  });
  return actions.sort((a, b) => a.floor - b.floor);
}

/** 여러 방식(앞보기 길이 × 시작 회전 방향)으로 배치해 가장 덜 겹치는 것을 고른다. */
export function layoutBest(intervals: number[]): { path: number[]; twirls: number[]; dir: Dir } {
  let best: { path: number[]; twirls: number[]; dir: Dir } | null = null;
  let bestBad = Infinity;
  for (const dir of ['CW', 'CCW'] as Dir[])
    for (const la of [12, 24, 40]) {
      const lay = layoutBeats(intervals, dir, la);
      const bad = countOverlaps(lay.path);
      // 겹침이 같으면 Twirl이 적은 쪽
      if (bad < bestBad || (bad === bestBad && best && lay.twirls.length < best.twirls.length)) {
        best = { ...lay, dir };
        bestBad = bad;
      }
      if (bestBad === 0 && dir === 'CW' && la === 12) return best!;
    }
  return best!;
}

export function autoChart(samples: Float32Array, sampleRate: number, opts: AutoOptions = {}): AutoResult | null {
  const diff = opts.difficulty ?? 'normal';
  if (diff === 'full') return autoChartFull(samples, sampleRate, { bpm: opts.bpm, offset: opts.offset, title: opts.title, songFile: opts.songFile, sensitivity: opts.sensitivity });
  const cfg = DIFF_CFG[diff];
  const est =
    opts.bpm && opts.bpm > 0
      ? { bpm: opts.bpm, offset: opts.offset ?? 0 }
      : estimateTempo(samples, sampleRate);
  if (!est) return null;
  const bpm = est.bpm;
  const beat = 60 / bpm;
  let first = est.offset;
  while (first < 1) first += beat;
  const songEnd = samples.length / sampleRate - 0.8;
  if (songEnd - first < beat * 8) return null;

  const o = onsetEnvelope(samples, sampleRate, songEnd + 2);
  if (beat < MIN_GAP_SEC) return null;
  // 이 BPM에서 너무 촘촘한 격자는 뺀다: 각 위치가 속한 박자 단위(반박·16분·셋잇단)의 간격이 최소 간격보다 짧으면 제외.
  // (16분과 셋잇단끼리 가까운 것은 아래 suppressClose가 처리)
  const unitOf = (f: number) =>
    f === 0 ? 1 : Math.abs(f * 2 - Math.round(f * 2)) < EPS ? 0.5 : Math.abs(f * 3 - Math.round(f * 3)) < EPS ? 1 / 3 : 0.25;
  const grid = cfg.grid.filter((f) => unitOf(f) * beat >= Math.min(cfg.minGapSec, 0.5 * beat) - EPS);

  // 격자 지점 세기
  type Pos = { b: number; s: number; kind: 'beat' | 'half' | 'fine' };
  const pos: Pos[] = [];
  for (let k = 0; first + k * beat < songEnd; k++)
    for (const f of grid) {
      const b = k + f;
      if (b <= 0 || first + b * beat >= songEnd) continue;
      const kind = f === 0 ? 'beat' : Math.abs(f - 0.5) < EPS ? 'half' : 'fine';
      pos.push({ b, s: onsetStrength(o, first + b * beat), kind });
    }
  const th = (kind: Pos['kind']) => {
    const p = kind === 'beat' ? cfg.beat : kind === 'half' ? cfg.half : cfg.fine;
    return p >= 1 ? Infinity : percentile(pos.filter((x) => x.kind === kind).map((x) => x.s), p);
  };
  const T = { beat: th('beat'), half: th('half'), fine: th('fine') };
  let cand = pos.filter((p) => p.s > 0 && p.s >= T[p.kind]);
  // 너무 가까운 후보(16분 vs 셋잇단 등)는 더 강한 쪽만
  cand = suppressClose(cand, cfg.minBeats);
  const picked = cand.map((p) => p.b);
  // 채움 후보: 격자 중 소리가 조금이라도 있는 곳 (세기 순 상위 절반)
  const fillTh = percentile(pos.map((p) => p.s), 0.5);
  const fill = pos.filter((p) => p.s > 0 && p.s >= fillTh).map((p) => p.b);

  // 길게 끄는 소리: 구간 안 음량이 친 직후의 절반 넘게 이어지면
  const rms = rmsEnvelope(samples, sampleRate);
  const lvl = (t: number) => rms.v[Math.max(0, Math.min(rms.v.length - 1, Math.floor(t / rms.hop)))] ?? 0;
  const sustain = (b0: number, b1: number) => {
    const t0 = first + b0 * beat;
    const t1 = first + b1 * beat;
    const start = Math.max(lvl(t0 + 0.03), lvl(t0 + 0.08));
    if (!(start > 0)) return false;
    let min = Infinity;
    for (let t = t0 + 0.25 * beat; t < t1 - 0.2 * beat; t += 0.05) min = Math.min(min, lvl(t));
    return min !== Infinity && min >= start * 0.55;
  };
  return levelFromHits(picked, bpm, first, {
    minBeats: cfg.minBeats,
    minGapSec: cfg.minGapSec,
    style: STYLE_LEVEL[diff],
    accent: (b) => onsetStrength(o, first + b * beat),
    sustain,
    fill,
    title: opts.title,
    songFile: opts.songFile,
    difficulty: cfg.diff,
    previewStart: Math.max(0, (samples.length / sampleRate) * 0.3),
  });
}

/** 음량 포락선 (RMS, hop초 간격) */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, hopSec = 0.02): { hop: number; v: Float32Array } {
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const v = new Float32Array(Math.ceil(samples.length / hop));
  for (let i = 0; i < v.length; i++) {
    let s = 0;
    const a = i * hop;
    const b = Math.min(samples.length, a + hop);
    for (let j = a; j < b; j++) s += samples[j] * samples[j];
    v[i] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { hop: hop / sampleRate, v };
}

/**
 * 타격 위치(첫 박 기준 박, 오름차순) → 레벨. 음원 분석과 음악 생성이 함께 쓴다.
 * 간격 정리: 입력 간격 최소 반박·200ms, 1.5박보다 긴 빈 곳은 1박 타일로 채운다.
 */
export function levelFromHits(
  beats: number[],
  bpm: number,
  first: number,
  opts: {
    title?: string;
    songFile?: string;
    difficulty?: number;
    previewStart?: number;
    author?: string;
    artist?: string;
    /** 빈 곳을 채울 때 우선 고를 위치 (약한 소리가 나는 박). 없으면 1박 간격. */
    fill?: number[];
    /** 타일 사이 최소 박 (기본 0.5) / 최소 시간 (기본 0.2초). */
    minBeats?: number;
    minGapSec?: number;
    /** 꾸미기 수준 (STYLE_LEVEL, 기본 1) */
    style?: number;
    /** 박 위치의 소리 세기 (동타·트윌 자리 고르기) */
    accent?: (b: number) => number;
    /** b0~b1 동안 소리가 이어지는지 (길게 끄는 음 → 홀드) */
    sustain?: (b0: number, b1: number) => boolean;
  } = {},
): AutoResult | null {
  const beat = 60 / bpm;
  const minBeats = opts.minBeats ?? 0.5;
  const minGap = opts.minGapSec ?? MIN_GAP_SEC;
  const fill = [...(opts.fill ?? [])].sort((x, y) => x - y);
  const hits: number[] = [];
  /** 홀드: hits[i]까지 가는 구간(i번 간격)을 누르고 있기 */
  const holdAt = new Set<number>();
  let prev = 0;
  for (const b of [...beats].sort((x, y) => x - y)) {
    if (b <= 0) continue;
    while (b - prev > 1.5 + 1e-9) {
      // 소리가 길게 이어지면 빈 곳을 채우지 않고 홀드 (2박까지)
      if (b - prev <= 2 + 1e-9 && hits.length > 0 && opts.sustain?.(prev, b)) {
        holdAt.add(hits.length);
        break;
      }
      // 다음 채움 위치: prev+1에 가장 가까운 소리 (prev+0.5 ~ prev+1.5, 다음 타격 0.5박 전까지)
      const lo = prev + Math.max(0.5, minGap / beat);
      const hi = Math.min(prev + 1.5, b - Math.max(minBeats, minGap / beat));
      let pickB = prev + 1;
      let best = Infinity;
      for (const f of fill) {
        if (f < lo - 1e-9) continue;
        if (f > hi + 1e-9) break;
        const d = Math.abs(f - (prev + 1));
        if (d < best) {
          best = d;
          pickB = f;
        }
      }
      prev = pickB;
      hits.push(prev);
    }
    if ((b - prev) * beat < minGap - 1e-9 || b - prev < minBeats - 1e-9) continue;
    hits.push(b);
    prev = b;
  }
  if (hits.length < 8) return null;
  const intervals = hits.map((b, i) => b - (i === 0 ? 0 : hits[i - 1]));

  // 원작 맵처럼 꾸며 배치 (동타·트윌·빠른 구간 속도 변경)
  const st = planStyled(intervals, hits, opts.accent ? hits.map((b) => opts.accent!(b)) : null, opts.style ?? 1, intervals.map((_, i) => holdAt.has(i)), bpm);
  const lay = { path: st.path, twirls: st.twirls, dir: st.dir };
  const actions = styledActions(st, bpm);
  const n = lay.path.length + 1;

  const settings = { ...defaultSettings(), bpm: Math.round(bpm * (st.mults[0] ?? 1) * 1000) / 1000, offset: Math.round(first * 1000) / 1000, songFile: opts.songFile ?? '', startDirection: lay.dir };
  const meta = {
    ...defaultMeta(),
    title: opts.title || '자동 생성 레벨',
    artist: opts.artist ?? '',
    author: opts.author ?? 'ORBIT 자동 생성',
    difficulty: opts.difficulty ?? 4,
    previewStart: Math.round((opts.previewStart ?? 0) * 10) / 10,
  };
  return {
    level: { version: 1, meta, settings, path: lay.path, actions },
    bpm,
    offset: settings.offset,
    tiles: n,
    twirls: lay.twirls.length,
  };
}

// ───────────────────────── 원곡 그대로 (모든 소리) ─────────────────────────

export interface FullOptions {
  /** 지정하면 추정 대신 사용. */
  bpm?: number;
  offset?: number;
  /** 0(큰 소리만) ~ 1(작은 소리까지). */
  sensitivity?: number;
  /** 타일 사이 최소 간격(초). 기본 0.075 (200BPM 16분까지). */
  minGapSec?: number;
  /** 가장 잘게 쪼갤 박 단위의 분모 (예: 8 → 32분음표, 12 → 16분 셋잇단). 기본 48. */
  maxDiv?: number;
  /** 빠른 구간에서 속도를 올려 길을 곧게 (기본 켜짐). */
  speedUp?: boolean;
  /** 속도를 올려도 넘지 않을 공전 BPM (기본 250, 단 2배까지는 항상 허용 → 16분 = 90°). 너무 빠르게 돌면 치기 어렵다. */
  maxBpm?: number;
  title?: string;
  songFile?: string;
  onProgress?: (r: number) => void;
}

/** 쪼갤 단위 후보 (단순한 것부터). */
const DIVS = [1, 2, 4, 3, 8, 6, 16, 12, 24, 9, 32, 18, 36, 48];

/** 박 단위의 '복잡도' (단순할수록 작음). */
function divCost(d: number): number {
  return Math.log2(d) + (d % 3 === 0 ? 0.6 : 0) + (d % 9 === 0 ? 1 : 0);
}

/**
 * 템포 후보 선택: 검출한 BPM의 1/3·1/2·2/3·1·1.5·2·3배 중에서 onset들이 가장 단순한 박(정박·반박·16분)에
 * 떨어지는 템포를 고른다. (강세가 없는 곡은 자기상관만으로 1/2·1/3 템포를 고르기 쉽다.)
 */
export function pickTempo(times: number[], bpm: number, first: number, lo = 70, hi = 240, ks = [1, 2, 3, 1.5, 0.5, 2 / 3, 1 / 3]): { bpm: number; first: number; cost: number } {
  let best = { bpm, first, cost: Infinity };
  const baseBeat = 60 / bpm;
  for (const k of ks) {
    const b = bpm * k;
    if (b < lo || b > hi) continue;
    const beat = 60 / b;
    // 느린 템포로 가면 첫 박 후보가 여러 개 (원래 박 중 어느 것이 새 정박인지)
    const shifts = k < 1 ? Math.round(1 / k) : 1;
    for (let j = 0; j < shifts; j++) {
      const f = first + j * baseBeat;
      const tol = Math.min(0.025, beat * 0.06) / beat;
      let cost = 0;
      let cnt = 0;
      for (const t of times) {
        const x = (t - f) / beat;
        if (x <= 0) continue;
        let c = divCost(48) + 2;
        for (const d of DIVS) {
          if (Math.abs(Math.round(x * d) / d - x) <= tol) {
            c = divCost(d);
            break;
          }
        }
        cost += c;
        cnt++;
      }
      if (!cnt) continue;
      // 리듬게임에서 흔한 템포(100~200)를 약하게 선호
      const pref = b < 100 ? (100 - b) / 60 : b > 200 ? (b - 200) / 60 : 0;
      const total = cost / cnt + pref;
      if (total < best.cost - 1e-9) best = { bpm: b, first: f, cost: total };
    }
  }
  return { bpm: Math.round(best.bpm * 100) / 100, first: best.first, cost: best.cost };
}

/**
 * onset 시각만으로 템포 후보 찾기: 각 BPM에서 16분 격자 위상을 2ms 칸 히스토그램으로 모아
 * ±12ms 안에 드는 비율이 가장 높은 위상을 잰다. 봉우리 상위 몇 개를 (bpm, 16분 위상)으로 돌려준다.
 * 파형 자기상관이 엉뚱한 템포(예: 125 대신 78.7)를 고를 때 보완.
 */
export function scanTempo(times: number[], lo = 70, hi = 240, top = 3): { bpm: number; phase: number; score: number }[] {
  if (times.length < 16) return [];
  const res: { bpm: number; phase: number; score: number }[] = [];
  for (let b = lo; b <= hi + 1e-9; b += 0.25) res.push({ bpm: b, ...gridFit(times, b) });
  const peaks = res.filter((r, i) => (i === 0 || r.score >= res[i - 1].score) && (i === res.length - 1 || r.score >= res[i + 1].score));
  peaks.sort((a, b) => b.score - a.score);
  const out: typeof peaks = [];
  for (const p of peaks) {
    if (out.some((o) => Math.abs(o.bpm - p.bpm) / o.bpm < 0.02)) continue;
    out.push(p);
    if (out.length >= top) break;
  }
  return out;
}

/** 한 BPM에서 16분 격자 적합도: 가장 잘 맞는 위상과 (±12ms 안 비율 − 우연히 맞을 비율). */
export function gridFit(times: number[], bpm: number): { phase: number; score: number } {
  const BIN = 0.002;
  const W = 6; // ±12ms
  const sixteenth = 60 / bpm / 4;
  const nb = Math.max(1, Math.round(sixteenth / BIN));
  const h = new Float32Array(nb);
  for (const t of times) {
    const r = ((t % sixteenth) + sixteenth) % sixteenth;
    h[Math.floor((r / sixteenth) * nb) % nb]++;
  }
  let win = 0;
  for (let i = -W; i <= W; i++) win += h[((i % nb) + nb) % nb];
  let best = win;
  let arg = 0;
  for (let c = 1; c < nb; c++) {
    win += h[(c + W) % nb] - h[(((c - W - 1) % nb) + nb) % nb];
    if (win > best) {
      best = win;
      arg = c;
    }
  }
  // 격자가 촘촘할수록 우연히 맞는 비율(2W+1)/nb 이 커지므로 뺀다
  return { phase: (arg / nb) * sixteenth, score: best / Math.max(1, times.length) - Math.min(1, (2 * W + 1) / nb) };
}

/**
 * x박을 가장 단순한 박 단위로 맞춘다: 1박, 반박, 16분, 셋잇단, 32분, 6연음, 64분, 12연음, 24분 순으로
 * 허용 오차(tol박) 안에 들어오는 첫 단위를 쓴다.
 */
export function quantizeBeat(x: number, tolBeats: number, maxDiv = 24): number {
  let best = x;
  let bestErr = Infinity;
  for (const d of DIVS) {
    if (d > maxDiv) continue;
    const q = Math.round(x * d) / d;
    const e = Math.abs(q - x);
    if (e <= tolBeats) return q;
    if (e < bestErr) {
      bestErr = e;
      best = q;
    }
  }
  return best;
}

/**
 * 타격 위치(첫 박 기준 박) → 간격 목록. 2박을 넘는 쉼은 가짜 타일 없이 일시 공전(Pause)으로.
 * 반환: 각 타일의 회전 박(0 < r ≤ 2)과 추가 공전 박.
 */
export function restsToPauses(hits: number[]): { turn: number; pause: number }[] {
  const out: { turn: number; pause: number }[] = [];
  let prev = 0;
  for (const b of hits) {
    const g = b - prev;
    prev = b;
    if (g <= 2 + 1e-9) out.push({ turn: g, pause: 0 });
    else {
      // 추가 공전은 2박 단위(한 바퀴)로 → 행성 속도가 일정
      const p = 2 * Math.ceil((g - 2) / 2 - 1e-9);
      out.push({ turn: g - p, pause: p });
    }
  }
  return out;
}

const SPEED_MULTS = [1, 2, 3, 4, 6, 8];

/**
 * 구간(프레이즈) 단위 속도 배율: 타일마다 배율을 바꾸면 읽기 어렵다 (원작 맵은 구간 경계에서만 속도를 바꾼다).
 * 비터비로 '보이는 박이 보기 좋은 범위(½~2박, 곧은길=1박)' 비용 + 변경 비용의 합이 가장 작은 배율 열을 고른다.
 * 2박을 넘는 간격은 일시 공전(Pause)으로 버틸 수 있어 4박까지 허용 (비용 있음).
 */
export function chooseMults(gaps: number[], changeCost = 8, mults: number[] = SPEED_MULTS): number[] {
  const n = gaps.length;
  if (!n) return [];
  const M = mults;
  // 보이는 회전 x박: ½~1½박(90°~270°)이 보기 좋고, 2박 가까이면 길이 되돌아와 겹친다 (360° 머리핀)
  // ¼~½박(45°~90°)은 날카로워 비용이 크지만, 속도 상한 때문에 필요할 때는 허용
  const turnCost = (t: number) =>
    t < 0.25 - 1e-9 ? Infinity : t < 0.5 - 1e-9 ? 3 + (0.5 - t) * 8 : t <= 1.5 + 1e-9 ? Math.abs(Math.log2(t)) * (t < 1 ? 1.4 : 1) : 5;
  const tileCost = (g: number, m: number) => {
    const x = g * m;
    if (x <= 2 + 1e-9) return turnCost(x);
    const pause = 2 * Math.ceil((x - 2) / 2 - 1e-9);
    if (x > 4 + 1e-9 && m !== M[0]) return Infinity; // 긴 쉼은 원래 템포에서만
    return turnCost(x - pause) + (m === M[0] ? 1 : 2);
  };
  let cost = M.map((m) => (m === 1 ? tileCost(gaps[0], 1) : Infinity));
  if (!Number.isFinite(cost[0])) cost[0] = 0; // 첫 타일은 원래 템포 고정
  const back: number[][] = [];
  for (let k = 1; k < n; k++) {
    const prev = cost;
    const bk: number[] = [];
    cost = M.map((m, j) => {
      const tc = tileCost(gaps[k], m);
      let best = Infinity;
      let arg = j;
      for (let i = 0; i < M.length; i++) {
        const c = prev[i] + (i === j ? 0 : changeCost);
        if (c < best) {
          best = c;
          arg = i;
        }
      }
      bk.push(arg);
      return best + tc;
    });
    // 어떤 배율로도 못 나타내는 간격 (극히 드묾) → 가장 가까운 배율 허용
    if (cost.every((c) => !Number.isFinite(c))) {
      const pm = Math.min(...prev);
      cost = M.map((m) => pm + changeCost + Math.abs(Math.log2(gaps[k] * m)) * 3);
      for (let j = 0; j < M.length; j++) bk[j] = prev.indexOf(pm);
    }
    back.push(bk);
  }
  let j = cost.indexOf(Math.min(...cost));
  const out = new Array<number>(n);
  for (let k = n - 1; k >= 0; k--) {
    out[k] = M[j];
    if (k > 0) j = back[k - 1][j];
  }
  return out;
}

export interface PathPlan {
  /** 타일별 보이는 회전 박 (0 < turn ≤ 2). */
  turns: number[];
  /** 타일별 추가 공전 박 (0이면 없음). */
  pauses: number[];
  /** 타일별 속도 배율. */
  mults: number[];
  twirls: number[];
  dir: Dir;
}

/**
 * 속도 배율·회전 방향을 함께 골라 길을 배치한다 (원곡 그대로 모드).
 * 각 간격 g(원래 박)마다 배율 m 후보로 보이는 박 x = g·m을 만들고, 방향(Twirl)까지 조합해
 * 앞으로 lookahead칸을 시뮬레이션해 가장 오래 겹치지 않는 선택을 한다. 배율 변경·Twirl·날카로운 꺾임에는 비용.
 */
export function planPath(
  gaps: number[],
  startDir: Dir = 'CW',
  lookahead = 12,
  fixedMults?: number[],
  mults: number[] = SPEED_MULTS,
  /** twirlBias: 트윌을 반기는 타일 (겹침이 같으면 트윌 쪽), zero: 미드스핀(간격 0) 타일 */
  extra: { twirlBias?: Set<number>; zero?: Set<number>; holds?: Set<number> } = {},
): PathPlan {
  const split0 = (x: number) => (x <= 2 + 1e-9 ? { turn: x, pause: 0 } : { turn: x - 2 * Math.ceil((x - 2) / 2 - 1e-9), pause: 2 * Math.ceil((x - 2) / 2 - 1e-9) });
  // 홀드(길게 누르기)가 1.5박을 넘으면 한 박은 제자리 공전으로 — 2박이면 U턴(360°)으로 지나온 길에 겹쳤다
  const split = (x: number, k = -1) => (extra.holds?.has(k) && x > 1.5 + 1e-9 && x <= 3 + 1e-9 ? { turn: x - 1, pause: 1 } : split0(x));
  const pen = (x: number) => (x > 2 ? 0.8 : x < 0.5 - 1e-9 ? 3 + (0.5 - x) * 8 : Math.abs(Math.log2(x)) * (x < 1 ? 1.4 : 1));
  const opts = (g: number, k: number) => {
    const base = optsFree(g);
    return fixedMults && !base.includes(fixedMults[k]) ? [fixedMults[k], ...base] : base;
  };
  const optsFree = (g: number) => {
    const ms = mults.filter((m) => g * m >= 0.5 - 1e-9 && g * m <= 2 + 1e-9);
    if (ms.length) return ms;
    const sharp = mults.filter((m) => g * m >= 0.25 - 1e-9 && g * m <= 2 + 1e-9);
    return sharp.length ? sharp : [g > 2 ? 1 : mults[mults.length - 1]];
  };
  const xs: number[] = [0];
  const ys: number[] = [0];
  const cell = TILE_LEN;
  const grid = new Map<string, number[]>();
  const addPt = (i: number) => {
    const k = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  };
  addPt(0);
  const LIMIT = TILE_LEN * 0.75;
  const blocked = (x: number, y: number, upto: number) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (i < upto && Math.hypot(xs[i] - x, ys[i] - y) < LIMIT) return true;
    return false;
  };
  const angleOf = (heading: number, first: boolean, turn: number, d: Dir) => {
    const start = first ? 180 : heading + 180;
    return normDeg(d === 'CW' ? start - turn * 180 : start + turn * 180);
  };
  /** 선택 뒤로 몇 칸이나 막히지 않는지 (이후는 배율 유지·방향 유지, 막히면 방향만 바꿔 봄). */
  const run = (k: number, angle: number, m: number, d: Dir): number => {
    let x = xs[xs.length - 1] + TILE_LEN * Math.cos(degToRad(angle));
    let y = ys[ys.length - 1] + TILE_LEN * Math.sin(degToRad(angle));
    const sim: [number, number][] = [];
    const clash = (px: number, py: number) => blocked(px, py, xs.length - 1) || sim.slice(0, -2).some(([sx, sy]) => Math.hypot(sx - px, sy - py) < LIMIT);
    if (clash(x, y)) return 0;
    sim.push([x, y]);
    let h = angle;
    let dd = d;
    let mm = m;
    for (let j = 1; j <= lookahead && k + j < gaps.length; j++) {
      const g = gaps[k + j];
      if (g === 0) {
        // 미드스핀: 제자리에서 되돌아 앞 타일 자리로
        h = normDeg(h + 180);
        x += TILE_LEN * Math.cos(degToRad(h));
        y += TILE_LEN * Math.sin(degToRad(h));
        sim.push([x, y]);
        continue;
      }
      if (fixedMults) mm = fixedMults[k + j];
      else {
        const os = opts(g, k + j);
        if (!os.includes(mm)) mm = os.reduce((a, b) => (Math.abs(Math.log2(g * b)) < Math.abs(Math.log2(g * a)) ? b : a));
      }
      const t = split(g * mm, k + j).turn;
      let a = angleOf(h, false, t, dd);
      let nx = x + TILE_LEN * Math.cos(degToRad(a));
      let ny = y + TILE_LEN * Math.sin(degToRad(a));
      if (clash(nx, ny)) {
        const alt = angleOf(h, false, t, flipDir(dd));
        const ax = x + TILE_LEN * Math.cos(degToRad(alt));
        const ay = y + TILE_LEN * Math.sin(degToRad(alt));
        if (clash(ax, ay)) return j;
        a = alt;
        dd = flipDir(dd);
        nx = ax;
        ny = ay;
      }
      x = nx;
      y = ny;
      h = a;
      sim.push([x, y]);
    }
    return lookahead + 1;
  };

  const plan: PathPlan = { turns: [], pauses: [], mults: [], twirls: [], dir: startDir };
  let dir = startDir;
  let heading = 0;
  let curM = 1;
  gaps.forEach((g, k) => {
    if (extra.zero?.has(k) && k > 0) {
      // 미드스핀: 회전 0, 속도·방향 그대로, 길은 되돌아간다
      heading = normDeg(heading + 180);
      plan.turns.push(0);
      plan.pauses.push(0);
      plan.mults.push(curM);
      const i = xs.length - 1;
      xs.push(xs[i] + TILE_LEN * Math.cos(degToRad(heading)));
      ys.push(ys[i] + TILE_LEN * Math.sin(degToRad(heading)));
      addPt(xs.length - 1);
      return;
    }
    let best: { c: number; m: number; d: Dir; angle: number; turn: number; pause: number } | null = null;
    // 첫 타일은 원래 템포
    const ms = k === 0 ? [fixedMults?.[0] ?? 1] : opts(g, k);
    for (const m of ms) {
      const { turn, pause } = split(g * m, k);
      const straight = Math.abs(turn - 1) < 1e-9 || Math.abs(turn - 2) < 1e-9;
      for (const d of straight ? [dir] : [dir, flipDir(dir)]) {
        const angle = angleOf(heading, k === 0, turn, d);
        const free = run(k, angle, m, d);
        // 구간 배율이 정해져 있으면 거기서 벗어나는 데 큰 비용 (겹침을 피할 때만)
        const mc = fixedMults ? (m !== fixedMults[k] ? 125 : 0) : m !== curM ? 2.5 : 0;
        const c = -Math.min(free, lookahead + 1) * 10 + mc + (d !== dir ? (extra.twirlBias?.has(k) ? -2 : 1.2) : 0) + pen(g * m) * 1.5;
        if (!best || c < best.c - 1e-9) best = { c, m, d, angle, turn, pause };
      }
    }
    const b = best!;
    if (b.d !== dir) plan.twirls.push(k);
    dir = b.d;
    curM = b.m;
    heading = b.angle;
    plan.turns.push(b.turn);
    plan.pauses.push(b.pause);
    plan.mults.push(b.m);
    const i = xs.length - 1;
    xs.push(xs[i] + TILE_LEN * Math.cos(degToRad(b.angle)));
    ys.push(ys[i] + TILE_LEN * Math.sin(degToRad(b.angle)));
    addPt(xs.length - 1);
  });
  return plan;
}

/** 모든 소리를 타일로. 박을 찾지 못하면 null. */
export function autoChartFull(samples: Float32Array, sampleRate: number, opts: FullOptions = {}): AutoResult | null {
  const given = !!(opts.bpm && opts.bpm > 0);
  const est = given ? { bpm: opts.bpm!, offset: opts.offset ?? 0 } : estimateTempo(samples, sampleRate);
  if (!est) return null;
  const minGap = opts.minGapSec ?? 0.075;
  const maxDiv = opts.maxDiv ?? 48;
  const onsets = detectOnsets(samples, sampleRate, { sensitivity: opts.sensitivity, minGap: Math.min(minGap, 0.05), onProgress: opts.onProgress });
  let bpm = est.bpm;
  let first = est.offset;
  if (!given) {
    const strongTimes = onsets.filter((o) => o.s >= 1.2).map((o) => o.t);
    const times = strongTimes.length >= 16 ? strongTimes : onsets.map((o) => o.t);
    let best = pickTempo(times, bpm, first);
    // 파형 추정이 엉뚱할 때: onset 격자 스캔의 최고 봉우리가 훨씬 잘 맞으면 그쪽 (16분 위상 → 정박 위상 4가지 중 선택)
    const seed = scanTempo(times, 70, 240, 1)[0];
    if (seed && seed.score > gridFit(times, best.bpm).score * 1.4 + 0.02) {
      const q = 60 / seed.bpm / 4;
      let alt: ReturnType<typeof pickTempo> | null = null;
      for (let j = 0; j < 4; j++) {
        const c = pickTempo(times, seed.bpm, seed.phase + j * q, 70, 240, [1]); // 스캔이 이미 격자 적합도로 고른 템포
        if (!alt || c.cost < alt.cost) alt = c;
      }
      best = alt!;
    }
    ({ bpm, first } = best);
  }
  const beat = 60 / bpm;
  while (first < 1) first += beat;
  const songEnd = samples.length / sampleRate - 0.3;

  // 1) 박 위치로 변환 + 템포 흔들림 보정 (정박·반박 근처의 뚜렷한 소리로 위상을 천천히 따라감)
  //    허용 박 단위: 정박·반박·16분·셋잇단·6연음, 곡이 느리면 32분·12연음까지 (최소 간격보다 촘촘한 단위는 제외)
  const allowed = [1, 2, 4, 3, 6, 8, 12].filter((d) => d <= 4 || beat / d >= minGap * 0.95).filter((d) => d <= maxDiv);
  const tolStrict = Math.min(0.015, beat * 0.05) / beat; // 15ms 또는 0.05박
  const tolCoh = Math.min(0.012, beat * 0.04) / beat;
  let drift = 0;
  const strengths = onsets.map((o) => o.s).sort((a, b) => a - b);
  const median = strengths.length ? strengths[Math.floor(strengths.length * 0.5)] : 0;
  const strongRef = strengths.length ? strengths[Math.floor(strengths.length * 0.9)] : 0;
  type Cand = { raw: number; q: number; err: number; s: number };
  const cands: Cand[] = [];
  for (const o of onsets) {
    if (o.t <= first + 0.02 || o.t >= songEnd) continue;
    const raw = (o.t - first) / beat - drift;
    let q = raw;
    let err = Infinity;
    for (const d of allowed) {
      const qq = Math.round(raw * d) / d;
      const e = Math.abs(qq - raw);
      if (e <= tolStrict) {
        q = qq;
        err = e;
        break;
      }
      if (e < err) {
        err = e;
        q = qq;
      }
    }
    const half = Math.round(raw * 2) / 2;
    if (o.s >= median && Math.abs(raw - half) < 0.12) drift += (raw - half) * 0.15;
    cands.push({ raw, q, err, s: o.s });
  }
  // 2) 리듬 일관성: 앞뒤 2박 안의 소리 중 16분 격자(정박·반박·16분)에 딱 맞는 비율.
  //    낮으면 박자가 아닌 구간(잡음·잔향·흔들리는 보컬). 격자가 촘촘할수록 우연히 맞기 쉬워 16분 격자만 본다.
  const coherent = cands.map((c) => Math.abs(Math.round(c.raw * 4) / 4 - c.raw) <= tolCoh);
  // 아주 약한 소리 하한 (가장 큰 소리 대비, 민감도 높을수록 낮게)
  const sens = Math.max(0, Math.min(1, opts.sensitivity ?? 0.55));
  const weakFloor = strongRef * (0.06 - 0.05 * sens);
  const keep: Cand[] = [];
  let lo = 0;
  let hi = 0;
  let inWin = 0;
  let cohWin = 0;
  for (let i = 0; i < cands.length; i++) {
    while (hi < cands.length && cands[hi].raw <= cands[i].raw + 2) {
      inWin++;
      if (coherent[hi]) cohWin++;
      hi++;
    }
    while (cands[lo].raw < cands[i].raw - 2) {
      inWin--;
      if (coherent[lo]) cohWin--;
      lo++;
    }
    const c = cands[i];
    if (c.err > tolStrict) continue; // 박 위치에서 벗어난 소리
    if (c.s < weakFloor) continue;
    // 잘게 쪼갠 위치(16분·셋잇단 등)는 주변 박 소리의 대표 세기에 비해 충분히 뚜렷해야 한다
    const onHalf = Math.abs(c.q * 2 - Math.round(c.q * 2)) < 1e-6;
    const local: number[] = [];
    for (let j = lo; j < hi; j++) if (coherent[j]) local.push(cands[j].s);
    local.sort((a, b) => a - b);
    const med = local.length ? local[local.length >> 1] : 0;
    if (c.s < med * (onHalf ? 0.25 - 0.15 * sens : 0.4 - 0.3 * sens)) continue;
    // 소리가 적은 구간은 우연히 맞을 수 있어 더 엄격하게 (분모에 여유 1.5)
    const rhythmic = cohWin / (inWin + 1.5) >= 0.5;
    if (!rhythmic && c.s < strongRef * 0.6) continue; // 박자 없는 구간에서는 아주 큰 소리만
    keep.push(c);
  }
  // 3) 최소 간격: 가까운 두 소리 중 더 큰 쪽
  const hits: number[] = [];
  const hitS: number[] = [];
  for (const c of keep) {
    if (c.q <= 0) continue;
    const k = hits.length - 1;
    if (k >= 0 && (c.q <= hits[k] + 1e-9 || (c.q - hits[k]) * beat < minGap - 1e-9)) {
      if (c.s > hitS[k] && (k === 0 || (c.q - hits[k - 1]) * beat >= minGap - 1e-9) && c.q > (hits[k - 1] ?? 0)) {
        hits[k] = c.q;
        hitS[k] = c.s;
      }
      continue;
    }
    hits.push(c.q);
    hitS.push(c.s);
  }
  if (hits.length < 8) return null;

  // 간격(원래 박) → 속도 배율·방향을 함께 계획 → 보이는 박 (2박 초과는 일시 공전)
  const gaps = hits.map((b, i) => b - (i === 0 ? 0 : hits[i - 1]));
  let st: StyledPlan;
  if (opts.speedUp === false) {
    const segs = restsToPauses(hits);
    const lay = layoutBest(segs.map((x) => x.turn));
    st = { turns: segs.map((x) => x.turn), pauses: segs.map((x) => x.pause), mults: gaps.map(() => 1), twirls: lay.twirls, dir: lay.dir, holds: gaps.map(() => false), midspins: [], path: lay.path };
  } else {
    // 속도 배율·방향을 함께 계획하고 원작 맵처럼 꾸민다 (동타·트윌) — 겹침이 늘지 않을 때만
    st = planStyled(gaps, hits, hitS, STYLE_LEVEL.full, undefined, bpm, opts.maxBpm ?? 250);
  }
  const mults = st.mults;
  const lay = { path: st.path, twirls: st.twirls, dir: st.dir };
  const actions = styledActions(st, bpm);
  const startBpm = Math.round(bpm * (mults[0] ?? 1) * 1000) / 1000;
  // 첫 박(타일 0 시각)은 원래 템포 기준 — 시작 배율이 1이 아니어도 박 시각은 곡에 맞다
  const settings = { ...defaultSettings(), bpm: startBpm, offset: Math.round(first * 1000) / 1000, songFile: opts.songFile ?? '', startDirection: lay.dir };
  const meta = {
    ...defaultMeta(),
    title: opts.title || '자동 생성 레벨',
    artist: '',
    author: 'ORBIT 자동 생성 (원곡 그대로)',
    difficulty: 10,
    previewStart: Math.round(Math.max(0, (samples.length / sampleRate) * 0.3) * 10) / 10,
  };
  return {
    level: { version: 1, meta, settings, path: lay.path, actions },
    bpm,
    offset: settings.offset,
    tiles: lay.path.length + 1,
    twirls: lay.twirls.length,
  };
}
