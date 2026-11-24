// node probe.mjs <zip> <port> <t> [out.png]   env START = 시작 곡 시각 (기본 t-3), HIDE = 숨길 태그/그림 (쉼표)
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
const [, , file, port, t, out] = process.argv;
const lib = await import(pathToFileURL(process.env.ORBIT_DIR + '/scripts/lib.mjs').href);
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const start = process.env.START !== undefined ? Number(process.env.START) : Math.max(0, Number(t) - 3);
await lib.openAndPlay(p, { url: `http://localhost:${port}/`, file, startAt: start, freezeAt: Number(t) });
if (process.env.HIDE) await p.evaluate((h) => (window.__orbitHide = new Set(h.split(','))), process.env.HIDE);
await p.evaluate(() => (window.__orbitDecoList = true));
await lib.waitSongTime(p, Number(t) - 0.001, 300000);
await p.waitForTimeout(1500);
if (out) await p.screenshot({ path: out });
const st = await p.evaluate(() => window.__orbitStats ?? {});
console.log(JSON.stringify({ screen: st.screen, world: st.world, back: st.back, cur: st.cur, mirror: st.mirror }));
console.log('DECOS', JSON.stringify(st.decoList));
await b.close();
