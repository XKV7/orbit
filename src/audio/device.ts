import { audio } from './engine';

/**
 * 오디오 출력 기기별 오프셋 (원작처럼 이어폰·스피커마다 따로).
 * 웹에서는 기기 이름을 알 수 없어, 브라우저가 알려주는 출력 지연(outputLatency)으로 기기를 구분한다
 * (블루투스는 수백 ms, 폰 스피커·유선은 수십 ms). 기기마다 다르니 온라인 설정 동기화에는 넣지 않는다.
 *
 * 기기 오프셋 D(ms): 들리는 소리가 엔진 시계보다 D만큼 늦다 (출력 지연 포함). 판정과 화면을 함께 D만큼 늦춘다.
 *
 * 출력 지연 값은 같은 기기에서도 계속 조금씩 바뀐다 → 정확한 값으로 기기를 찾으면 보정을 못 찾아 0이 쓰였다
 * (보정 후에도 판정이 밀림). 그래서 '블루투스(100ms 이상) / 그 밖' 두 갈래로만 나누고, 같은 갈래의 가장 최근 보정을 쓴다.
 * 그 갈래에 보정이 없으면 다른 갈래의 보정 + 지연 차이로 어림한다.
 */
export interface DeviceProfile {
  /** 보정할 때의 출력 지연 (ms) — 기기 구분용 */
  lat: number;
  /** 기기 오프셋 (ms) */
  offset: number;
  /** 정확도 등급 A~D */
  grade: string;
  /** 저장 시각 */
  at: number;
}

const KEY = 'orbit.devices.v2';
const OLD_KEY = 'orbit.devices.v1';

function parse(raw: string | null): DeviceProfile[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? (v.filter((p) => p && typeof p.lat === 'number' && typeof p.offset === 'number') as DeviceProfile[]) : [];
  } catch {
    return [];
  }
}

function load(): DeviceProfile[] {
  try {
    if (localStorage.getItem(KEY) !== null) return parse(localStorage.getItem(KEY));
    // v1: 엔진 시계가 출력 지연을 빼고 있었으므로 그 몫을 오프셋에 더해 옮긴다
    const old = parse(localStorage.getItem(OLD_KEY)).map((p) => ({ ...p, offset: p.offset + p.lat }));
    if (old.length) localStorage.setItem(KEY, JSON.stringify(old));
    return old;
  } catch {
    return [];
  }
}

let profiles = load();

let version = 0;

function persist(): void {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(profiles));
  } catch {
    /* 저장소 사용 불가 */
  }
}

/** 지금 출력 지연 (ms). */
export function outputLatencyMs(): number {
  return Math.round(audio().outputLatency * 1000);
}

/** 블루투스로 볼 출력 지연 (ms) */
const BT = 100;
export const isBluetooth = (lat: number) => lat >= BT;

/** 지금 출력과 같은 갈래(블루투스 / 그 밖)의 가장 최근 보정 (없으면 null). */
export function currentProfile(lat = outputLatencyMs()): DeviceProfile | null {
  let best: DeviceProfile | null = null;
  for (const p of profiles) if (isBluetooth(p.lat) === isBluetooth(lat) && (!best || p.at > best.at)) best = p;
  return best;
}

/** 순수 계산 (테스트용): 보정 목록과 지금 지연으로 기기 오프셋. */
export function offsetFor(list: readonly DeviceProfile[], lat: number): number {
  let same: DeviceProfile | null = null;
  let any: DeviceProfile | null = null;
  for (const p of list) {
    if (!any || p.at > any.at) any = p;
    if (isBluetooth(p.lat) === isBluetooth(lat) && (!same || p.at > same.at)) same = p;
  }
  if (same) return same.offset;
  // 다른 갈래 보정뿐: 지연 차이만큼 옮겨 어림. 보정이 하나도 없으면 브라우저가 알려 준 지연만큼.
  if (any) return Math.round(any.offset + (lat - any.lat));
  return Math.max(0, lat);
}

/** 지금 출력의 기기 오프셋 (ms). */
export function deviceOffsetMs(): number {
  // 게임이 매 프레임 부른다 — 출력 지연이 조금씩 바뀌어도 값이 흔들리지 않게 갈래·보정이 바뀔 때만 다시 계산
  const lat = outputLatencyMs();
  const bt = isBluetooth(lat);
  if (!cache || cache.bt !== bt || cache.ver !== version) cache = { bt, ver: version, v: offsetFor(profiles, lat) };
  return cache.v;
}
let cache: { bt: boolean; ver: number; v: number } | null = null;

/** 지금 출력의 보정 저장 (같은 기기 보정은 덮어씀). */
export function saveDeviceProfile(offset: number, grade: string): DeviceProfile {
  const lat = outputLatencyMs();
  // 같은 갈래의 예전 보정은 지운다 (갈래마다 하나)
  profiles = profiles.filter((q) => isBluetooth(q.lat) !== isBluetooth(lat));
  const p: DeviceProfile = { lat, offset: Math.round(offset), grade, at: Date.now() };
  profiles.push(p);
  // 오래된 것부터 정리
  profiles.sort((a, b) => b.at - a.at);
  profiles = profiles.slice(0, 8);
  persist();
  return p;
}

/** 지금 출력의 기기 오프셋만 바꾸기 (플레이 중 미세조정·자동 추천). 보정이 없으면 새로 만든다. */
export function setDeviceOffset(offset: number): void {
  const p = currentProfile();
  if (p) {
    p.offset = Math.round(offset);
    p.at = Date.now();
    persist();
  } else saveDeviceProfile(offset, '-');
}

/** 지금 갈래에 실제 보정이 있는지 (없으면 어림값). */
export function isCalibrated(): boolean {
  return currentProfile() !== null;
}

export function deviceProfiles(): readonly DeviceProfile[] {
  return profiles;
}

/** 출력 이름 (짐작): 지연이 크면 블루투스. */
export function describeOutput(lat = outputLatencyMs()): string {
  if (lat >= 100) return `블루투스 이어폰·스피커로 보이는 출력 (지연 ${lat}ms)`;
  if (lat > 0) return `폰 스피커·유선 이어폰으로 보이는 출력 (지연 ${lat}ms)`;
  return '지금 오디오 출력';
}
