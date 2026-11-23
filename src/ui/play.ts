import { done, step } from '../diag';
import { JUDGE_LABEL, type Judgment } from '../core/judge';
import { Game, type GameHud, type GameResult, type LiveStats } from '../game/game';
import { fmtTime, HitMeter } from './hitmeter';
import { settings, submitBest } from '../game/settings';
import { offsetNudger, offsetSuggestion } from './offsetUi';
import type { OffsetHint } from '../core/offset';
import { currentProfile, rankKey, submitScore } from '../online/cloud';
import type { LevelPackage } from '../levels/package';
import { ambient } from '../render/stage';
import { alertBox, h, show, toast, type Screen } from './dom';
import { currentProfile as deviceProfile, describeOutput, deviceProfiles } from '../audio/device';

/** 이번 실행에서 마지막으로 쓴 기기 보정 (기기가 바뀌면 알려 주려고) */
let lastDeviceKey: string | null = null;
function noticeDevice(): void {
  const p = deviceProfile();
  const key = p ? `${p.lat}:${p.offset}` : 'none';
  if (key === lastDeviceKey) return;
  const first = lastDeviceKey === null;
  lastDeviceKey = key;
  if (p && !first) toast(`오디오 기기가 바뀌어서 그 기기의 보정값(${p.offset}ms)을 써요`, 3500);
  else if (!p && deviceProfiles().length) toast(`${describeOutput()}는 아직 보정 전이에요 — 박자가 어긋나면 설정 > 보정 시작`, 4500);
}

export interface PlayOptions {
  autoplay?: boolean;
  /** 무적 모드 (실패 없이 끝까지) */
  noFail?: boolean;
  startFloor?: number;
  /** 나가기/목록 버튼이 돌아갈 화면. */
  back: () => Screen;
  /** 에디터 플레이테스트면 결과 화면 없이 바로 복귀. */
  editorTest?: boolean;
}

/** 게임 화면 (HUD, 일시정지, 실패 안내) + 결과 화면. */
export class PlayScreen implements Screen, GameHud {
  private game: Game | null = null;
  private prog!: HTMLDivElement;
  private acc!: HTMLDivElement;
  private count!: HTMLDivElement;
  private failEl!: HTMLDivElement;
  private failMsg!: HTMLParagraphElement;
  private pauseEl: HTMLDivElement | null = null;
  private root!: HTMLElement;
  private lastAcc = '';
  private lastProg = -1;
  private lastCount: string | null = '';
  /** 진행 정보 오버레이 (설정 '진행 정보') */
  private statsEl: HTMLDivElement | null = null;
  private lastStats = '';
  /** 판정 계기판 (설정 '판정 계기판') */
  private meter: HitMeter | null = null;

  constructor(
    private readonly pkg: LevelPackage,
    private readonly opts: PlayOptions,
  ) {}

  async enter(root: HTMLElement): Promise<void> {
    this.root = root;
    // 휴대폰: 주소창·아래 버튼을 숨겨 게임 화면을 폰에 꽉 채운다 (시작 버튼을 누른 직후라 허용된다)
    if (settings.fullscreen && matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen) {
      const goFull = () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      };
      goFull();
      // 브라우저가 막으면 (누른 지 오래됨 등) 첫 터치 때 다시
      root.addEventListener('pointerdown', goFull, { once: true, capture: true });
    }
    root.className = 'passthrough';
    this.prog = h('div');
    this.acc = h('div', { class: 'acc' }, '100.00%');
    this.count = h('div', { class: 'count' });
    this.failMsg = h('p');
    this.failEl = h(
      'div',
      { class: 'fail' },
      h('h2', null, '실패'),
      this.failMsg,
      h('p', null, '아무 키나 누르면 다시 시작 · Esc 나가기'),
    );
    // 진행 정보를 켜면 한 줄 요약(진행·정확도·절대) 대신 여러 줄로
    if (settings.showStats) {
      this.statsEl = h('div', { class: 'stats' });
      this.acc.style.display = 'none';
    }
    if (settings.showHitMeter) this.meter = new HitMeter();
    root.append(
      h(
        'div',
        { class: 'hud' },
        h('div', { class: 'tl' }, h('div', { class: 'progress' }, this.prog), this.acc, this.statsEl),
        this.meter?.el ?? null,
        h(
          'div',
          { class: 'tr' },
          h('button', { class: 'btn small', onclick: () => this.game?.pause(), title: '일시정지 (Esc)' }, '❚❚'),
        ),
        this.count,
        this.failEl,
        this.opts.autoplay || this.opts.noFail || settings.playbackSpeed !== 1
          ? h(
              'div',
              { class: 'auto-badge' },
              [this.opts.autoplay ? '자동 플레이' : '', this.opts.noFail ? '무적 모드' : '', settings.playbackSpeed !== 1 ? `속도 ×${settings.playbackSpeed}` : ''].filter(Boolean).join(' · '),
            )
          : null,
        this.opts.editorTest ? h('div', { class: 'auto-badge', style: 'left:auto;right:16px' }, '플레이테스트 · Esc로 에디터 복귀') : null,
      ),
    );
    this.game = new Game({
      pkg: this.pkg,
      hud: this,
      autoplay: this.opts.autoplay,
      noFail: this.opts.noFail,
      startFloor: this.opts.startFloor,
      onClear: (r) => this.onClear(r),
      onQuit: () => void show(this.opts.back()),
    });
    // 프레임 표시 (설정)
    if (settings.showFps) {
      const fb = h('div', { style: `position:fixed;left:8px;bottom:${settings.showHitMeter ? 70 : 34}px;z-index:50;font:12px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.6);padding:3px 7px;border-radius:5px;pointer-events:none` });
      root.append(fb);
      const iv = setInterval(() => {
        if (!this.game || !fb.isConnected) {
          clearInterval(iv);
          return;
        }
        fb.textContent = this.game.perfLine();
      }, 500);
    }
    // 진단 표시: 주소에 ?debug
    if (/[?&]debug\b/.test(location.search)) {
      const box = h('div', { style: 'position:fixed;left:8px;bottom:40px;z-index:50;font:11px/1.4 monospace;color:#9f9;background:rgba(0,0,0,.7);padding:6px 8px;border-radius:6px;max-width:92vw;white-space:pre-wrap;pointer-events:none' });
      root.append(box);
      const iv = setInterval(() => {
        if (!this.game || !box.isConnected) {
          clearInterval(iv);
          return;
        }
        box.textContent = this.game.diag().join('\n');
      }, 500);
    }
    noticeDevice();
    try {
      step('game', this.pkg.level.meta.title);
      await this.game.start();
      // 처음 몇 초를 넘기면 무사한 것으로 (그 사이 꺼지면 다음에 '플레이 중'으로 알림)
      step('play', this.pkg.level.meta.title);
      setTimeout(() => done('play'), 15000);
    } catch (e) {
      done();
      await alertBox('레벨을 시작할 수 없습니다', [(e as Error).message]);
      void show(this.opts.back());
    }
  }

  exit(): void {
    done();
    this.meter?.destroy();
    this.meter = null;
    this.game?.destroy();
    this.game = null;
  }

  // ── GameHud ──
  setProgress(p: number): void {
    const v = Math.round(p * 1000);
    if (v === this.lastProg) return;
    this.lastProg = v;
    this.prog.style.width = `${(p * 100).toFixed(1)}%`;
    this.progPct = p * 100;
    this.renderAcc();
  }
  /** 진행도 (%) — 원작 HUD처럼 숫자로도 보여 준다 (막대만 있으면 정확도 숫자를 진행도로 오해했다) */
  private progPct = 0;
  private accVal: [number, number | undefined] = [100, undefined];
  setAccuracy(a: number, x?: number): void {
    this.accVal = [a, x];
    this.renderAcc();
  }
  private renderAcc(): void {
    const [a, x] = this.accVal;
    const acc = x === undefined ? `정확도 ${a.toFixed(2)}%` : `정확도 ${a.toFixed(2)}% · 절대 ${x.toFixed(2)}%`;
    const s = `진행 ${this.progPct.toFixed(2)}% · ${acc}`;
    if (s === this.lastAcc) return;
    this.lastAcc = s;
    this.acc.textContent = s;
  }
  setStats(s: LiveStats): void {
    this.meter?.setCounts(s.counts);
    if (!this.statsEl) return;
    const rows: [string, string][] = [
      ['진행도', `${s.progress.toFixed(2)}%`],
      ['정확도', `${s.accuracy.toFixed(2)}%`],
      ['절대 정확도', `${s.xAccuracy.toFixed(2)}%`],
      ['콤보', String(s.combo)],
      ['현재 타일', `${s.tile}개`],
      ['남은 타일 수', `${Math.max(0, s.total - s.tile)}개`],
      ['총 타일 수', `${s.total}개`],
      ['음악 시간', `${fmtTime(s.time)} / ${fmtTime(s.length)}`],
    ];
    const key = rows.map((r) => r[1]).join('|');
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.statsEl.replaceChildren(...rows.map(([k, v]) => h('div', null, h('span', { class: 'k' }, `${k}: `), v)));
  }
  hit(j: Judgment, pos: number): void {
    this.meter?.hit(j, pos);
  }
  setCountdown(text: string | null): void {
    if (text === this.lastCount) return;
    this.lastCount = text;
    this.count.textContent = text ?? '';
  }
  private failHint: HTMLElement | null = null;
  showFail(reason: string | null, hint?: OffsetHint | null): void {
    this.failEl.classList.toggle('on', reason !== null);
    this.failHint?.remove();
    this.failHint = null;
    if (reason) {
      this.failMsg.textContent = reason;
      // 박자가 계속 어긋나서 실패했다면 바로 맞출 수 있게
      this.failHint = offsetSuggestion(hint ?? null);
      if (this.failHint) this.failEl.append(this.failHint);
      this.failEl.style.opacity = '0';
      setTimeout(() => (this.failEl.style.opacity = ''), 800);
    }
  }
  setPaused(p: boolean): void {
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (!p) return;
    const g = this.game!;
    this.pauseEl = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'box' },
        h('h2', null, '일시정지'),
        h('button', { class: 'btn primary', onclick: () => g.resume() }, '계속'),
        h('button', { class: 'btn', onclick: () => (g.pause(), g.restart(true), this.setPaused(false)) }, '처음부터 다시 시작'),
        h('button', { class: 'btn', onclick: () => g.quit() }, this.opts.editorTest ? '에디터로' : '나가기'),
        // 박자가 어긋나면 여기서 바로 (친 타이밍으로 본 추천 + 미세조정)
        offsetSuggestion(g.offsetHint),
        offsetNudger(),
        // 화면이 이상할 때 원인을 알 수 있게: 누르면 지금 상태를 보여 준다 (캡처하거나 복사해서 보내면 된다)
        this.diagButton(g),
      ),
    );
    this.root.append(this.pauseEl);
    (this.pauseEl.querySelector('button') as HTMLButtonElement).focus();
  }
  /** '화면이 이상해요' — 지금 상태(그림·메모리·화질·기기)를 펼쳐 보여 주고 복사할 수 있게 */
  private diagButton(g: Game): HTMLElement {
    const text = g.diag().join('\n');
    const pre = h('div', { class: 'diag-text' }, text);
    const copy = h('button', { class: 'btn small' }, '복사') as HTMLButtonElement;
    copy.onclick = () => {
      void navigator.clipboard?.writeText(text).then(
        () => (copy.textContent = '복사됨'),
        () => (copy.textContent = '복사 실패 — 캡처해 주세요'),
      );
    };
    const panel = h('div', { class: 'diag', style: 'display:none' }, h('div', { class: 'dim' }, '이 화면을 캡처하거나 복사해서 보내 주세요 (어느 장면에서 이상했는지도 함께)'), pre, copy);
    const btn = h('button', { class: 'btn' }, '화면이 이상해요') as HTMLButtonElement;
    btn.onclick = () => {
      const open = panel.style.display === 'none';
      panel.style.display = open ? '' : 'none';
      btn.textContent = open ? '닫기' : '화면이 이상해요';
    };
    return h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, btn, panel);
  }

  private loadingEl: HTMLDivElement | null = null;
  setLoading(text: string | null): void {
    if (text === null) {
      this.loadingEl?.remove();
      this.loadingEl = null;
      return;
    }
    if (!this.loadingEl) {
      this.loadingEl = h('div', { class: 'loading-note' }) as HTMLDivElement;
      this.root.append(this.loadingEl);
    }
    this.loadingEl.textContent = text;
  }

  setResumeCountdown(n: number | null): void {
    this.setCountdown(n === null ? null : String(n));
  }

  // ── 결과 ──
  private onClear(r: GameResult): void {
    if (this.opts.editorTest) {
      // 무적 모드 플레이테스트는 판정 결과를 보여 준다 (나가면 에디터로)
      void show(this.opts.noFail ? new ResultScreen(this.pkg, r, false, this.opts) : this.opts.back());
      return;
    }
    const ranked = !r.autoplay && !r.noFail && r.speed === 1;
    const newBest = ranked && submitBest(this.pkg.id, r.accuracy);
    // 로그인했고 순위가 있는 레벨이면 온라인 기록도 (더 높을 때만)
    const key = ranked ? rankKey(this.pkg) : null;
    if (key && currentProfile()) void submitScore(key, r.accuracy).catch((e) => console.warn('[ORBIT] 기록 올리기 실패', e));
    void show(new ResultScreen(this.pkg, r, newBest, this.opts));
  }
}

const ORDER: Judgment[] = ['perfect', 'earlyPerfect', 'latePerfect', 'early', 'late', 'tooEarly', 'miss'];

export class ResultScreen implements Screen {
  private key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') void show(this.opts.back());
    else if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') this.retry();
  };
  constructor(
    private readonly pkg: LevelPackage,
    private readonly r: GameResult,
    private readonly newBest: boolean,
    private readonly opts: PlayOptions,
  ) {}

  private retry(): void {
    void show(new PlayScreen(this.pkg, this.opts));
  }

  enter(root: HTMLElement): void {
    ambient(true);
    const r = this.r;
    root.append(
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('h1', null, `클리어 — ${this.pkg.level.meta.title}`)),
        h(
          'div',
          { class: 'page-body' },
          h(
            'div',
            { class: 'results' },
            h('div', { class: 'big' }, `${r.accuracy.toFixed(2)}%`),
            h('div', { class: 'dim', style: 'font-size:18px;margin-top:-4px' }, `절대정확도 ${r.xAccuracy.toFixed(2)}%`),
            h(
              'div',
              { class: 'badges' },
              r.allPerfect && !r.autoplay && !r.noFail ? h('span', { class: 'badge perfect' }, '완벽 클리어') : null,
              r.flawless && !r.autoplay && !r.noFail ? h('span', { class: 'badge flawless' }, '무결점 클리어') : null,
              this.newBest ? h('span', { class: 'badge newbest' }, '최고 기록!') : null,
              r.speed !== 1 ? h('span', { class: 'badge newbest', style: 'color:var(--dim);border-color:var(--line)' }, `속도 ×${r.speed} (기록 안 됨)`) : null,
              r.autoplay ? h('span', { class: 'badge newbest', style: 'color:var(--dim);border-color:var(--line)' }, '자동 플레이 (기록 안 됨)') : null,
              r.noFail ? h('span', { class: 'badge newbest', style: 'color:var(--dim);border-color:var(--line)' }, '무적 모드 (기록 안 됨)') : null,
            ),
            h(
              'table',
              null,
              ...ORDER.map((j) => h('tr', null, h('td', null, JUDGE_LABEL[j]), h('td', null, String(r.counts[j])))),
              // 무적 모드에서 넘긴 실패 (원래라면 그 자리에서 끝났을 것)
              ...(r.noFail || r.overloads + r.ruleBreaks + r.holdFails > 0
                ? [
                    h('tr', null, h('td', null, '과부하'), h('td', null, String(r.overloads))),
                    h('tr', null, h('td', null, '홀드 실패'), h('td', null, String(r.holdFails))),
                    ...(r.ruleBreaks > 0 ? [h('tr', null, h('td', null, '맵 규칙 위반'), h('td', null, String(r.ruleBreaks)))] : []),
                    h('tr', null, h('td', null, '원래라면 실패한 횟수'), h('td', null, String(r.counts.miss + r.overloads + r.holdFails + r.ruleBreaks))),
                  ]
                : []),
              h('tr', null, h('td', null, '최대 연속 완벽'), h('td', null, String(r.maxStreak))),
              h('tr', null, h('td', null, '체크포인트 사용'), h('td', null, String(r.checkpointUses))),
              h('tr', null, h('td', null, '판정 난이도'), h('td', null, { lenient: '느슨함', normal: '보통', strict: '엄격' }[settings.difficulty])),
            ),
            offsetSuggestion(r.offsetHint),
            h(
              'div',
              { class: 'row end' },
              h('button', { class: 'btn', onclick: () => show(this.opts.back()) }, this.opts.editorTest ? '에디터로' : '목록'),
              h('button', { class: 'btn primary', onclick: () => this.retry() }, '재시도'),
            ),
          ),
        ),
      ),
    );
    window.addEventListener('keydown', this.key);
  }

  exit(): void {
    ambient(false);
    window.removeEventListener('keydown', this.key);
  }
}
