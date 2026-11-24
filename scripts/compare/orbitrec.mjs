// ORBIT를 실제 크롬(GPU)으로 열어 자동 플레이, 곡 시각을 이름에 넣어 계속 스크린샷
// node orbitrec.mjs <zip> <port> <outdir> <endSec> [startAt]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
const [, , file, port, out, end, startAt = '0'] = process.argv;
mkdirSync(out, { recursive: true });
const lib = await import(pathToFileURL(process.env.ORBIT_DIR + '/scripts/lib.mjs').href);
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
await lib.openAndPlay(p, { url: `http://localhost:${port}/`, file, startAt: Number(startAt) });
await lib.waitSongTime(p, Number(startAt) - 0.5, 180000);
let n = 0;
for (;;) {
  const t = await p.evaluate(() => window.__orbitSongTime ?? -99);
  if (t > Number(end)) break;
  await p.screenshot({ path: `${out}/o_${t.toFixed(3).padStart(8, '0')}.jpg`, type: 'jpeg', quality: 80 });
  n++;
}
console.log('frames', n);
await b.close();
