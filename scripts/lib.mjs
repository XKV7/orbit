// 시험 스크립트 공통: Playwright 찾기, 레벨 불러오기, 자동 플레이로 원하는 곡 시각부터 시작.
// 원작 레벨·녹화는 저장소 밖에 두고 경로만 넘긴다 (커밋 금지).
import { createRequire } from 'module';

/** Playwright: 프로젝트에 없으면 클라우드 컨테이너의 전역 설치(/opt/node22/lib/node_modules)나 PLAYWRIGHT_DIR에서 찾는다. */
export function loadPlaywright() {
  const dirs = [process.cwd() + '/', process.env.PLAYWRIGHT_DIR, '/opt/node22/lib/node_modules/'].filter(Boolean);
  for (const d of dirs) {
    try {
      return createRequire(d.endsWith('/') ? d : d + '/')('playwright');
    } catch {
      /* 다음 */
    }
  }
  throw new Error('playwright를 찾지 못했습니다 (PLAYWRIGHT_DIR로 node_modules 위치 지정)');
}

/** 소프트웨어 GPU(swiftshader) — 컨테이너에 그래픽 카드가 없어도 WebGL이 돈다. 그리기 시간은 실제 기기와 다르다. */
export const CHROME_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

/**
 * 게임을 열고 레벨 파일(.adofai / .zip)을 불러와 자동 플레이로 시작한다.
 * startAt: 그 곡 시각의 타일부터 시작 (초), freezeAt: 그 곡 시각에서 화면 멈춤 (초, 선택).
 */
export async function openAndPlay(page, { url, file, startAt = 0, freezeAt, settings, quality = process.env.ORBIT_QUALITY }) {
  // 화질 단계 고정 (ORBIT_QUALITY=0 등): 소프트웨어 GPU에서는 자동 화질이 금방 내려가 바꾸기 전·후 비교가 어긋난다
  if (quality !== undefined && quality !== '') await page.addInitScript((q) => { window.__orbitQuality = Number(q); }, String(quality));
  await page.goto(url);
  if (settings) {
    await page.evaluate((s) => localStorage.setItem('orbit.settings.v1', JSON.stringify(s)), settings);
    await page.reload();
  }
  await page.waitForTimeout(800);
  for (const t of ['시작', '플레이']) {
    const bt = page.locator(`button:has-text("${t}")`).first();
    if (await bt.count()) {
      await bt.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(500);
  // 레벨 불러오기 입력 (첫 번째 파일 입력은 '음원으로 레벨 만들기')
  await page.locator('input[type=file][accept*=adofai]').first().setInputFiles(file);
  // 원작 맵 경고 창
  await page.waitForSelector('.modal-wrap', { timeout: 120000 });
  await page.locator('.modal-wrap button').last().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('label:has-text("자동 플레이") input').check();
  await page.evaluate(
    ([s, f]) => {
      window.__orbitStartAt = s;
      if (f !== undefined) window.__orbitFreezeAt = f;
    },
    [startAt, freezeAt],
  );
  await page.locator('button:has-text("플레이")').last().click();
}

/** 곡 시각이 t를 넘을 때까지 기다린다. */
export async function waitSongTime(page, t, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const x = await page.evaluate(() => window.__orbitSongTime ?? -99);
    if (x >= t) return x;
    await page.waitForTimeout(100);
  }
  throw new Error(`곡 시각 ${t}초에 닿지 못함`);
}
