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

/** 맵 → 곡 (모노 샘플). seed가 같으면 같은 곡. */
export function chartSong(chart: Chart, genre: Genre, seed: number, sampleRate = 44100): Float32Array {
  const spec = SPEC[genre];
  const rand = rng(seed * 7919 + genre.length);
  const tiles = chart.tiles;
  const last = chart.finish;
  // 치는 순간 (미드스핀처럼 같은 순간은 하나로)
  const hits: { t: number; hold: number }[] = [];
  for (let i = 1; i <= last; i++) {
    const t = tiles[i].time;
    if (hits.length && t - hits[hits.length - 1].t < 0.005) continue;
    const prev = tiles[i - 1];
    // 앞 타일의 홀드면 그 앞 음을 길게
    if (prev.holdBeats > 0 && hits.length) hits[hits.length - 1].hold = 1;
    hits.push({ t, hold: 0 });
  }
  const songEnd = (hits.length ? hits[hits.length - 1].t : tiles[0].time) + 3;
  const grid = beatGrid(chart, songEnd);
  const len = Math.ceil((songEnd + 1.5) * sampleRate);
  const out = new Float32Array(len);
  const key = Math.floor(rand() * 7) - 3;
  const prog = spec.progs[Math.floor(rand() * spec.progs.length)];

  // 박 → 마디 → 화음
  const firstHitBeat = hits.length ? Math.max(0, grid.findIndex((g) => g.t >= hits[0].t - 0.02)) : 0;
  const barOfBeat = (b: number) => Math.floor((b - firstHitBeat) / 4);
  const chordAt = (b: number) => prog[(((barOfBeat(b) % prog.length) + prog.length) % prog.length)];
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
  const deg = (d: number, base: number) => {
    const o = Math.floor(d / 7);
    const k = ((d % 7) + 7) % 7;
    return base + key + o * 12 + spec.scale[k];
  };
  const chordTones = (b: number) => {
    const c = chordAt(b);
    return [c, c + 2, c + 4];
  };

  // ── 멜로디: 치는 순간마다 ──
  const mel: Note[] = [];
  let cur = 2; // 음계 도수 (위치)
  let arpDir = 1;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.t ?? h.t + 0.5;
    const gap = next - h.t;
    const b = beatIndexAt(h.t);
    const tones = chordTones(b);
    const onBeat = Math.abs((grid[b]?.t ?? h.t) - h.t) < 0.03;
    if (gap < 0.13) {
      // 빠른 연타: 화음을 오르내리는 아르페지오
      const near = tones.map((x) => x + 7 * Math.round((cur - x) / 7));
      let best = near[0];
      for (const x of near) if ((x - cur) * arpDir > 0 && Math.abs(x - cur) <= 4) best = x;
      if (best === cur || (best - cur) * arpDir <= 0) best = cur + arpDir * 2;
      cur = best;
      if (cur > 9 || cur < -3) arpDir = -arpDir;
    } else if (onBeat || rand() < 0.5) {
      // 박 위: 가까운 화음 음
      const near = tones.map((x) => x + 7 * Math.round((cur - x) / 7));
      const step = Math.floor(rand() * 3) - 1;
      cur = near.reduce((a, x) => (Math.abs(x - cur - step) < Math.abs(a - cur - step) ? x : a), near[0]);
    } else {
      cur += rand() < 0.5 ? 1 : -1;
    }
    cur = Math.max(-4, Math.min(11, cur));
    const dur = h.hold ? gap : Math.min(gap * 0.92, 60 / (grid[b]?.bpm ?? 120));
    mel.push({ t: h.t, dur: Math.max(0.04, dur), midi: deg(cur, spec.root), vel: onBeat ? 1 : 0.85 });
  }

  // ── 소리 ──
  const nrand = rng(seed * 31 + 7);
  const noise = () => nrand() * 2 - 1;
  const add = (start: number, sec: number, f: (tt: number) => number) => {
    const s0 = Math.floor(start * sampleRate);
    const n = Math.floor(sec * sampleRate);
    for (let i = 0; i < n; i++) {
      const idx = s0 + i;
      if (idx < 0 || idx >= len) continue;
      out[idx] += f(i / sampleRate);
    }
  };
  const env = (tt: number, a: number, dur: number, r: number) => Math.min(1, tt / a) * (tt > dur ? Math.max(0, 1 - (tt - dur) / r) : 1);

  const kick = (t: number, v: number, drive = 1) => {
    let ph = 0;
    add(t, 0.28, (tt) => {
      ph += (2 * Math.PI * (48 + 160 * Math.exp(-tt * 35))) / sampleRate;
      const s = Math.sin(ph) * Math.exp(-tt * (drive > 1 ? 14 : 10));
      return Math.tanh(s * drive) * 0.8 * v;
    });
  };
  const snare = (t: number, v: number, tone = 190) => {
    let lp = 0;
    let ph = 0;
    add(t, 0.2, (tt) => {
      const nz = noise();
      lp += (nz - lp) * 0.5;
      ph += (2 * Math.PI * tone) / sampleRate;
      return ((nz - lp) * Math.exp(-tt * 20) + Math.sin(ph) * 0.5 * Math.exp(-tt * 30)) * 0.38 * v;
    });
  };
  const hat = (t: number, v: number, decay = 80) => {
    let prev = 0;
    add(t, 0.06, (tt) => {
      const nz = noise();
      const hp = nz - prev;
      prev = nz;
      return hp * Math.exp(-tt * decay) * 0.09 * v;
    });
  };
  const crash = (t: number, v: number) => {
    let prev = 0;
    add(t, 1.6, (tt) => {
      const nz = noise();
      const hp = nz - prev;
      prev = nz;
      return hp * Math.exp(-tt * 2.5) * 0.07 * v;
    });
  };
  /** 8비트 잡음 북 (칩튠) */
  const chipNoise = (t: number, v: number, sec: number) => {
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
        const s = 2 * ((tt * f * (1 + det)) % 1) - 1;
        lp += (s - lp) * cut;
        return Math.tanh(lp * drive) * env(tt, 0.004, dur, rel) * (0.12 / voices.length) * v;
      });
    }
  };
  const piano = (t: number, dur: number, midi: number, v: number) => {
    const f = mtof(midi);
    add(t, Math.min(2.5, dur + 1.2), (tt) => {
      const d = Math.exp(-tt * (2.2 + midi / 60));
      const s = Math.sin(2 * Math.PI * f * tt) + 0.45 * Math.sin(4 * Math.PI * f * tt) * Math.exp(-tt * 3) + 0.2 * Math.sin(6 * Math.PI * f * tt) * Math.exp(-tt * 5);
      return s * d * Math.min(1, tt / 0.003) * (tt > dur + 0.25 ? Math.max(0, 1 - (tt - dur - 0.25) / 0.4) : 1) * 0.13 * v;
    });
  };
  const strings = (t: number, dur: number, midi: number, v: number) => saw(t, dur, midi, v * 0.5, [-0.006, 0, 0.007], 0.015, 1, 0.5);
  const sine = (t: number, dur: number, midi: number, v: number) => {
    const f = mtof(midi);
    add(t, dur + 0.05, (tt) => Math.sin(2 * Math.PI * f * tt) * env(tt, 0.004, dur, 0.05) * 0.3 * v);
  };

  // ── 드럼·베이스·화음 (박마다) ──
  const startT = hits.length ? hits[0].t : 0;
  for (let b = 0; b < grid.length; b++) {
    const g = grid[b];
    const spb = 60 / g.bpm;
    const inBar = (((b - firstHitBeat) % 4) + 4) % 4;
    const bar = barOfBeat(b);
    const intro = g.t < startT - 0.05;
    const tones = chordTones(b);
    const bassNote = deg(tones[0], 36);
    if (intro) {
      // 들어가기 전: 박만 (하이햇·마지막 박 스네어)
      hat(g.t, 0.8);
      if (inBar === 3) snare(g.t, 0.5);
      continue;
    }
    if (inBar === 0 && bar % 8 === 0) crash(g.t, genre === 'chiptune' ? 0.5 : 1);
    switch (genre) {
      case 'chiptune': {
        if (inBar === 0 || inBar === 2) chipNoise(g.t, 1.2, 0.08);
        if (inBar === 1 || inBar === 3) chipNoise(g.t, 1, 0.18);
        for (let k = 0; k < 2; k++) chipNoise(g.t + (k * spb) / 2 + spb / 4, 0.4, 0.03);
        // 베이스: 8분 옥타브
        for (let k = 0; k < 2; k++) tri(g.t + (k * spb) / 2, spb / 2 - 0.01, bassNote + (k ? 12 : 0), 1);
        // 화음 아르페지오 (작게)
        for (let k = 0; k < 4; k++) pulse(g.t + (k * spb) / 4, spb / 4 - 0.005, deg(tones[k % 3], 60), 0.35, 0.125);
        break;
      }
      case 'speedcore': {
        const sub = g.bpm < 200 ? 2 : 1;
        for (let k = 0; k < sub; k++) kick(g.t + (k * spb) / sub, 1, 6);
        if (inBar === 1 || inBar === 3) snare(g.t + spb / 2, 0.9, 230);
        hat(g.t + spb / 2, 1.1, 60);
        saw(g.t + spb / 2, spb / 2 - 0.01, bassNote, 1.2, [0, 0.01], 0.2, 4);
        if (inBar === 0) for (const x of tones) saw(g.t, spb * 4, deg(x, 60), 0.35, [-0.01, 0, 0.012], 0.05, 2, 0.1);
        break;
      }
      case 'rhythmcore': {
        // 브레이크: 킥 1·(3의 엇박), 스네어 2·4, 고스트, 16분 하이햇
        if (inBar === 0) kick(g.t, 1, 2);
        if (inBar === 2) kick(g.t + spb * 0.5, 0.9, 2);
        if (inBar === 1 || inBar === 3) snare(g.t, 1);
        if (rand() < 0.35) snare(g.t + spb * 0.75, 0.3);
        for (let k = 0; k < 4; k++) hat(g.t + (k * spb) / 4, k % 2 ? 0.5 : 0.9);
        // 마디 끝 글리치: 스네어 32분 반복
        if (inBar === 3 && bar % 4 === 3) for (let k = 0; k < 8; k++) snare(g.t + (k * spb) / 8, 0.25 + k * 0.08, 220 + k * 30);
        saw(g.t, spb * 0.45, bassNote, 1, [-0.008, 0.008], 0.08, 2.5);
        if (inBar === 0) for (const x of tones) saw(g.t, spb * 4, deg(x, 60), 0.3, [-0.007, 0.007], 0.03, 1, 0.2);
        break;
      }
      case 'artcore': {
        // 브레이크비트 (부드럽게) + 현악 화음 + 낮은 베이스
        if (inBar === 0) kick(g.t, 0.9);
        if (inBar === 2) kick(g.t + spb * 0.5, 0.7);
        if (inBar === 1 || inBar === 3) snare(g.t, 0.8);
        if (rand() < 0.3) snare(g.t + spb * 0.75, 0.2);
        for (let k = 0; k < 4; k++) hat(g.t + (k * spb) / 4, 0.4, 100);
        sine(g.t, spb * 0.9, bassNote, 0.9);
        if (inBar === 0) for (const x of tones) strings(g.t, spb * 4, deg(x, 60), 1);
        break;
      }
    }
  }

  // ── 멜로디 소리 ──
  for (const n of mel) {
    switch (genre) {
      case 'chiptune':
        pulse(n.t, n.dur, n.midi, n.vel, 0.25);
        pulse(n.t + 0.09, n.dur, n.midi, n.vel * 0.25, 0.5); // 에코
        break;
      case 'speedcore':
        saw(n.t, n.dur, n.midi, n.vel * 1.3, [-0.015, -0.005, 0.005, 0.015], 0.35, 2.5);
        break;
      case 'rhythmcore':
        pulse(n.t, n.dur, n.midi, n.vel * 1.1, 0.5, -2);
        saw(n.t, n.dur, n.midi + 12, n.vel * 0.4, [0], 0.2, 1.5);
        break;
      case 'artcore':
        piano(n.t, n.dur, n.midi, n.vel);
        piano(n.t, n.dur, n.midi - 12, n.vel * 0.35);
        break;
    }
  }
  // 끝: 마지막 화음을 길게
  if (hits.length) {
    const b = beatIndexAt(hits[hits.length - 1].t);
    for (const x of chordTones(b)) {
      if (genre === 'artcore') piano(songEnd - 3, 2.5, deg(x, 60), 0.8);
      else saw(songEnd - 3, 2, deg(x, 60), 0.4, [-0.006, 0.006], 0.04, 1, 0.8);
    }
    crash(songEnd - 3, 0.8);
  }

  // 소프트 클리핑 + 정규화
  let peak = 0;
  for (let i = 0; i < len; i++) {
    out[i] = Math.tanh(out[i] * 1.3);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < len; i++) out[i] *= k;
  }
  return out;
}
