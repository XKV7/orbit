# CLAUDE.md — ORBIT 작업 인계 문서

다른 계정·세션에서 이어서 작업할 수 있도록, 지금까지의 작업 방식·구조·배운 원작(ADOFAI) 동작·남은 일을 정리한 문서다.
명세 결정은 `DECISIONS.md`, 사용 방법은 `README.md`, 음악 넣기는 `docs/음악_추가하기.md`에 있다.

## 1. 프로젝트

- **ORBIT**: 얼음과 불의 춤(A Dance of Fire and Ice, ADOFAI)에서 영감을 받은 궤도 회전형 원버튼 리듬게임. TypeScript + PixiJS v8 + Vite, 테스트는 Vitest.
- 저장소: `XKV7/orbit` (원래 이름 `XKV7/tester` — GitHub가 옛 이름도 넘겨준다. 일부 도구는 옛 이름 `tester`로만 접근되니 막히면 둘 다 시도).
- 배포
  - **Firebase Hosting**: https://adofai-cb912.web.app — `main`에 머지되면 `.github/workflows/firebase-deploy.yml`이 자동 배포 (테스트 → 빌드 → 배포). 서비스 계정 키는 저장소 secret `FIREBASE_SERVICE_ACCOUNT`에만 있다. **키를 채팅·파일에 붙이지 말 것.**
  - **claude.ai 아티팩트**(비공개): 한 파일 HTML 빌드를 올린다 (아래 6절). 아티팩트 링크는 이전 계정 소유라 다른 계정에서는 새 아티팩트를 만들어야 한다.
- 사용자는 한국어로 대화한다. **답변은 한국어**로.

## 2. 작업 규칙 (사용자가 정한 것)

- 변경마다: `main` 최신을 받아 작업 브랜치를 다시 만들고 → 커밋 → 푸시 → PR → **머지(사용자가 머지·배포를 상시 허락함)** → Firebase 배포 성공 확인 → 아티팩트 갱신 → 한국어로 보고.
  ```bash
  git fetch origin main && git checkout -B <작업 브랜치> origin/main   # (변경은 stash로 옮기기)
  npx vitest run && npm run build
  git push -u origin <작업 브랜치>
  ```
- 커밋 메시지·PR 본문은 영어로 써 왔다. 끝에 그 세션이 정한 attribution 줄을 붙인다. **모델 이름·ID는 커밋·PR·코드에 넣지 않는다.**
- **저작권**: 원작 곡·영상·레벨 파일·그림은 저장소에 커밋하지 않는다 (비교·시험은 임시 폴더에서만). 원작의 그림·아이콘·소리·폰트를 베끼지 않는다. 사용자 대신 맵을 내려받아 배포하지 않는다.
- 원작 내부 동작은 공개 모드 소스·위키·녹화 비교로 알아내고 **규칙과 숫자만** 우리 코드로 다시 짠다 (원작 코드 복사 금지). 사용자 PC(Steam+ADOFAI 설치)를 Remote Control로 연결하면 디컴파일러(dnSpy/ILSpy)로 `Assembly-CSharp.dll`을 볼 수 있다고 안내해 둠 — 약관 주의, 아직 연결된 적 없음.
- 미리보기 서버를 끌 때 `pkill -f "vite preview"`를 쓰지 말 것 (다른 것까지 죽었다).
- 아티팩트는 비공개로 둔다.

## 3. 명령

```bash
npm ci                 # 의존성 (새 컨테이너면 먼저)
npm run dev            # 개발 서버
npx vitest run         # 테스트 (현재 172개 통과)
npx tsc --noEmit -p .  # 타입 검사 (tests/tmp 같은 임시 테스트 파일이 있으면 node:fs 타입 때문에 실패 — 지울 것)
npm run build          # tsc + vite build → dist/
npx vite preview --port 4175 --strictPort   # 빌드 결과로 브라우저 시험 (백그라운드로)
```

## 4. 구조

- `src/core/` — 게임 규칙 (DOM 없음, 단위 테스트 대상)
  - `types.ts` 레벨 형식(LevelData, Action 유니온), `level.ts` 검증(`validateLevel`, `FILTER_NAMES`, `ACTION_TYPES`)
  - `chart.ts` 레벨 → 타일 위치·박·시각 (`compileChart`, `orbiterAngle`, MultiPlanet 3행성 −60° 처리)
  - `timeline.ts` 연출 상태(`VisualTimeline`: 카메라·필터 `filters` 맵(배경 층은 `bg:` 접두사)·장식·타일 오프셋·트랙 애니메이션 `tileAnimAt`)
  - `judge.ts` 판정 (`adofaiWindows` = 원작 각도 기준, `judgeError`, `OverloadTracker`), `stats.ts` 통계(정확도·**절대정확도 `xAccuracy`**·무적 모드 카운트)
- `src/levels/` — `adofai.ts` 원작 `.adofai` → ORBIT 변환기(가장 큼), `package.ts` zip/폴더 패키지·파일 찾기·여러 .adofai 중 고르기, `library.ts`/`store.ts` 저장
- `src/render/` — `stage.ts`(Pixi 앱, 레이어: backPlane[bg+backWorld] / worldWrap[world] / overlay, 필터 적용, 잔상, 화질 자동 조절), `track.ts`(타일, 스타일 orbit/standard/neon/basic/neonlight), `planets.ts`(행성 2·3개), `decorations.ts`(장식·입자·가림막·텍스처 메모리 예산), `screenfx.ts`(화면 필터 셰이더·빛 번짐)
- `src/game/` — `game.ts`(게임 루프·판정·실패/무적 모드·결과), `input.ts`, `settings.ts`
- `src/audio/` — 엔진·효과음·`device.ts`(오디오 기기별 오프셋, 출력 지연으로 기기 구분)
- `src/ui/` — 화면들 (`select.ts` 레벨 선택: 자동 플레이·무적 모드 체크박스, `play.ts` 플레이·결과 화면, `calibrate.ts` 보정, `offsetUi.ts`, `settings.ts`)
- `src/editor/` — 레벨 에디터 (도구 칸에 자동 플레이·무적 모드 플레이테스트)

## 5. 원작(ADOFAI) 동작 — 녹화 비교·자료로 확인한 것

새 원작 레벨 문제를 볼 때 먼저 참고할 것. (출처: 원작 녹화 프레임 비교, 공개 모드 소스 [Overlayer](https://github.com/qwru0905/Overlayer) `Overlayer/Tags/Hit.cs` 등, ADOFAI 위키)

### 판정 (`src/core/judge.ts` `adofaiWindows`)
- 각도 기준 (반 박 = 180°): 완벽 ±30°, 약간 빠름·느림 ±45°, 빠름·느림 ±60°, 그보다 빠르면 너무 빠름, 늦으면 놓침.
- 아주 빠른 곡의 최소 시간: PC 완벽 25ms·약간 30ms·빠름/느림 91(느슨)/65(보통)/40(엄격)ms, 모바일 50/70/90ms. 연습 속도로 나눔. 터치 기기(`pointer: coarse`)는 모바일 값.
- 절대정확도(X-Accuracy) = (완벽×100 + 약간×75 + 빠름/느림×40 + 너무 빠름×20 + 놓침×0) / 판정 수 × 0.9875^체크포인트 사용 횟수. 사용자의 원작 결과 화면 두 장(48.67%, 39.10%)과 정확히 일치.
- 판정 타이밍은 출발 타일의 BPM×속도 기준.

### 변환 규칙 (`src/levels/adofai.ts`)
- 확장 필터(CameraFilterPack)는 **속성값으로 세기**를 정한다 (Blur_Movie 반경 0 = 꺼짐, PlanetMars/Sepia/GrayScale/Rain의 Fade, 등). 값 0으로 "끄는" 이벤트가 많다.
- `plane: Background` 필터는 배경 층(배경 + 트랙 뒤 장식)에만.
- 필터 duration에 ease 적용.
- 음수 `angleOffset` = 그만큼 **먼저** 실행 (0으로 자르면 시작 플래시 순서가 뒤집혔다).
- MoveCamera에서 `relativeTo`가 비면 이전 기준을 이어 쓰고, 타일 기준이면 **이 이벤트의 타일**.
- AnimateTrack: 에디터는 꺼 둔 칸에도 `beatsAhead: 3`/`beatsBehind: 4` 기본값을 적어 둔다 → 해당 애니메이션(`trackAnimation`/`trackDisappearAnimation`)을 같이 바꿀 때만 박 수를 쓴다. 박은 그 타일 BPM 기준 (곡 시작 BPM 기준은 틀렸음, 되돌림).
- MultiPlanet ThreePlanets: 매 타일 공전각 −60° (곧은 길 120°). 대회판 Phantigma 끝 시각이 일반판과 일치하는 것으로 검증.
- SetConditionalEvents + Kill 히트박스 → 판정 규칙(JudgeRule, 대회 규칙).
- 트랙 스타일 NeonLight는 별도 모양(밝은 속 + 흰 테두리).
- JSON에 쉼표가 빠진 .adofai도 읽는다 (선형 시간 관대한 파서).
- zip 안에 .adofai가 여러 개면 묶인 그림을 가장 많이 쓰는 파일 → 이벤트 수 순으로 고른다 (에디터에서 바꿀 수 있음).

### 장식·화면 (`src/render/`)
- 가림막(mask)은 **알파 채널**로 (빨강 채널이면 검게 칠한 가림막이 없어진 것처럼 돼 화면이 까매졌다 — BIKE).
- parallaxOffset은 비율을 곱하지 않고 그대로 더한다. parallax 위치는 장식 자신의 자리 기준.
- 장식 `tile`은 크기는 그대로 두고 그 안에 그림을 반복 (TilingSprite tileScale = 1/tile).
- 카메라에 붙은 장식은 카메라 줌에 따라 위치·크기가 함께 바뀌어 화면에 고정, `lockScale`이면 반대로 월드 크기 유지. 월드 장식은 `lockScale`일 때만 화면 크기 유지.
- 입자 크기는 그림 픽셀 수와 무관한 길이 (1 = 타일 하나, 긴 변 기준).
- HallOfMirrors(잔상)는 배경 그림·영상이 있으면 쌓지 않는다 (원작은 배경이 매 프레임 다시 덮음).
- Bloom: 문턱이 0보다 크면 화면 전체(배경 포함)에 걸고, 문턱 0이면 트랙 층에만(+레벨별 `settings.glow` 배율).
- 레거시 SetFilter Sharpen은 대비가 아니라 윤곽 선명화 (큰 값에서 화면이 까매졌다).
- 장식 텍스처: **화면에 보이는 크기만큼만** 올리고 커지면 원본에서 다시 올림. 메모리 예산 PC 768MB / 폰 256MB, 넘치면 안 보이는 것부터 내림. 그래픽 메모리가 넘치면 WebGL이 꺼져 타일까지 사라진다 (Phantigma: 그림 142장, 7억 화소). 한 번 꺼진 기기는 `localStorage orbit.lowgpu=1`로 기억해 작게 올림.

## 6. 시험·비교 방법

- 브라우저 자동 시험: Playwright (`/opt/node22/lib/node_modules/playwright`, Chromium은 `--use-gl=swiftshader --enable-unsafe-swiftshader`).
- 게임이 열어 둔 시험용 전역:
  - `window.__orbitFreezeAt = 초` → 그 곡 시각에서 화면 멈춤, `window.__orbitSongTime` 현재 곡 시각
  - `window.__orbitStats` 이번 프레임 필터·보이는 타일·장식 수·CPU ms·장식 텍스처 MB
  - `window.__orbitHide = new Set([그림 이름…])` 장식 숨기기 (어느 장식이 화면을 덮는지 찾기), `window.__orbitStage` 스테이지
- 흐름: 시작 → 레벨 불러오기(zip) → 경고 모달 확인 → `label:has-text("자동 플레이") input` 체크 → 플레이 → 시각마다 멈춰 스크린샷.
- 원작 녹화와 맞추기: 녹화 HUD의 진행률(Progress %)이나 Perfect 카운터로 타일 → 곡 시각을 구해 같은 시각끼리 나란히 붙여 비교 (ffmpeg hstack/vstack).
- 원작 레벨·녹화는 저장소 밖 임시 폴더에만 두고 커밋하지 말 것.
- 아티팩트 한 파일 빌드: vite를 `inlineDynamicImports`/`assetsInlineLimit` 크게/`cssCodeSplit:false`로 따로 빌드한 뒤 JS·CSS를 `index.html`에 넣는다. 문자열 치환은 **함수형 replace**로 (`$'` 같은 패턴이 JS에 있어 깨졌다), `</script`는 `<\/script`로. 크기 약 1.8MB.

## 7. 지금까지 한 일 (PR 요약, 최근 → 과거)

- #70 판정 창을 원작 각도 기준으로 (예전 ms 고정 창은 보통 BPM에서 원작보다 약 2배 좁았음)
- #69 보정 키보드 조작 (버튼 포커스 문제 해결, Enter 다음 단계, ←/→ 기기 오프셋, ↑/↓ 화면 미세, Shift 10ms, R 처음부터)
- #68 에디터 플레이테스트 무적 모드 + 결과 화면, #67 절대정확도, #66 무적 모드(실패 없이 끝까지, 놓침·과부하·홀드·규칙 위반 집계)
- #65 Plum - Timeline: 잔상·음수 angleOffset·화면 전체 빛 번짐
- #64/#63 AnimateTrack 기본값 무시 (#63의 시작 BPM 기준은 되돌림)
- #62/#61 장식 그림 화면 크기 기준 로딩·메모리 예산·카메라 장식 줌·입자 크기 (Phantigma 실제 그림)
- #60 MultiPlanet 3행성, #59 BIKE 검은 화면(가림막·산 장식·Sharpen), #58 Phantigma 확장 필터·배경 층 필터·NeonLight
- #57 대회 판정 규칙, #56 가시성(트랙 외곽선·행성 강조), #55 쉼표 빠진 .adofai, #54 .adofai 고르기
- #51~#52 보정 개편 (기기별 오프셋, 드럼 탭, 2단계 화면 맞추기), #48~#45 원작 16:9 화면 맞춤·회전·전체 화면
- #49~#50/#23 Hello (BPM) 2025 지원·녹화 비교, #44/#36 폰 WebGL 끊김·텍스처, #41 화질 자동 조절
- 그 이전: 에디터·자동 생성·온라인(Firebase 로그인·업로드·순위·동기화)·기본 게임

시험한 원작 레벨: Hello (BPM) 2025/2026, Phantigma(AWC2026 결승 타이브레이커, 대회판·일반판), BIKE - Tanger, Plum - Timeline, R(원작 월드).

## 8. 남은 일 / 알려진 문제

- **타일 이동(MoveTrack) 중 공이 타일을 따라가는 시각적 오류** — 사용자가 보고. 공을 착지 위치에 고정하는 수정을 넣었다가 되돌림 (트랙 전체가 미끄러지는 연출은 원작도 공이 따라갈 수 있어 확신 없음). 어느 레벨·몇 초인지와 원작 녹화를 받아 비교한 뒤 고칠 것.
- 배경(BGA): 레벨별로 남은 차이 — Phantigma 29초 근처 회색 장면, 152초 카메라 줌/위치, 145초 만화 집중선 과함, 전체 채도가 원작보다 낮음. Plum - Timeline은 구름 위치(카메라 구도), 타일 반투명도.
- 미구현 원작 효과: 필터 LightWater, OilPaint(레거시 SetFilter), Vision 계열 일부, SetPlanetRotation, SetHitsound 게임 소리, MultiPlanet 4개 이상, FreeRoam.
- 판정이 바뀌었으니 사용자에게 다시 보정해 보도록 안내함 — 피드백 받기.
- "너무 빠름" 하한: 지금은 구간 시간의 절반보다 이른 입력은 무시 (원작은 더 많이 너무 빠름으로 셀 수 있음, 미확인).
- 네트워크: 이 클라우드 환경에서 `adofai.fandom.com`, `cloud.adofai.gg`는 막혀 있었다 (환경 설정에서 허용 필요). GitHub은 됨.
