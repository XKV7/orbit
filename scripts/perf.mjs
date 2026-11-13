// 프레임 성능 측정: 자동 플레이로 곡 시각 <초>부터 8초 동안 한 프레임의 계산·그리기 시간(ms)을 잰다.
//   npx vite preview --port 4175 --strictPort   (먼저 npm run build, 백그라운드로)
//   node scripts/perf.mjs <레벨.zip|.adofai> <초> [CPU 느리게 배율=4] [포트=4175] [prof]
// prof를 붙이면 JS 함수별 자기 시간 상위 22개도 출력 (CDP 샘플링 프로파일러).
// 같은 방법으로 바꾸기 전 빌드(다른 포트)와 비교할 것. 그리기 시간은 소프트웨어 GPU라 실제 기기와 다르다.
import { loadPlaywright, CHROME_ARGS, openAndPlay, waitSongTime } from './lib.mjs';

const [, , file, startArg, throttleArg = '4', port = '4175', prof = ''] = process.argv;
if (!file || startArg === undefined) {
  console.log('사용법: node scripts/perf.mjs <레벨 파일> <곡 시각(초)> [CPU 배율] [포트] [prof]');
  process.exit(1);
}
const startAt = Number(startArg);
const { chromium } = loadPlaywright();
const b = await chromium.launch({ args: CHROME_ARGS });
// ORBIT_DPR=2: 태블릿처럼 화면 배율 2 (그리는 픽셀 수 4배 — GPU 부담 비교용)
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.ORBIT_DPR || 1) });
const cdp = await p.context().newCDPSession(p);
await openAndPlay(p, { url: `http://localhost:${port}/`, file, startAt });
await waitSongTime(p, startAt + 1, 120000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(throttleArg) });
if (prof) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
}
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 8000) {
  samples.push(
    await p.evaluate(() => {
      const s = window.__orbitStats || {};
      return [s.frameMs, s.renderMs, s.tiles, s.decos, window.__orbitStage?.fps ?? 0];
    }),
  );
  await p.waitForTimeout(250);
}
if (prof) {
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const us = profile.timeDeltas[i] ?? 0;
    total += us;
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + us);
  });
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${((100 * v) / total).toFixed(1)}% ${k}`).join('\n'));
}
const v = samples.filter((x) => x[0] !== undefined);
const avg = (k) => (v.reduce((a, x) => a + x[k], 0) / v.length).toFixed(2);
const p90 = (k) => v.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(v.length * 0.9)];
console.log(`표본 ${v.length} · ${avg(4)} fps · 계산 평균 ${avg(0)}ms (90% ${p90(0)}) · 그리기 평균 ${avg(1)}ms (90% ${p90(1)}) · 타일 ${avg(2)} · 장식 ${avg(3)}`);
await b.close();
