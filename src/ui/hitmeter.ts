import { JUDGE_COLOR, JUDGE_LABEL, METER_ZONES, type Judgment } from '../core/judge';
import type { JudgeCounts } from '../core/stats';
import { h } from './dom';

/** 계기판 아래 판정 수의 순서 (왼쪽 = 빠름 … 오른쪽 = 느림) */
const ORDER: Judgment[] = ['tooEarly', 'early', 'earlyPerfect', 'perfect', 'latePerfect', 'late', 'miss'];
/** 눈금이 사라지는 시간 (ms) */
const TICK_LIFE = 3000;
const MAX_TICKS = 48;

const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/**
 * 판정 계기판: 친 타이밍을 가로 막대 위 눈금으로 (왼쪽 = 빠름, 가운데 = 정확, 오른쪽 = 느림),
 * 최근 평균을 화살표로, 아래에 판정별 개수를 색으로 보여 준다.
 */
export class HitMeter {
  readonly el: HTMLDivElement;
  private readonly cv: HTMLCanvasElement;
  private readonly nums = new Map<Judgment, HTMLSpanElement>();
  private ticks: { pos: number; at: number; color: number }[] = [];
  private avg = 0;
  private shown = 0;
  private raf = 0;
  private lastCounts = '';

  constructor() {
    this.cv = h('canvas', { class: 'meter-bar' }) as HTMLCanvasElement;
    const row = h('div', { class: 'meter-counts' });
    for (const j of ORDER) {
      const s = h('span', { title: JUDGE_LABEL[j], style: `color:${css(JUDGE_COLOR[j])}` }, '0') as HTMLSpanElement;
      this.nums.set(j, s);
      row.append(s);
    }
    this.el = h('div', { class: 'meter' }, this.cv, row) as HTMLDivElement;
    this.kick();
  }

  /** 판정 하나: pos = -1 빠름 … 0 정확 … +1 느림 */
  hit(j: Judgment, pos: number): void {
    const p = Math.max(-1, Math.min(1, pos));
    this.ticks.push({ pos: p, at: performance.now(), color: JUDGE_COLOR[j] });
    if (this.ticks.length > MAX_TICKS) this.ticks.splice(0, this.ticks.length - MAX_TICKS);
    // 평균 화살표는 진행한 판정만 (너무 빠름·놓침은 끝에 몰려 평균을 흔든다)
    if (j !== 'tooEarly' && j !== 'miss') this.avg += (p - this.avg) * 0.2;
    this.kick();
  }

  setCounts(c: JudgeCounts): void {
    const key = ORDER.map((j) => c[j]).join(',');
    if (key === this.lastCounts) return;
    this.lastCounts = key;
    for (const j of ORDER) this.nums.get(j)!.textContent = String(c[j]);
  }

  /** 다시 시작할 때 */
  clear(): void {
    this.ticks = [];
    this.avg = 0;
    this.kick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = -1;
  }

  private kick(): void {
    if (this.raf === 0) this.raf = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    if (this.raf === -1) return;
    this.raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.cv.clientWidth || 300;
    const ch = this.cv.clientHeight || 26;
    if (this.cv.width !== Math.round(cw * dpr) || this.cv.height !== Math.round(ch * dpr)) {
      this.cv.width = Math.round(cw * dpr);
      this.cv.height = Math.round(ch * dpr);
    }
    const g = this.cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const mid = cw / 2;
    const half = cw / 2 - 4;
    const x = (p: number) => mid + p * half;
    const barY = ch * 0.62;
    const barH = 5;
    // 구간 띠 (바깥 → 안쪽 순으로 덮어 그림)
    const band = (lim: number, color: number) => {
      g.fillStyle = css(color, 0.55);
      g.fillRect(x(-lim), barY - barH / 2, x(lim) - x(-lim), barH);
    };
    band(1, JUDGE_COLOR.tooEarly);
    band(METER_ZONES.far, JUDGE_COLOR.early);
    // 약간 빠름(왼쪽)·약간 느림(오른쪽)은 색이 조금 다르다
    g.fillStyle = css(JUDGE_COLOR.earlyPerfect, 0.6);
    g.fillRect(x(-METER_ZONES.near), barY - barH / 2, x(0) - x(-METER_ZONES.near), barH);
    g.fillStyle = css(JUDGE_COLOR.latePerfect, 0.6);
    g.fillRect(x(0), barY - barH / 2, x(METER_ZONES.near) - x(0), barH);
    band(METER_ZONES.perfect, JUDGE_COLOR.perfect);
    // 가운데 선
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(mid - 1, barY - 8, 2, 16);
    // 눈금
    const now = performance.now();
    this.ticks = this.ticks.filter((t) => now - t.at < TICK_LIFE);
    for (const t of this.ticks) {
      const a = 1 - (now - t.at) / TICK_LIFE;
      g.fillStyle = css(t.color, 0.25 + 0.75 * a);
      g.fillRect(x(t.pos) - 1.5, barY - 9, 3, 18);
    }
    // 평균 화살표 (부드럽게 따라감)
    this.shown += (this.avg - this.shown) * 0.15;
    const ax = x(this.shown);
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.beginPath();
    g.moveTo(ax - 5, 1);
    g.lineTo(ax + 5, 1);
    g.lineTo(ax, 8);
    g.closePath();
    g.fill();
    // 움직일 것이 남아 있으면 계속
    if (this.ticks.length || Math.abs(this.avg - this.shown) > 0.002) this.raf = requestAnimationFrame(() => this.draw());
  }
}

/** 초 → m:ss */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
