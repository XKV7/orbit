/**
 * 탭이 꺼지는(메모리 부족 등) 단계 찾기: 무거운 단계마다 기기에 '지금 하는 일'을 적어 두고,
 * 다음에 열었을 때 끝나지 않은 단계가 남아 있으면 알려 준다. 탭이 꺼지면 오류 메시지가 남지 않아서.
 */
const KEY = 'orbit.lastStep';

interface Crumb {
  step: string;
  detail?: string;
  heapMB?: number;
  at: number;
  build: string;
}

function heapMB(): number | undefined {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined;
}

/** 무거운 단계를 시작한다 (끝나면 done()). */
export function step(name: string, detail?: string): void {
  try {
    const c: Crumb = { step: name, detail, heapMB: heapMB(), at: Date.now(), build: __BUILD__ };
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 저장 못 하면 그냥 넘어감 */
  }
}

/** 단계를 무사히 마쳤다 (이름을 주면 그 단계일 때만 — 다른 단계가 그사이 시작됐으면 그대로 둔다). */
export function done(...names: string[]): void {
  try {
    if (names.length) {
      const s = localStorage.getItem(KEY);
      if (!s || !names.includes((JSON.parse(s) as Crumb).step)) return;
    }
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}

/** 지난번에 끝나지 못한 단계 (있으면 한 번만 돌려주고 지운다). */
export function takeUnfinished(): Crumb | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    localStorage.removeItem(KEY);
    const c = JSON.parse(s) as Crumb;
    // 하루 넘은 기록은 버린다
    return Date.now() - c.at < 86400000 ? c : null;
  } catch {
    return null;
  }
}

export const STEP_LABEL: Record<string, string> = {
  read: '파일 읽기',
  unzip: 'zip 풀기',
  convert: '레벨 변환',
  audio: '음원 풀기',
  game: '플레이 준비',
  play: '플레이 중',
};
