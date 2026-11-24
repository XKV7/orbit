import { findSong, loadPackageAudio, type LevelPackage } from '../levels/package';
import {
  cleanName,
  currentProfile,
  deleteLevel,
  downloadLevel,
  featureLevel,
  listFeatured,
  listLevels,
  unfeatureLevel,
  MAX_FILE_BYTES,
  onProfile,
  rankKey,
  referencedFiles,
  setNickname,
  signIn,
  signOut,
  topScores,
  uploadLevel,
  type CloudLevel,
} from '../online/cloud';
import { onlineAvailable } from '../online/config';
import { alertBox, confirmBox, h, stars, toast } from './dom';

export { onlineAvailable };

function errText(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'permission-denied') return '권한이 없습니다. (로그인 상태나 데이터베이스 규칙을 확인하세요)';
  if (code === 'unavailable') return '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
  if (code === 'auth/unauthorized-domain') return '이 주소에서는 로그인할 수 없습니다. Firebase 콘솔의 승인된 도메인에 추가하세요.';
  return (e as Error).message || String(e);
}

/** 빈 모달 틀. body에 내용을 넣고 close()로 닫는다. */
function modal(title: string, wide = false): { body: HTMLElement; foot: HTMLElement; close: () => void; closed: Promise<void> } {
  let resolve!: () => void;
  const closed = new Promise<void>((r) => (resolve = r));
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'row end' });
  const wrap = h('div', { class: 'modal-wrap ui-interactive' }, h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('h2', null, title), body, foot));
  const close = () => {
    wrap.remove();
    resolve();
  };
  foot.append(h('button', { class: 'btn ghost', onclick: close }, '닫기'));
  document.body.appendChild(wrap);
  return { body, foot, close, closed };
}

/** 한 줄 입력 모달. 취소하면 null. */
export function inputBox(title: string, message: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'text-input', value, maxLength: 20 });
    const done = (v: string | null) => {
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
        h('div', { class: 'modal-body' }, h('p', null, message), input),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', onclick: () => done(null) }, '취소'),
          h('button', { class: 'btn primary', onclick: () => done(input.value) }, '확인'),
        ),
      ),
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
      e.stopPropagation();
    });
    document.body.appendChild(wrap);
    input.focus();
    input.select();
  });
}

/** 로그인 필요 시 안내 후 로그인. 로그인되면 true. */
export async function ensureSignedIn(reason: string): Promise<boolean> {
  if (currentProfile()) return true;
  if (!(await confirmBox('로그인이 필요합니다', `${reason} Google 계정으로 로그인할까요?`, '로그인'))) return false;
  try {
    await signIn();
  } catch (e) {
    await alertBox('로그인 실패', [errText(e)]);
    return false;
  }
  // onAuthStateChanged가 프로필을 채울 때까지 잠깐 기다림
  for (let i = 0; i < 40 && !currentProfile(); i++) await new Promise((r) => setTimeout(r, 100));
  return !!currentProfile();
}

/** 타이틀 화면의 계정 줄: 로그인 버튼 또는 '이름 · 이름 변경 · 로그아웃'. */
export function accountBar(): HTMLElement | null {
  if (!onlineAvailable()) return null;
  const el = h('div', { class: 'account-bar' });
  let first = true;
  const off = onProfile((p) => {
    // 화면을 떠나 계정 줄이 사라졌으면 더 듣지 않는다
    if (!first && !el.isConnected) {
      off();
      return;
    }
    first = false;
    el.innerHTML = '';
    if (!p) {
      el.append(
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => void signIn().catch((e) => alertBox('로그인 실패', [errText(e)])),
          },
          'Google로 로그인',
        ),
        h('span', { class: 'dim' }, ' 온라인 레벨·순위·설정 동기화'),
      );
    } else {
      el.append(
        h('span', null, `${p.name} 님`),
        h(
          'button',
          {
            class: 'btn small ghost',
            onclick: async () => {
              const n = await inputBox('이름 변경', '순위표와 올린 레벨에 보이는 이름입니다 (20자까지).', p.name);
              if (n === null) return;
              try {
                await setNickname(cleanName(n));
              } catch (e) {
                await alertBox('이름을 바꿀 수 없습니다', [errText(e)]);
              }
            },
          },
          '이름 변경',
        ),
        h('button', { class: 'btn small ghost', onclick: () => void signOut() }, '로그아웃'),
      );
    }
  });
  return el;
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

/** 온라인 레벨 목록. 받은 레벨을 onPick으로 넘긴다. */
export async function openOnlineLevels(onPick: (pkg: LevelPackage) => void): Promise<void> {
  const m = modal('온라인 레벨', true);
  m.body.append(h('p', null, '불러오는 중…'));
  let items: CloudLevel[];
  try {
    items = await listLevels();
  } catch (e) {
    m.body.innerHTML = '';
    m.body.append(h('p', null, `목록을 불러올 수 없습니다: ${errText(e)}`));
    return;
  }
  const render = () => {
    m.body.innerHTML = '';
    if (!items.length) {
      m.body.append(h('p', null, '아직 올라온 레벨이 없습니다. 레벨을 고르고 "올리기"를 눌러 첫 레벨을 올려보세요.'));
      return;
    }
    const me = currentProfile();
    for (const it of items) {
      const get = h('button', { class: 'btn small primary' }, '받기');
      get.onclick = async () => {
        get.disabled = true;
        get.textContent = '받는 중…';
        try {
          const pkg = await downloadLevel(it.id);
          m.close();
          onPick(pkg);
          if (pkg.warnings.length) toast(pkg.warnings.join(' '), 4000);
        } catch (e) {
          get.disabled = false;
          get.textContent = '받기';
          await alertBox('받을 수 없습니다', [errText(e)]);
        }
      };
      const del =
        me && me.uid === it.ownerUid
          ? h('button', {
              class: 'btn small ghost',
              onclick: async () => {
                if (!(await confirmBox('레벨 삭제', `'${it.title}'을(를) 온라인에서 삭제할까요? 되돌릴 수 없습니다.`, '삭제'))) return;
                try {
                  await deleteLevel(it.id);
                  items = items.filter((x) => x !== it);
                  render();
                } catch (e) {
                  await alertBox('삭제할 수 없습니다', [errText(e)]);
                }
              },
            }, '삭제')
          : null;
      m.body.append(
        h(
          'div',
          { class: 'online-row' },
          h(
            'div',
            { class: 'grow' },
            h('b', null, it.title),
            h('div', { class: 'dim' }, `${it.artist || '알 수 없음'} · 올린 사람 ${it.author || '?'}`),
            h('div', { class: 'dim' }, `${it.bpm} BPM · ${it.tiles} 타일 · ${it.hasSong ? `음원 ${mb(it.bytes)}` : '음원 없음'} · `, h('span', { class: 'stars-inline' }, stars(it.difficulty))),
          ),
          del,
          get,
        ),
      );
    }
  };
  render();
  await m.closed;
}

/** WAV 같은 큰 음원은 mp3로 줄여 올린다. */
async function shrinkSong(pkg: LevelPackage, files: { name: string; data: Uint8Array }[]): Promise<{ files: { name: string; data: Uint8Array }[]; rename?: string }> {
  const song = pkg.level.settings.songFile;
  const i = files.findIndex((f) => f.name === song);
  if (i < 0) return { files };
  const f = files[i];
  const isWav = /\.wav$/i.test(f.name);
  if (!isWav && f.data.length <= MAX_FILE_BYTES) return { files };
  toast('음원을 mp3로 줄이는 중…', 3000);
  const buf = await loadPackageAudio(pkg);
  const { encodeMp3 } = await import('../audio/mp3');
  const chs = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c));
  const data = await encodeMp3(chs, buf.sampleRate, { kbps: chs.length === 2 ? 160 : 128 });
  const name = f.name.replace(/\.[^.]+$/, '') + '.mp3';
  const out = files.slice();
  out[i] = { name, data };
  return { files: out, rename: name };
}

/** 선택한 레벨(과 음원)을 온라인에 올린다. */
export async function uploadSelected(pkg: LevelPackage): Promise<void> {
  if ((await uploadPkg(pkg)) !== null) toast('올렸습니다! "온라인 레벨"에서 볼 수 있어요.', 3500);
}

/** 올리기 (확인·로그인 포함). 올린 문서 id, 취소·실패면 null. */
async function uploadPkg(pkg: LevelPackage, permanent = false): Promise<string | null> {
  if (pkg.imported === 'adofai') {
    const go = await confirmBox(
      '원작에서 가져온 레벨입니다',
      '얼음과 불의 춤에서 변환한 레벨은 원작 맵 제작자와 음원의 저작권이 있어요. 개인 플레이용으로만 쓰는 것을 권합니다.\n' +
        '제작자와 음원 권리자에게 허락을 받은 경우에만 올려 주세요.',
      '허락받았음 — 올리기',
    );
    if (!go) return null;
  }
  if (!(await ensureSignedIn('레벨을 올리려면 로그인해야 합니다.'))) return null;
  let files = referencedFiles(pkg);
  const hasSong = !!pkg.level.settings.songFile && !!findSong(pkg.files, pkg.level.settings.songFile);
  const ok = await confirmBox(
    permanent ? '목록에 영구 추가' : '온라인에 올리기',
    `'${pkg.level.meta.title}'을(를) ${hasSong ? '음원과 함께 ' : ''}올립니다. ` +
      (permanent ? '사이트에 들어오는 모든 사람의 레벨 선택 화면에 계속 보여요.' : '로그인한 사람 누구나 받아서 플레이할 수 있어요.') +
      (hasSong ? '\n직접 만들었거나 공유해도 되는 음원인지 확인해 주세요.' : ''),
    permanent ? '영구 추가' : '올리기',
  );
  if (!ok) return null;
  const level = pkg.level;
  try {
    const shrunk = await shrinkSong(pkg, files);
    files = shrunk.files;
    const up: LevelPackage = shrunk.rename ? { ...pkg, level: { ...level, settings: { ...level.settings, songFile: shrunk.rename } } } : pkg;
    const m = modal('올리는 중');
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
    const label = h('p', null, '0%');
    m.body.append(bar, label);
    m.foot.innerHTML = '';
    try {
      return await uploadLevel(up, files, (r) => {
        (bar.firstChild as HTMLElement).style.width = `${Math.round(r * 100)}%`;
        label.textContent = `${Math.round(r * 100)}%`;
      });
    } finally {
      m.close();
    }
  } catch (e) {
    await alertBox('올릴 수 없습니다', [errText(e)]);
    return null;
  }
}

// ───────────────────────── 영구 목록 ─────────────────────────

/**
 * 영구 추가·빼기 비밀번호 (SHA-256('orbit:' + 비밀번호)). 화면 잠금 정도 — 코드를 뜯어보면 풀 수 있다 (사용자가 이 정도면 된다고 정함).
 * 서버(firestore.rules)는 로그인과 '자기가 올린 레벨인지'만 확인한다.
 */
const PERMANENT_KEY = '322ff5f636d7df896cd0b7ff6dd59a90763f8cf8c3d1b6ab825d4f166727a889';

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 비밀번호를 묻고 맞으면 true. */
async function askPassword(title: string): Promise<boolean> {
  const v = await inputBox(title, '비밀번호를 입력하세요.', '');
  if (v === null) return false;
  if ((await sha256('orbit:' + v.trim())) === PERMANENT_KEY) return true;
  await alertBox('비밀번호가 틀렸습니다', ['영구 목록은 비밀번호를 아는 사람만 바꿀 수 있어요.']);
  return false;
}

/**
 * 모든 사람의 레벨 선택 화면에 영구로 추가: 비밀번호 → 로그인 → (온라인에 없으면) 올리기 → 고정.
 * 이미 온라인에서 받은 내 레벨이면 다시 올리지 않고 고정만. 성공하면 고정된 패키지를 돌려준다.
 */
export async function addPermanently(pkg: LevelPackage): Promise<LevelPackage | null> {
  if (pkg.featured) {
    toast('이미 영구 목록에 있어요.', 2500);
    return null;
  }
  if (!(await askPassword('목록에 영구 추가'))) return null;
  if (!(await ensureSignedIn('영구 목록에 추가하려면 로그인해야 합니다.'))) return null;
  let docId: string | null = null;
  if (pkg.id.startsWith('cloud-')) {
    // 온라인에서 받은 레벨: 내가 올린 것이면 그대로 고정
    docId = pkg.id.slice('cloud-'.length);
    try {
      await featureLevel(docId);
      return done(pkg, docId);
    } catch {
      docId = null; // 남이 올린 레벨이면 내 이름으로 다시 올린다
    }
  }
  docId = await uploadPkg(pkg, true);
  if (!docId) return null;
  try {
    await featureLevel(docId);
  } catch (e) {
    await alertBox('영구 목록에 넣을 수 없습니다', [errText(e), '레벨은 온라인에 올라갔어요 ("온라인 레벨").']);
    return null;
  }
  return done(pkg, docId);

  function done(p: LevelPackage, id: string): LevelPackage {
    toast(`'${p.level.meta.title}'을(를) 모든 사람의 레벨 목록에 영구 추가했어요.`, 4000);
    return { ...p, id: `cloud-${id}`, featured: id, remote: undefined, builtin: false };
  }
}

/** 영구 목록에서 빼기 (온라인 레벨은 그대로 남는다). */
export async function removePermanently(pkg: LevelPackage): Promise<boolean> {
  if (!pkg.featured) return false;
  if (!(await confirmBox('영구 목록에서 빼기', `'${pkg.level.meta.title}'을(를) 모든 사람의 레벨 목록에서 뺄까요? (온라인 레벨에는 남아요)`, '빼기'))) return false;
  if (!(await askPassword('영구 목록에서 빼기'))) return false;
  if (!(await ensureSignedIn('영구 목록을 바꾸려면 로그인해야 합니다.'))) return false;
  try {
    await unfeatureLevel(pkg.featured);
    toast('영구 목록에서 뺐어요.', 3000);
    return true;
  } catch (e) {
    await alertBox('뺄 수 없습니다', [errText(e), '영구 목록은 그 레벨을 추가한 계정으로만 뺄 수 있어요.']);
    return false;
  }
}

let featuredOnce: Promise<LevelPackage[]> | null = null;
/** 영구 목록 (세션에 한 번만 받는다). 온라인을 못 쓰거나 실패하면 빈 목록. */
export function loadFeatured(): Promise<LevelPackage[]> {
  if (!onlineAvailable()) return Promise.resolve([]);
  featuredOnce ??= listFeatured().catch((e) => {
    console.warn('[ORBIT] 영구 목록을 불러오지 못함', e);
    featuredOnce = null;
    return [];
  });
  return featuredOnce;
}

/** 아직 파일을 안 받은 영구 목록 레벨의 음원·그림을 받는다. */
export async function fetchRemote(pkg: LevelPackage): Promise<LevelPackage> {
  if (!pkg.remote) return pkg;
  const full = await downloadLevel(pkg.remote);
  return { ...full, featured: pkg.featured, remote: undefined };
}

/** 선택한 레벨의 순위표. */
export async function openRanking(pkg: LevelPackage): Promise<void> {
  const key = rankKey(pkg);
  const m = modal(`순위 — ${pkg.level.meta.title}`);
  if (!key) {
    m.body.append(h('p', null, '이 레벨은 순위가 없습니다. 온라인에 올린 뒤 "온라인 레벨"에서 받은 레벨이나, 게임에 포함된 레벨에서 순위가 기록됩니다.'));
    return;
  }
  m.body.append(h('p', null, '불러오는 중…'));
  try {
    const rows = await topScores(key);
    m.body.innerHTML = '';
    if (!rows.length) m.body.append(h('p', null, '아직 기록이 없습니다. 로그인하고 클리어하면 첫 기록이 됩니다.'));
    const me = currentProfile();
    const table = h('table', { class: 'rank' });
    rows.forEach((r, i) => table.append(h('tr', { class: me && r.uid === me.uid ? 'me' : '' }, h('td', null, String(i + 1)), h('td', null, r.name), h('td', null, `${r.acc.toFixed(2)}%`))));
    if (rows.length) m.body.append(table);
    if (!me) m.body.append(h('p', null, '로그인하면 내 기록도 올라갑니다.'));
  } catch (e) {
    m.body.innerHTML = '';
    m.body.append(h('p', null, `순위를 불러올 수 없습니다: ${errText(e)}`));
  }
  await m.closed;
}
