// 곡 시각마다 화면을 멈춰 스크린샷: 원작 녹화와 나란히 비교하거나, 바꾸기 전·후 빌드를 비교할 때.
//   node scripts/shot.mjs <레벨 파일> <포트> <출력 접두사> <초> [초…]
//   → <출력 접두사>_<초>.png  (예: ffmpeg -i a_80.png -i b_80.png -filter_complex hstack cmp.png)
// 시각마다 새 페이지에서 불러오기 → 자동 플레이 → StartAt=초-4, FreezeAt=초.
import { loadPlaywright, CHROME_ARGS, openAndPlay, waitSongTime } from './lib.mjs';

const [, , file, port, out, ...times] = process.argv;
if (!file || !port || !out || !times.length) {
  console.log('사용법: node scripts/shot.mjs <레벨 파일> <포트> <출력 접두사> <초> [초…]');
  process.exit(1);
}
const { chromium } = loadPlaywright();
const b = await chromium.launch({ args: CHROME_ARGS });
for (const t of times.map(Number)) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', (e) => console.log('페이지 오류', String(e).slice(0, 300)));
  await openAndPlay(p, { url: `http://localhost:${port}/`, file, startAt: Math.max(0, t - 4), freezeAt: t });
  await waitSongTime(p, t - 0.001, 120000);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}_${t}.png` });
  const st = await p.evaluate(() => window.__orbitStats ?? {});
  console.log('saved', `${out}_${t}.png`, `화질 단계 ${st.quality ?? '?'} · 계산 ${st.frameMs ?? '?'}ms · 그리기 ${st.renderMs ?? '?'}ms`);
  await p.close();
}
await b.close();
