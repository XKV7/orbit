// 한 파일 HTML 빌드 (claude.ai 아티팩트용): 동적 import까지 한 묶음으로 만들고 JS·CSS를 index.html 안에 넣는다.
//   node scripts/single-file.mjs [출력 폴더=dist-single]   → <출력 폴더>/orbit.html (약 1.8MB)
// 주의: 문자열 치환은 함수형 replace로 ('$'' 같은 패턴이 JS 안에 있어 깨졌다), </script는 <\/script로.
import { createRequire } from 'module';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const { build } = await import(createRequire(process.cwd() + '/').resolve('vite'));
const outRoot = resolve(process.argv[2] ?? 'dist-single');
const out = outRoot + '/build';
await build({
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 1e9,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const files = readdirSync(out + '/assets');
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
let html = readFileSync(out + '/index.html', 'utf8');
html = html
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace(/<link rel="stylesheet"[^>]*>/g, '')
  .replace(/<link rel="modulepreload"[^>]*>/g, '');
const cssText = css.map((f) => readFileSync(out + '/assets/' + f, 'utf8')).join('\n');
const jsText = js.map((f) => readFileSync(out + '/assets/' + f, 'utf8').replace(/<\/script/g, '<\\/script')).join('\n');
html = html.replace('</head>', () => `<style>${cssText}</style></head>`).replace('</body>', () => `<script type="module">${jsText}</script></body>`);
writeFileSync(outRoot + '/orbit.html', html);
console.log(js, css, '→', outRoot + '/orbit.html', Math.round(html.length / 1024), 'KB');
