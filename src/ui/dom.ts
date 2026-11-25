type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** 간단한 DOM 생성 헬퍼. on* 속성은 이벤트 리스너로 연결. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface Screen {
  enter(root: HTMLElement): void | Promise<void>;
  exit(): void;
}

let current: Screen | null = null;
let root: HTMLElement;

export function initUi(el: HTMLElement): void {
  root = el;
}

export async function show(s: Screen): Promise<void> {
  current?.exit();
  root.innerHTML = '';
  root.className = '';
  current = s;
  await s.enter(root);
}

/** 모달 알림. */
export function alertBox(title: string, lines: string[]): Promise<void> {
  return new Promise((resolve) => {
    const close = () => {
      wrap.remove();
      resolve();
    };
    const wrap = h(
      'div',
      { class: 'modal-wrap ui-interactive' },
      h(
        'div',
        { class: 'modal' },
        h('h2', null, title),
        h('div', { class: 'modal-body' }, ...lines.map((l) => h('p', null, l))),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: close }, '확인')),
      ),
    );
    document.body.appendChild(wrap);
    (wrap.querySelector('button') as HTMLButtonElement).focus();
  });
}

/** 확인/취소 모달 (window.confirm 대신 — 임베드 환경에서도 동작). */
export function confirmBox(title: string, message: string, okLabel = '확인'): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      wrap.remove();
      resolve(v);
    };
    const wrap = h(
      'div',
      { class: 'modal-wrap ui-interactive' },
      h(
        'div',
        { class: 'modal' },
        h('h2', null, title),
        h('div', { class: 'modal-body' }, h('p', null, message)),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', onclick: () => done(false) }, '취소'),
          h('button', { class: 'btn primary', onclick: () => done(true) }, okLabel),
        ),
      ),
    );
    document.body.appendChild(wrap);
    (wrap.querySelector('.btn.primary') as HTMLButtonElement).focus();
  });
}

/** 선택지 모달. 취소하면 null. */
export function choiceBox<T extends string>(title: string, message: string, options: { value: T; label: string; hint?: string }[]): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (v: T | null) => {
      wrap.remove();
      resolve(v);
    };
    const wrap = h(
      'div',
      { class: 'modal-wrap ui-interactive' },
      h(
        'div',
        { class: 'modal' },
        h('h2', null, title),
        h('div', { class: 'modal-body' }, h('p', null, message)),
        h(
          'div',
          { class: 'col', style: 'margin:12px 0' },
          ...options.map((o) =>
            h('button', { class: 'btn', style: 'text-align:left', onclick: () => done(o.value) }, h('b', null, o.label), o.hint ? h('span', { class: 'dim' }, `  ${o.hint}`) : null),
          ),
        ),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => done(null) }, '취소')),
      ),
    );
    document.body.appendChild(wrap);
    (wrap.querySelector('.col .btn') as HTMLButtonElement)?.focus();
  });
}

/** 잠깐 떠 있다 사라지는 알림. */
export function toast(text: string, ms = 2600): void {
  const el = h('div', { class: 'toast' }, text);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export const DIFFICULTY_CHOICES = [
  { value: 'easy' as const, label: '쉬움', hint: '주로 1박, 가끔 반박' },
  { value: 'normal' as const, label: '보통', hint: '반박 리듬 섞임' },
  { value: 'hard' as const, label: '어려움', hint: '8분음표 리듬까지' },
  { value: 'expert' as const, label: '매우 어려움', hint: '16분음표까지' },
  { value: 'master' as const, label: '극한', hint: '16분음표 + 셋잇단' },
  { value: 'full' as const, label: '원곡 그대로', hint: '들리는 소리 하나하나 전부 (빠른 연타까지)' },
];

export const SENSITIVITY_CHOICES = [
  { value: '0.3' as const, label: '낮음', hint: '킥·스네어 같은 큰 소리 위주' },
  { value: '0.55' as const, label: '보통', hint: '대부분의 소리' },
  { value: '0.85' as const, label: '높음', hint: '작은 소리까지 (하이햇·잔 멜로디)' },
];

export function stars(n: number): string {
  const k = Math.max(0, Math.min(10, Math.round(n)));
  return '★'.repeat(Math.ceil(k / 2)) + '☆'.repeat(5 - Math.ceil(k / 2)) + ` ${k}`;
}

/** 파일을 못 읽었을 때(NotReadableError 등) 사용자에게 보여 줄 말. */
export function fileReadError(e: unknown, name?: string): string[] {
  const err = e as { name?: string; message?: string } | null;
  if (err && (err.name === 'NotReadableError' || err.name === 'NotFoundError' || err.name === 'SecurityError'))
    return [
      `${name ? name + ' — ' : ''}브라우저가 이 파일을 읽을 권한을 잃었어요.`,
      '구글 드라이브·클라우드 앱에서 바로 고르거나, 아직 내려받는 중이거나, 고른 뒤 파일이 옮겨지면 생겨요.',
      '파일을 기기(다운로드 폴더)에 저장한 뒤 거기서 다시 골라 주세요.',
    ];
  return [err?.message ?? String(e)];
}

/**
 * 고른 파일을 바로 메모리로 읽어 둔다. 안드로이드 크롬은 고른 뒤 시간이 지나거나 화면을 오가면
 * (드라이브·다른 앱이 준 파일) 읽을 권한을 잃어 나중 읽기가 NotReadableError로 실패한다.
 * 폴더 고르기는 상대 경로(webkitRelativePath)가 필요해 그대로 둔다.
 */
async function snapshot(list: FileList, keep: boolean): Promise<File[] | null> {
  const arr = [...list];
  if (keep) return arr;
  try {
    return await Promise.all(arr.map(async (f) => new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified })));
  } catch (e) {
    await alertBox('파일을 읽을 수 없습니다', fileReadError(e, arr.length === 1 ? arr[0].name : undefined));
    return null;
  }
}

/** 선택 이벤트 → 읽어 둔 파일 목록으로 onPick. */
function picked(inp: HTMLInputElement, directory: boolean | undefined, onPick: (files: File[]) => void): void {
  const list = inp.files;
  if (list && list.length)
    void snapshot(list, !!directory).then((files) => {
      if (files) onPick(files);
    });
  // 읽기를 시작한 뒤 비운다 (같은 파일 다시 고르기 허용). File 객체는 이미 잡아 두었다.
  inp.value = '';
}

export function fileInput(opts: { accept?: string; multiple?: boolean; directory?: boolean }, onPick: (files: File[]) => void): HTMLInputElement {
  const inp = h('input', { type: 'file', accept: opts.accept, multiple: opts.multiple, style: 'display:none' });
  if (opts.directory) {
    inp.setAttribute('webkitdirectory', '');
    inp.setAttribute('directory', '');
  }
  inp.addEventListener('change', () => picked(inp, opts.directory, onPick));
  return inp;
}

export { isTyping } from '../game/input';

const PICKER_HINT =
  '파일 선택 창이 안 열렸나요? Claude 앱 안에서는 파일을 고를 수 없을 수 있어요. 이 링크를 크롬·사파리 같은 브라우저에서 열어 주세요.';

/**
 * 파일 선택 버튼. 투명한 <input type=file>을 버튼 위에 겹쳐 사용자가 입력 요소를 직접 누르게 한다.
 * (숨긴 입력을 코드로 click()하면 일부 모바일 브라우저·앱 화면에서 선택 창이 뜨지 않는다.)
 * 눌렀는데 선택 창이 열린 흔적(페이지 blur/숨김)이 없으면 안내를 띄운다.
 */
export function fileButton(
  label: Child,
  opts: { accept?: string; multiple?: boolean; directory?: boolean; cls?: string; title?: string },
  onPick: (files: File[]) => void,
): HTMLLabelElement & { input: HTMLInputElement } {
  const inp = h('input', { type: 'file', class: 'file-btn-input', accept: opts.accept, multiple: opts.multiple, title: opts.title ?? '' });
  if (opts.directory) {
    inp.setAttribute('webkitdirectory', '');
    inp.setAttribute('directory', '');
  }
  let chosen = false;
  inp.addEventListener('change', () => {
    chosen = true;
    picked(inp, opts.directory, onPick);
  });
  inp.addEventListener('click', () => {
    chosen = false;
    let opened = false;
    const mark = () => (opened = true);
    window.addEventListener('blur', mark, { once: true });
    document.addEventListener('visibilitychange', mark, { once: true });
    setTimeout(() => {
      window.removeEventListener('blur', mark);
      document.removeEventListener('visibilitychange', mark);
      if (!opened && !chosen && document.hasFocus()) toast(PICKER_HINT, 7000);
    }, 1500);
  });
  const lab = h('label', { class: `btn file-btn ${opts.cls ?? ''}`, title: opts.title }, label, inp) as HTMLLabelElement & {
    input: HTMLInputElement;
  };
  lab.input = inp;
  return lab;
}

/** 파일 버튼 사용/금지 전환. */
export function setFileButtonDisabled(b: HTMLLabelElement & { input: HTMLInputElement }, disabled: boolean): void {
  b.input.disabled = disabled;
  b.classList.toggle('disabled', disabled);
}

/** 큰 파일 경고 (폰은 메모리가 부족해 멈출 수 있음). */
export function warnIfHuge(file: File): void {
  if (file.size > 300 * 1024 * 1024)
    toast(`파일이 큽니다 (${Math.round(file.size / 1024 / 1024)}MB). 폰에서는 처리 중 멈출 수 있어요. 가능하면 짧게 자르거나 컴퓨터에서 변환하세요.`, 7000);
}
