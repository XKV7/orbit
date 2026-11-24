# 원작 직접 대조 도구 (CLAUDE.md 6절)

작업 폴더는 **저장소 밖**으로: `export CMP_DIR=<임시 폴더>` (그 안에 `levels/`, `rec/`가 생긴다). 원작 레벨·녹화는 커밋 금지.
파이썬은 `pip install mss pillow`. Playwright는 저장소 밖 폴더에 `npm i playwright` 하고 `.mjs` 두 개를 그 폴더에 복사해서 실행 (ESM은 스크립트 위치에서 패키지를 찾는다, 브라우저는 설치된 Chrome `channel: 'chrome'`).

- `python -I mklevel.py <sys1|sys2b|sys3>` — 시험 레벨 만들기 → `$CMP_DIR/levels/<이름>/main.adofai` + `.zip`
- `python -I rec.py <출력 폴더> <초> [fps]` — 화면 녹화 (원작 재생 직전에 백그라운드로), 파일 이름 = 녹화 시각
- `ORBIT_DIR=<저장소> node orbitrec.mjs <zip> <포트> <출력 폴더> <끝 곡 시각> [시작]` — ORBIT 자동 플레이 연속 캡처, 파일 이름 = 곡 시각
- `python -I sheet.py pair <출력.jpg> <원작 rec 폴더 이름> <원작 시각 − 곡 시각> <ORBIT rec 폴더 이름> <곡 시각…>` — 나란히 비교
- `python -I sheet.py one <출력.jpg> <rec 폴더 이름> <f|o> <시각…>` — 한 녹화 모아 보기
- `python -I bright.py <폴더> <f|o> <시작> <끝>` — 밝기 곡선 (두 녹화 시각 맞추기)
- `python -I ev.py <.adofai> [이벤트 종류,…]` — 이벤트 개수·목록
- `START=<시작 곡 시각> ORBIT_DIR=<저장소> node probe.mjs <zip> <포트> <시각> [png]` — 한 시각에 멈춰 필터·보이는 장식 목록
