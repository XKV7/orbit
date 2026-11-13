// 기기 그래픽 성능 관련 기억 (localStorage)
/** 그래픽 메모리가 바닥나 화면이 꺼진 적이 사흘 안에 있는지 (오래된 기록·예전 형식 '1'은 무시 — 한 번 꺼졌다고 계속 흐리게 보이지 않게) */
export function lowGpuRecently(): boolean {
  try {
    const v = Number(localStorage.getItem('orbit.lowgpu'));
    return v > 1e12 && Date.now() - v < 3 * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

export function markLowGpu(): void {
  try {
    localStorage.setItem('orbit.lowgpu', String(Date.now()));
  } catch {
    /* 무시 */
  }
}
