// 탭 메모리 측정 (폰 흉내): 레벨 불러오기·플레이 시작 동안 크롬 렌더러 프로세스 메모리(RSS)를 0.3초마다 재 최고치를 출력.
// 태블릿·폰에서 탭이 꺼지는 문제를 볼 때. Linux(/proc)에서만 동작.
//   node scripts/memory.mjs <레벨 파일> [포트=4175]
import { readdirSync, readFileSync } from 'fs';
import { loadPlaywright, CHROME_ARGS } from './lib.mjs';

const [, , file, port = '4175'] = process.argv;
if (!file) {
  console.log('사용법: node scripts/memory.mjs <레벨 파일> [포트]');
  process.exit(1);
}
/** 크롬 프로세스 종류별 RSS(MB): R 렌더러, G GPU, B 브라우저, O 기타 */
function rss() {
  const g = {};
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const c = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (!c.includes('chrom')) continue;
      const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, 'utf8'));
      const t = c.includes('--type=renderer') ? 'R' : c.includes('--type=gpu') ? 'G' : c.includes('--type=') ? 'O' : 'B';
      g[t] = (g[t] ?? 0) + (m ? +m[1] / 1024 : 0);
    } catch {
      /* 프로세스가 사라짐 */
    }
  }
  return g;
}
const fmt = (g) => Object.entries(g).map(([k, v]) => `${k}${v.toFixed(0)}`).join(' ');
let peak = 0;
let label = 'init';
const iv = setInterval(() => {
  const g = rss();
  if ((g.R ?? 0) > peak) {
    peak = g.R;
    console.log('최고', label, fmt(g));
  }
}, 300);
const { chromium, devices } = loadPlaywright();
const b = await chromium.launch({ args: CHROME_ARGS });
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const p = await ctx.newPage();
p.on('crash', () => console.log('페이지 꺼짐'));
await p.goto(`http://localhost:${port}/`);
await p.waitForTimeout(800);
for (const t of ['시작', '플레이']) {
  const bt = p.locator(`button:has-text("${t}")`).first();
  if (await bt.count()) {
    await bt.click().catch(() => {});
    break;
  }
}
await p.waitForTimeout(500);
label = '불러오기';
const t0 = Date.now();
await p.locator('input[type=file]').first().setInputFiles(file);
await p.waitForSelector('.modal-wrap', { timeout: 120000 }).catch(() => console.log('경고 창 없음'));
console.log('불러오기', Date.now() - t0, 'ms', fmt(rss()));
await p.locator('.modal-wrap button').last().click().catch(() => {});
label = '플레이';
await p.locator('button:has-text("플레이")').last().click();
await p.waitForFunction(() => (window.__orbitSongTime ?? -99) > 0, null, { timeout: 120000 }).catch(() => console.log('시작 못 함'));
await p.waitForTimeout(8000);
console.log('8초 뒤', fmt(rss()), '· 렌더러 최고', peak.toFixed(0), 'MB');
clearInterval(iv);
await b.close();
