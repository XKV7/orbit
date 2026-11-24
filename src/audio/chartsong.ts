/**
 * 채보에 맞춰 노래 만들기: 만든 맵(타일 치는 시각·BPM)을 읽어 그 위에 곡을 작곡·합성한다.
 * 멜로디는 타일을 치는 순간마다 한 음씩 (빠른 연타 = 아르페지오, 홀드 = 길게), 드럼·베이스·화음은 맵의 박에 맞춘다.
 * 장르: 칩튠 · 스피드코어 · 리듬코어 · 아트코어 — 음색·드럼 패턴·화음 진행이 다르다.
 * 순수 함수 — DOM·Web Audio 없이 샘플 배열만 만든다 (모노).
 */
import type { Chart } from '../core/chart';

export type Genre = 'chiptune' | 'speedcore' | 'rhythmcore' | 'artcore';

export const GENRES: { value: Genre; label: string; hint: string }[] = [
  { value: 'chiptune', label: '칩튠', hint: '옛 게임기 소리 · 사각파 멜로디와 빠른 아르페지오' },
  { value: 'speedcore', label: '스피드코어', hint: '찌그러진 킥 연타 · 아주 빠르고 거친 신스' },
  { value: 'rhythmcore', label: '리듬코어', hint: '쪼개진 박 · 글리치 · 엇박 강조' },
  { value: 'artcore', label: '아트코어', hint: '피아노·현악 분위기 + 브레이크비트 (합성 소리라 분위기만)' },
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

interface GenreSpec {
  scale: number[];
  /** 마디마다 화음 (음계 도수, 0 = 으뜸) */
  progs: number[][];
  /** 멜로디 기준 높이 (MIDI) */
  root: number;
}

const SPEC: Record<Genre, GenreSpec> = {
  chiptune: { scale: MAJOR, progs: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]], root: 72 },
  speedcore: { scale: MINOR, progs: [[0, 5, 6, 4], [0, 6, 5, 6], [0, 3, 5, 4]], root: 69 },
  rhythmcore: { scale: MINOR, progs: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 6, 5]], root: 72 },
  artcore: { scale: MINOR, progs: [[5, 6, 0, 0], [0, 5, 2, 6], [3, 4, 0, 5]], root: 74 },
};

/** 곡의 박: 시각(초)과 그 박의 BPM. 맵의 진짜 템포 변화(4타일·2초 넘게 이어진 BPM)에만 따라가고, 마법진처럼 타일마다 바뀌는 BPM은 무시. */
export function beatGrid(chart: Chart, end: number): { t: number; bpm: number }[] {
  const tiles = chart.tiles;
  const last = Math.max(1, chart.finish);
  // 템포 구간
  const changes: { t: number; bpm: number }[] = [{ t: tiles[0].time, bpm: tiles[0].bpm }];
  let i = 1;
  while (i < last) {
    const b = tiles[i].bpm;
    if (Math.abs(b - changes[changes.length - 1].bpm) > 0.01) {
      let j = i;
      while (j < last && Math.abs(tiles[j].bpm - b) < 0.01) j++;
      const lasting = j - i >= 4 && tiles[Math.min(j, last)].time - tiles[i].time >= 2;
      if (lasting) changes.push({ t: tiles[i].time, bpm: b });
      i = Math.max(j, i + 1);
    } else i++;
  }
  // 박 다시 맞추기: 타일이 박에서 벗어나고(예: 각도 때문에 ¼박 밀림) 그 뒤 4타일이 새 자리 기준으로 반 박 단위면 거기서 박을 다시 시작
  const anchors: { t: number; bpm: number }[] = [];
  {
    let ci = 0;
    let o = changes[0];
    const onGrid = (dt: number, spb: number) => {
      const x = (dt / spb) * 2;
      return Math.abs(x - Math.round(x)) < 0.08;
    };
    for (let k = 1; k <= last; k++) {
      while (ci + 1 < changes.length && tiles[k].time >= changes[ci + 1].t - 1e-6) o = changes[++ci];
      const t = tiles[k].time;
      const spb = 60 / o.bpm;
      if (onGrid(t - o.t, spb)) continue;
      let ok = true;
      for (let m = k + 1; m <= Math.min(last, k + 4); m++) if (!onGrid(tiles[m].time - t, spb)) ok = false;
      if (ok) {
        o = { t, bpm: o.bpm };
        anchors.push(o);
      }
    }
  }
  changes.push(...anchors);
  changes.sort((a, b) => a.t - b.t);
  // 템포가 너무 느리거나 빠르면 박을 2배·반으로 (드럼이 자연스럽게)
  const norm = (b: number) => {
    let x = b;
    while (x < 80) x *= 2;
    while (x > 260) x /= 2;
    return x;
  };
  const out: { t: number; bpm: number }[] = [];
  // 첫 구간: 첫 타일 시각에서 앞으로 거슬러 0초까지
  const first = changes[0];
  const spb0 = 60 / norm(first.bpm);
  for (let k = 1; first.t - k * spb0 >= -1e-6; k++) out.unshift({ t: first.t - k * spb0, bpm: norm(first.bpm) });
  for (let c = 0; c < changes.length; c++) {
    const bpm = norm(changes[c].bpm);
    const until = c + 1 < changes.length ? changes[c + 1].t - 1e-4 : end;
    // 곱해서 (더해 가면 긴 곡에서 오차가 쌓인다)
    for (let k = 0; changes[c].t + (k * 60) / bpm < until; k++) out.push({ t: changes[c].t + (k * 60) / bpm, bpm });
  }
  return out;
}

interface Note {
  t: number;
  dur: number;
  midi: number;
  vel: number;
}

/** 구간 종류 (맵의 타일 밀도로 정한다) */
export type SectionKind = 'intro' | 'break' | 'verse' | 'build' | 'drop' | 'outro';

/**
 * 4마디 구간마다 종류를 정한다: 타일이 드문 곳 = 쉼(break), 보통 = 벌스, 빽빽한 곳 = 드랍, 드랍 바로 앞 구간의 마지막 마디 = 빌드업.
 * barHits[i] = i번째 마디의 타격 수. 반환: 마디마다 종류.
 */
export function planSections(barHits: number[]): SectionKind[] {
  const n = barHits.length;
  const out: SectionKind[] = new Array(n).fill('verse');
  if (!n) return out;
  const phrases = Math.ceil(n / 4);
  const dens: number[] = [];
  for (let p = 0; p < phrases; p++) {
    let s = 0;
    let c = 0;
    for (let b = p * 4; b < Math.min(n, p * 4 + 4); b++) {
      s += barHits[b];
      c++;
    }
    dens.push(s / Math.max(1, c));
  }
  const sorted = dens.filter((d) => d > 0).sort((x, y) => x - y);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
  const lo = q(0.3);
  const hi = q(0.65);
  const kinds: SectionKind[] = dens.map((d) => (d <= 0 ? 'break' : sorted.length >= 3 && d >= hi && d > lo ? 'drop' : sorted.length >= 3 && d <= lo && d < hi ? 'break' : 'verse'));
  // 곡 처음 구간은 드랍이 아니면 도입
  if (kinds[0] !== 'drop') kinds[0] = 'intro';
  for (let p = 0; p < phrases; p++) for (let b = p * 4; b < Math.min(n, p * 4 + 4); b++) out[b] = kinds[p];
  // 드랍 앞 구간의 마지막 마디는 빌드업
  for (let p = 1; p < phrases; p++) if (kinds[p] === 'drop' && kinds[p - 1] !== 'drop') out[Math.min(n - 1, p * 4 - 1)] = 'build';
  return out;
}

/** 구간별 편곡: 드럼 세기(0 없음·1 가볍게·2 전부), 베이스, 화음, 리드 옥타브, 대선율, 음량 */
const ARR: Record<SectionKind, { drums: 0 | 1 | 2; bass: boolean; pad: boolean; oct: number; counter: boolean; gain: number; prog: number }> = {
  intro: { drums: 1, bass: false, pad: true, oct: 0, counter: false, gain: 0.6, prog: 0 },
  break: { drums: 0, bass: false, pad: true, oct: 0, counter: false, gain: 0.55, prog: 2 },
  verse: { drums: 1, bass: true, pad: true, oct: 0, counter: false, gain: 0.8, prog: 0 },
  build: { drums: 1, bass: true, pad: true, oct: 0, counter: false, gain: 0.85, prog: 0 },
  drop: { drums: 2, bass: true, pad: true, oct: 12, counter: true, gain: 1, prog: 1 },
  outro: { drums: 1, bass: true, pad: true, oct: 0, counter: false, gain: 0.6, prog: 0 },
};

/**
 * 맵 → 곡 (모노 샘플). seed가 같으면 같은 곡.
 * 곡 구조: 맵의 타일 밀도로 4마디 구간을 도입·벌스·빌드업·드랍·쉼으로 나눠 악기·드럼·화음 진행·음량을 바꾸고,
 * 빌드업에 스네어 연타·상승음, 드랍 첫 박에 크래시·서브 드롭, 4마디마다 드럼 필. 마지막 드랍은 반음 올림.
 * 멜로디: 타일 모양을 따라 움직인다 (크게 꺾일수록 큰 도약, 회전 방향이 바뀌면 오르내림도 바뀜) + 같은 리듬이 다시 나오면 같은 선율(주제)을 다시 쓴다.
 * 믹스: 악기 묶음별로 따로 그려 킥에 맞춰 다른 소리를 살짝 눌렀다 올리고(펌핑), 구간 음량을 곱한다. 끝에서 세게 누르지 않는다 (예전엔 끝까지 크기가 같았다).
 */
export function chartSong(chart: Chart, genre: Genre, seed: number, sampleRate = 44100): Float32Array {
  const spec = SPEC[genre];
  const rand = rng(seed * 7919 + genre.length);
  const tiles = chart.tiles;
  const last = chart.finish;
  // 치는 순간 (미드스핀처럼 같은 순간은 하나로) + 그 타일의 꺾임·회전 방향
  const hits: { t: number; hold: number; theta: number; turnFlip: boolean }[] = [];
  for (let i = 1; i <= last; i++) {
    const t = tiles[i].time;
    if (hits.length && t - hits[hits.length - 1].t < 0.005) continue;
    const prev = tiles[i - 1];
    if (prev.holdBeats > 0 && hits.length) hits[hits.length - 1].hold = 1;
    hits.push({ t, hold: 0, theta: tiles[i].theta, turnFlip: i > 1 && tiles[i].dir !== tiles[i - 1].dir });
  }
  const songEnd = (hits.length ? hits[hits.length - 1].t : tiles[0].time) + 3;
  const grid = beatGrid(chart, songEnd);
  const len = Math.ceil((songEnd + 1.5) * sampleRate);
  // 악기 묶음 (따로 그려 펌핑·구간 음량)
  const bus = { kick: new Float32Array(len), drums: new Float32Array(len), bass: new Float32Array(len), pad: new Float32Array(len), lead: new Float32Array(len), fx: new Float32Array(len) };
  type Bus = keyof typeof bus;
  let target: Float32Array = bus.drums;
  const key0 = Math.floor(rand() * 7) - 3;

  // 박 → 마디
  const firstHitBeat = hits.length ? Math.max(0, grid.findIndex((g) => g.t >= hits[0].t - 0.02)) : 0;
  const barOfBeat = (b: number) => Math.floor((b - firstHitBeat) / 4);
  const beatIndexAt = (t: number) => {
    let lo = 0;
    let hi = grid.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (grid[m].t <= t + 0.02) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  // 마디별 타격 수 → 구간
  const nBars = Math.max(1, barOfBeat(grid.length - 1) + 1);
  const barHits = new Array(nBars).fill(0);
  for (const h of hits) {
    const br = barOfBeat(beatIndexAt(h.t));
    if (br >= 0 && br < nBars) barHits[br]++;
  }
  const lastHitBar = hits.length ? barOfBeat(beatIndexAt(hits[hits.length - 1].t)) : 0;
  const sections = planSections(barHits.slice(0, lastHitBar + 1));
  const sectionOf = (bar: number): SectionKind => (bar < 0 ? 'intro' : bar > lastHitBar ? 'outro' : sections[bar] ?? 'verse');
  // 마지막 드랍 묶음은 반음 올림 (드랍 묶음이 둘 이상일 때)
  const dropStarts: number[] = [];
  sections.forEach((k, i) => {
    if (k === 'drop' && sections[i - 1] !== 'drop') dropStarts.push(i);
  });
  const keyUpFrom = dropStarts.length >= 2 ? dropStarts[dropStarts.length - 1] : Infinity;
  const keyAt = (bar: number) => key0 + (bar >= keyUpFrom ? 1 : 0);
  const progFor = (kind: SectionKind) => spec.progs[(ARR[kind].prog + Math.floor(seed % 3)) % spec.progs.length];
  const chordAtBar = (bar: number) => {
    const pr = progFor(sectionOf(bar));
    const i = ((bar % pr.length) + pr.length) % pr.length;
    return pr[i];
  };
  const deg = (d: number, base: number, bar: number) => {
    const o = Math.floor(d / 7);
    const k = ((d % 7) + 7) % 7;
    return base + keyAt(bar) + o * 12 + spec.scale[k];
  };
  const chordTones = (bar: number) => {
    const c = chordAtBar(bar);
    return [c, c + 2, c + 4];
  };

  // ── 멜로디: 타일 모양을 따라 + 같은 리듬이면 같은 선율 ──
  const mel: (Note & { bar: number })[] = [];
  const motifs = new Map<string, number[]>(); // 2마디 리듬 → 화음 근음 기준 도수들
  let cur = 2;
  let dir = 1;
  let arpDir = 1;
  // 2마디 단위로 묶기
  const groups = new Map<number, number[]>();
  hits.forEach((h, i) => {
    const b = beatIndexAt(h.t);
    const g = Math.floor(barOfBeat(b) / 2);
    const arr = groups.get(g);
    if (arr) arr.push(i);
    else groups.set(g, [i]);
  });
  const motifUse = new Map<string, number>();
  for (const [g, idxs] of [...groups.entries()].sort((x, y) => x[0] - y[0])) {
    // 리듬 서명: 2마디 시작 박 기준 위치 (1/8박 단위)
    const startBeat = firstHitBeat + g * 8;
    const pos = (i: number) => {
      const b = beatIndexAt(hits[i].t);
      const gb = grid[b];
      const frac = gb ? (hits[i].t - gb.t) / (60 / gb.bpm) : 0;
      return Math.round((b - startBeat + frac) * 8);
    };
    const sig = idxs.length >= 3 ? idxs.map(pos).join(',') : '';
    const known = sig ? motifs.get(sig) : undefined;
    const used = sig ? (motifUse.get(sig) ?? 0) : 0;
    if (sig) motifUse.set(sig, used + 1);
    const degs: number[] = [];
    idxs.forEach((i, j) => {
      const h = hits[i];
      const next = hits[i + 1]?.t ?? h.t + 0.5;
      const gap = next - h.t;
      const b = beatIndexAt(h.t);
      const bar = barOfBeat(b);
      const tones = chordTones(bar);
      const onBeat = Math.abs((grid[b]?.t ?? h.t) - h.t) < 0.03;
      if (known && j < known.length && !(used % 3 === 2 && j >= idxs.length - 2)) {
        // 주제 다시 쓰기: 화음 근음만큼 옮긴다 (세 번째마다 끝 두 음은 바꿔 변주)
        cur = tones[0] + known[j];
      } else if (gap < 0.13) {
        // 빠른 연타: 화음을 오르내리는 아르페지오
        const near = tones.map((x) => x + 7 * Math.round((cur - x) / 7));
        let best = near[0];
        for (const x of near) if ((x - cur) * arpDir > 0 && Math.abs(x - cur) <= 4) best = x;
        if (best === cur || (best - cur) * arpDir <= 0) best = cur + arpDir * 2;
        cur = best;
        if (cur > 9 || cur < -3) arpDir = -arpDir;
      } else {
        // 타일 모양: 회전 방향이 바뀌면 오르내림도 바뀌고, 크게 꺾일수록(각도 작을수록·클수록) 큰 도약
        if (h.turnFlip) dir = -dir;
        const bend = Math.abs(180 - h.theta);
        const step = h.theta === 0 ? 0 : bend < 20 ? 1 : bend < 70 ? 2 : 3;
        let nx = cur + dir * step;
        if (onBeat) {
          // 박 위는 화음 음으로
          const near = tones.map((x) => x + 7 * Math.round((nx - x) / 7));
          nx = near.reduce((a, x) => (Math.abs(x - nx) < Math.abs(a - nx) ? x : a), near[0]);
        }
        if (nx > 9 || nx < -3) {
          dir = -dir;
          nx = cur + dir * step;
        }
        cur = nx;
        // 마디 끝 음(다음 타격이 다음 마디) = 대답: 근음 쪽으로 정리
        if (rand() < 0.3 && j === idxs.length - 1) cur = tones[0] + 7 * Math.round((cur - tones[0]) / 7);
      }
      cur = Math.max(-4, Math.min(11, cur));
      degs.push(cur - tones[0]);
      const kind = sectionOf(bar);
      const dur = h.hold ? gap : Math.min(gap * 0.92, 60 / (grid[b]?.bpm ?? 120));
      // 사람이 친 듯: 세기 조금씩 다르게
      const vel = (onBeat ? 1 : 0.85) * (0.9 + rand() * 0.2);
      // 드랍은 한 옥타브 위로 (너무 높으면 내린다 — 귀가 아프다)
      let midi = deg(cur, spec.root + ARR[kind].oct, bar);
      while (midi > 88) midi -= 12;
      mel.push({ t: h.t, dur: Math.max(0.04, dur), midi, vel, bar });
    });
    if (sig && !known) motifs.set(sig, degs);
  }

  // ── 소리 ──
  const nrand = rng(seed * 31 + 7);
  const noise = () => nrand() * 2 - 1;
  const add = (start: number, sec: number, f: (tt: number) => number) => {
    const s0 = Math.floor(start * sampleRate);
    const n = Math.floor(sec * sampleRate);
    const o = target;
    for (let i = 0; i < n; i++) {
      const idx = s0 + i;
      if (idx < 0 || idx >= len) continue;
      o[idx] += f(i / sampleRate);
    }
  };
  const on = (b: Bus) => {
    target = bus[b];
  };
  const env = (tt: number, a: number, dur: number, r: number) => Math.min(1, tt / a) * (tt > dur ? Math.max(0, 1 - (tt - dur) / r) : 1);
  const hum = () => 0.88 + rand() * 0.24;
  const kickTimes: number[] = [];

  const kick = (t: number, v: number, drive = 1) => {
    on('kick');
    kickTimes.push(t);
    let ph = 0;
    add(t, 0.28, (tt) => {
      ph += (2 * Math.PI * (48 + 160 * Math.exp(-tt * 35))) / sampleRate;
      const s = Math.sin(ph) * Math.exp(-tt * (drive > 1 ? 14 : 10));
      return Math.tanh(s * drive) * 0.8 * v;
    });
  };
  const snare = (t: number, v: number, tone = 190) => {
    on('drums');
    let lp = 0;
    let ph = 0;
    add(t, 0.2, (tt) => {
      const nz = noise();
      lp += (nz - lp) * 0.5;
      ph += (2 * Math.PI * tone) / sampleRate;
      return ((nz - lp) * Math.exp(-tt * 20) + Math.sin(ph) * 0.5 * Math.exp(-tt * 30)) * 0.38 * v;
    });
  };
  const tom = (t: number, v: number, f0: number) => {
    on('drums');
    let ph = 0;
    add(t, 0.25, (tt) => {
      ph += (2 * Math.PI * f0 * (1 + 0.5 * Math.exp(-tt * 20))) / sampleRate;
      return Math.sin(ph) * Math.exp(-tt * 12) * 0.45 * v;
    });
  };
  const hat = (t: number, v: number, decay = 80) => {
    on('drums');
    let prev = 0;
    add(t, 0.06, (tt) => {
      const nz = noise();
      const hp = nz - prev;
      prev = nz;
      return hp * Math.exp(-tt * decay) * 0.09 * v;
    });
  };
  const crash = (t: number, v: number) => {
    on('fx');
    let prev = 0;
    add(t, 1.6, (tt) => {
      const nz = noise();
      const hp = nz - prev;
      prev = nz;
      return hp * Math.exp(-tt * 2.5) * 0.07 * v;
    });
  };
  /** 빌드업 상승음: 걸러진 잡음이 점점 밝고 커지며, 사인이 위로 미끄러진다 */
  const riser = (t: number, sec: number, v: number) => {
    on('fx');
    let lp = 0;
    let ph = 0;
    add(t, sec, (tt) => {
      const p = tt / sec;
      lp += (noise() - lp) * (0.02 + 0.5 * p * p);
      ph += (2 * Math.PI * 200 * Math.pow(6, p)) / sampleRate;
      return (lp * 0.5 + Math.sin(ph) * 0.15) * p * p * v;
    });
  };
  /** 드랍 첫 박 서브 드롭 (낮게 떨어지는 사인) */
  const subDrop = (t: number, v: number) => {
    on('fx');
    let ph = 0;
    add(t, 0.8, (tt) => {
      ph += (2 * Math.PI * (35 + 90 * Math.exp(-tt * 4))) / sampleRate;
      return Math.sin(ph) * Math.exp(-tt * 3) * 0.5 * v;
    });
  };
  const chipNoise = (t: number, v: number, sec: number) => {
    on('drums');
    let hold = 0;
    add(t, sec, (tt) => {
      if (Math.floor(tt * 8000) !== Math.floor((tt - 1 / sampleRate) * 8000)) hold = nrand() < 0.5 ? -1 : 1;
      return hold * Math.exp(-tt * (6 / sec)) * 0.12 * v;
    });
  };
  const pulse = (t: number, dur: number, midi: number, v: number, duty = 0.25, slide = 0) => {
    const f0 = mtof(midi);
    add(t, dur + 0.02, (tt) => {
      const f = f0 * (slide ? Math.pow(2, (slide * Math.max(0, 0.04 - tt)) / 12 / 0.04) : 1);
      return ((tt * f) % 1 < duty ? 1 : -1) * env(tt, 0.002, dur, 0.02) * 0.11 * v;
    });
  };
  const tri = (t: number, dur: number, midi: number, v: number) => {
    const f = mtof(midi);
    add(t, dur + 0.02, (tt) => {
      const p = (tt * f) % 1;
      return (1 - 4 * Math.abs(p - 0.5)) * env(tt, 0.002, dur, 0.02) * 0.2 * v;
    });
  };
  const saw = (t: number, dur: number, midi: number, v: number, voices: number[], cut: number, drive = 1, rel = 0.05) => {
    const f = mtof(midi);
    for (const det of voices) {
      let lp = 0;
      add(t, dur + rel, (tt) => {
        const s2 = 2 * ((tt * f * (1 + det)) % 1) - 1;
        lp += (s2 - lp) * cut;
        return Math.tanh(lp * drive) * env(tt, 0.004, dur, rel) * (0.12 / voices.length) * v;
      });
    }
  };
  const piano = (t: number, dur: number, midi: number, v: number) => {
    const f = mtof(midi);
    add(t, Math.min(2.5, dur + 1.2), (tt) => {
      const d = Math.exp(-tt * (2.2 + midi / 60));
      const s2 = Math.sin(2 * Math.PI * f * tt) + 0.45 * Math.sin(4 * Math.PI * f * tt) * Math.exp(-tt * 3) + 0.2 * Math.sin(6 * Math.PI * f * tt) * Math.exp(-tt * 5);
      return s2 * d * Math.min(1, tt / 0.003) * (tt > dur + 0.25 ? Math.max(0, 1 - (tt - dur - 0.25) / 0.4) : 1) * 0.13 * v;
    });
  };
  const strings = (t: number, dur: number, midi: number, v: number) => saw(t, dur, midi, v * 0.5, [-0.006, 0, 0.007], 0.015, 1, 0.5);
  const sine = (t: number, dur: number, midi: number, v: number) => {
    const f = mtof(midi);
    add(t, dur + 0.05, (tt) => Math.sin(2 * Math.PI * f * tt) * env(tt, 0.004, dur, 0.05) * 0.3 * v);
  };
  const swing = genre === 'rhythmcore' || genre === 'artcore' ? 0.12 : 0.03;

  // ── 드럼·베이스·화음 (박마다, 구간에 따라) ──
  const startT = hits.length ? hits[0].t : 0;
  for (let b = 0; b < grid.length; b++) {
    const g = grid[b];
    const spb = 60 / g.bpm;
    const inBar = (((b - firstHitBeat) % 4) + 4) % 4;
    const bar = barOfBeat(b);
    const pre = g.t < startT - 0.05;
    const kind = pre ? 'intro' : sectionOf(bar);
    const A = ARR[kind];
    const tones = chordTones(bar);
    const bassNote = deg(tones[0], 36, bar);
    if (pre) {
      // 들어가기 전: 박만 (하이햇·마지막 박 스네어)
      hat(g.t, 0.8);
      if (inBar === 3) snare(g.t, 0.5);
      continue;
    }
    const nextKind = sectionOf(bar + 1);
    const phraseEnd = inBar === 3 && (bar + 1) % 4 === 0 && kind !== 'build';
    // 구간이 바뀌는 첫 박: 크래시 (드랍은 서브 드롭까지)
    if (inBar === 0 && (bar === 0 || sectionOf(bar - 1) !== kind)) {
      crash(g.t, kind === 'break' ? 0.5 : 1);
      if (kind === 'drop' && genre !== 'chiptune') subDrop(g.t, 1);
    }
    // 화음 (마디 첫 박)
    if (A.pad && inBar === 0) {
      on('pad');
      const padV = kind === 'break' || kind === 'intro' ? 1.2 : 1;
      for (const x of tones) {
        const m = deg(x, 60, bar);
        if (genre === 'artcore') strings(g.t, spb * 4, m, padV);
        else if (genre === 'chiptune') {
          if (kind === 'break' || kind === 'intro') tri(g.t, spb * 4 - 0.02, m - 12, 0.25 * padV);
        } else saw(g.t, spb * 4, m, (genre === 'speedcore' ? 0.35 : 0.3) * padV, [-0.008, 0, 0.01], 0.04, 1.5, 0.15);
      }
    }
    // 빌드업: 드럼 대신 스네어 연타가 점점 빨라지고 상승음
    if (kind === 'build') {
      if (inBar === 0) riser(g.t, spb * 4, 1);
      const sub = inBar < 2 ? 2 : inBar < 3 ? 4 : 8;
      for (let k = 0; k < sub; k++) snare(g.t + (k * spb) / sub, (0.35 + 0.65 * ((inBar * sub + k) / (4 * sub))) * hum(), 200 + inBar * 25);
      if (A.bass && inBar === 0) {
        on('bass');
        sine(g.t, spb * 4, bassNote, 0.8);
      }
      continue;
    }
    // 드럼
    if (A.drums > 0) {
      const full = A.drums === 2;
      switch (genre) {
        case 'chiptune':
          if (inBar === 0 || inBar === 2) chipNoise(g.t, 1.2 * hum(), 0.08);
          if (inBar === 1 || inBar === 3) chipNoise(g.t, hum(), 0.18);
          if (full) for (let k = 0; k < 2; k++) chipNoise(g.t + (k * spb) / 2 + spb / 4 + (k ? swing * spb * 0.25 : 0), 0.4 * hum(), 0.03);
          break;
        case 'speedcore': {
          const sub = full ? (g.bpm < 200 ? 2 : 1) : 1;
          for (let k = 0; k < sub; k++) kick(g.t + (k * spb) / sub, full ? 1 : 0.8, full ? 6 : 3);
          if (inBar === 1 || inBar === 3) snare(g.t + spb / 2, 0.9 * hum(), 230);
          if (full) hat(g.t + spb / 2, 1.1 * hum(), 60);
          break;
        }
        case 'rhythmcore':
          if (inBar === 0) kick(g.t, 1, 2);
          if (inBar === 2 && full) kick(g.t + spb * 0.5, 0.9, 2);
          if (inBar === 1 || inBar === 3) snare(g.t, hum());
          if (full && rand() < 0.35) snare(g.t + spb * 0.75, 0.3);
          for (let k = 0; k < (full ? 4 : 2); k++) {
            const sub = full ? 4 : 2;
            hat(g.t + (k * spb) / sub + (k % 2 ? swing * (spb / sub) : 0), (k % 2 ? 0.5 : 0.9) * hum());
          }
          if (full && inBar === 3 && bar % 4 === 1) for (let k = 0; k < 8; k++) snare(g.t + (k * spb) / 8, 0.25 + k * 0.08, 220 + k * 30);
          break;
        case 'artcore':
          if (inBar === 0) kick(g.t, 0.9);
          if (inBar === 2) kick(g.t + spb * 0.5, 0.7);
          if (inBar === 1 || inBar === 3) snare(g.t, 0.8 * hum());
          if (full && rand() < 0.3) snare(g.t + spb * 0.75, 0.2);
          for (let k = 0; k < (full ? 4 : 2); k++) {
            const sub = full ? 4 : 2;
            hat(g.t + (k * spb) / sub + (k % 2 ? swing * (spb / sub) : 0), 0.4 * hum(), 100);
          }
          break;
      }
      // 4마디마다 마지막 박: 드럼 필 (다음이 빌드업이 아니면)
      if (phraseEnd && nextKind !== 'build') {
        if (genre === 'chiptune') for (let k = 0; k < 4; k++) chipNoise(g.t + (k * spb) / 4, 0.7 + k * 0.1, 0.06);
        else for (let k = 0; k < 4; k++) tom(g.t + (k * spb) / 4, 0.8 * hum(), 180 - k * 30);
      }
    }
    // 베이스 (구간마다 다른 패턴)
    if (A.bass) {
      on('bass');
      const drop = kind === 'drop';
      switch (genre) {
        case 'chiptune':
          for (let k = 0; k < 2; k++) tri(g.t + (k * spb) / 2, spb / 2 - 0.01, bassNote + (k && drop ? 12 : 0), 1);
          break;
        case 'speedcore':
          saw(g.t + spb / 2, spb / 2 - 0.01, bassNote + (drop && inBar % 2 ? 12 : 0), drop ? 1.2 : 0.9, [0, 0.01], 0.2, drop ? 4 : 2);
          break;
        case 'rhythmcore':
          if (drop) {
            saw(g.t, spb * 0.4, bassNote, 1, [-0.008, 0.008], 0.08, 2.5);
            saw(g.t + spb * 0.75, spb * 0.2, bassNote + 12, 0.7, [-0.008, 0.008], 0.1, 2.5);
          } else saw(g.t, spb * 0.45, bassNote, 0.9, [-0.008, 0.008], 0.06, 2);
          break;
        case 'artcore':
          sine(g.t, spb * 0.9, bassNote, 0.9);
          if (drop) sine(g.t + spb * 0.5, spb * 0.4, bassNote + 12, 0.4);
          break;
      }
    }
    // 대선율 (드랍): 화음 아르페지오
    if (A.counter) {
      on('pad');
      for (let k = 0; k < 4; k++) {
        const m = deg(tones[(k + inBar) % 3] + (k === 3 ? 7 : 0), 60, bar);
        if (genre === 'chiptune') pulse(g.t + (k * spb) / 4, spb / 4 - 0.005, m + 12, 0.35, 0.125);
        else if (genre === 'artcore') piano(g.t + (k * spb) / 4, spb / 4, m + 12, 0.35);
        else pulse(g.t + (k * spb) / 4, spb / 4 - 0.01, m + 12, 0.28, 0.5);
      }
    } else if (genre === 'chiptune' && A.pad && kind !== 'break' && kind !== 'intro') {
      on('pad');
      for (let k = 0; k < 4; k++) pulse(g.t + (k * spb) / 4, spb / 4 - 0.005, deg(tones[k % 3], 60, bar), 0.3, 0.125);
    }
  }

  // ── 멜로디 소리 (구간에 따라 악기를 바꾼다) ──
  on('lead');
  for (const n of mel) {
    const kind = sectionOf(n.bar);
    const soft = kind === 'break' || kind === 'intro';
    switch (genre) {
      case 'chiptune':
        pulse(n.t, n.dur, n.midi, n.vel, kind === 'drop' ? 0.5 : 0.25);
        pulse(n.t + 0.09, n.dur, n.midi, n.vel * 0.25, 0.5); // 에코
        break;
      case 'speedcore':
        if (soft) piano(n.t, n.dur, n.midi, n.vel * 1.2);
        else saw(n.t, n.dur, n.midi, n.vel * 1.3, kind === 'drop' ? [-0.02, -0.007, 0, 0.007, 0.02] : [-0.01, 0.01], 0.35, 2.5);
        break;
      case 'rhythmcore':
        if (soft) tri(n.t, n.dur, n.midi, n.vel);
        else {
          pulse(n.t, n.dur, n.midi, n.vel * 1.1, 0.5, -2);
          if (kind === 'drop') saw(n.t, n.dur, n.midi + 12, n.vel * 0.4, [0], 0.2, 1.5);
        }
        break;
      case 'artcore':
        piano(n.t, n.dur, n.midi, n.vel);
        if (!soft) piano(n.t, n.dur, n.midi - 12, n.vel * 0.35);
        if (kind === 'drop') strings(n.t, n.dur, n.midi, n.vel * 0.5);
        break;
    }
  }
  // 끝: 마지막 화음을 길게
  if (hits.length) {
    const lb = barOfBeat(beatIndexAt(hits[hits.length - 1].t));
    on('pad');
    for (const x of chordTones(lb)) {
      if (genre === 'artcore') piano(songEnd - 3, 2.5, deg(x, 60, lb), 0.8);
      else saw(songEnd - 3, 2, deg(x, 60, lb), 0.4, [-0.006, 0.006], 0.04, 1, 0.8);
    }
    crash(songEnd - 3, 0.8);
  }

  // ── 믹스: 킥에 맞춘 펌핑 + 구간 음량, 세게 누르지 않는다 ──
  const pumpDepth = genre === 'speedcore' ? 0.45 : genre === 'chiptune' ? 0.15 : 0.35;
  const duck = new Float32Array(len).fill(1);
  const rel = Math.floor(0.14 * sampleRate);
  for (const kt of kickTimes) {
    const s0 = Math.floor(kt * sampleRate);
    for (let i = 0; i < rel; i++) {
      const idx = s0 + i;
      if (idx < 0 || idx >= len) continue;
      const v = 1 - pumpDepth * (1 - i / rel) ** 2;
      if (v < duck[idx]) duck[idx] = v;
    }
  }
  // 구간 음량 (마디 경계에서 부드럽게 바뀌게, 100ms 따라감)
  const out = new Float32Array(len);
  let gain = ARR.intro.gain;
  const follow = 1 - Math.exp(-1 / (0.1 * sampleRate));
  let gi = 0;
  let want = gain;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    while (gi + 1 < grid.length && grid[gi + 1].t <= t) gi++;
    if ((i & 255) === 0) want = grid.length && t >= startT - 0.05 ? ARR[sectionOf(barOfBeat(gi))].gain : ARR.intro.gain;
    gain += (want - gain) * follow;
    const d = duck[i];
    const leadD = 1 - (1 - d) * 0.4;
    out[i] = (bus.kick[i] + bus.drums[i] + (bus.bass[i] + bus.pad[i]) * d + bus.lead[i] * leadD + bus.fx[i]) * gain;
  }
  // 정규화: 맨 위 0.3%(킥·서브 드롭 같은 순간 봉우리)만 부드럽게 눌러, 전체는 크게·셈여림은 그대로
  const sample: number[] = [];
  for (let i = 0; i < len; i += 16) sample.push(Math.abs(out[i]));
  sample.sort((x, y) => x - y);
  const ref = sample[Math.floor(sample.length * 0.997)] || 1;
  const k = 0.9 / ref;
  for (let i = 0; i < len; i++) out[i] = Math.tanh(out[i] * k) * 0.97;
  return out;
}
