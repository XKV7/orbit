# CLAUDE.md — ORBIT 작업 인계 문서

다른 계정·다른 세션의 Claude가 이 저장소를 이어받아 고칠 수 있도록 제작 과정, 현재 상황, 작업 방식, 알아낸 원작(ADOFAI) 동작, 남은 일을 정리한 문서다. **작업을 시작하기 전에 끝까지 읽을 것.**
- 사용 방법: `README.md` · 음악 넣기: `docs/음악_추가하기.md` · 초기 명세 결정: `DECISIONS.md`
- `DECISIONS.md`의 오래된 줄과 이 문서가 다르면 **이 문서(특히 5절)가 최신**이다.
- 일을 끝낼 때마다 이 문서의 7절(한 일)·8절(현재 상황)을 갱신한다.

## 0. 처음 이어받을 때 (체크리스트)

1. 사용자는 한국어로 말한다 → **답변은 한국어**. 커밋 메시지·PR 본문은 영어.
2. 준비: `npm ci` → `npx vitest run` (197개 통과해야 정상) → `npm run build`.
3. `main`이 기준이다. 열린 PR이 있는지, 마지막 Firebase 배포가 성공했는지 본다 (2절).
4. 8절의 **사용자 응답 대기** 항목 — 사용자가 캡처·파일을 보내면 그것부터 이어서 본다.
5. 다른 계정이면:
   - GitHub: 그 계정(또는 Claude GitHub 앱)이 `XKV7/orbit`에 쓰기 권한이 있어야 푸시·PR·머지가 된다.
   - 아티팩트: 지금 아티팩트는 이전 계정 소유라 갱신할 수 없다 → `node scripts/single-file.mjs`로 빌드해 **새 비공개 아티팩트**를 만들고 링크를 사용자에게 알린다.
   - Firebase 배포는 저장소 secret으로 돌아가므로 계정과 상관없이 `main` 머지만 하면 된다.
6. 원작 레벨 파일·녹화는 저장소에 없다 (저작권). 필요하면 사용자에게 받아 저장소 밖 임시 폴더에 둔다.

## 1. 프로젝트

- **ORBIT**: 얼음과 불의 춤(A Dance of Fire and Ice, ADOFAI)에서 영감을 받은 궤도 회전형 원버튼 리듬게임. 자체 레벨·에디터·온라인 기능에 더해, **원작 `.adofai` 레벨(zip)을 불러와 원작처럼 플레이**하는 것이 지금 작업의 중심이다. TypeScript + PixiJS v8(8.23) + Vite, 테스트는 Vitest.
- 저장소: `XKV7/orbit` (원래 이름 `XKV7/tester` — GitHub가 옛 이름도 넘겨준다. GitHub MCP 도구는 owner `XKV7`, repo `tester`로 불러야 했다. 막히면 둘 다 시도).
- 배포
  - **Firebase Hosting**: https://adofai-cb912.web.app — `main`에 머지되면 `.github/workflows/firebase-deploy.yml`이 자동 배포 (테스트 → 빌드 → 배포, 약 1분). 서비스 계정 키는 저장소 secret `FIREBASE_SERVICE_ACCOUNT`에만 있다. **키를 채팅·파일에 붙이지 말 것.**
  - **claude.ai 아티팩트**(비공개): 한 파일 HTML 빌드(`scripts/single-file.mjs`)를 올린다. 이전 계정의 아티팩트: https://claude.ai/artifact/SSNFTGqx9upn62ionWgQNG (그 계정에서만 갱신 가능).
- 백업: 큰 변경 전 상태는 브랜치로 남긴다 — `backup/before-perf` (#90 성능 작업 직전, eaad8ee). 사용자가 큰 변경 전에 백업을 원한 적이 있다.

## 2. 작업 규칙 (사용자가 정한 것)

- 변경마다: `main` 최신에서 작업 브랜치를 다시 만들고 → 테스트·빌드 → 커밋 → 푸시 → PR → **스쿼시 머지 (사용자가 머지·배포를 상시 허락함)** → Firebase 배포 성공 확인 → 아티팩트 갱신 → 한국어로 보고.
  ```bash
  git fetch origin main && git checkout -B <작업 브랜치> origin/main   # (작업 중 변경은 stash로 옮기기)
  npx tsc --noEmit -p . && npx vitest run && npm run build
  git push -u origin <작업 브랜치>
  ```
  - 작업 브랜치는 세션이 정해 준 이름을 쓴다 (이전 세션: `claude/sleepy-einstein-ic3c3h`). 스쿼시 머지 뒤 `main`에서 다시 만든 브랜치를 푸시하면 원격 브랜치와 갈라져 거절된다 → 강제 푸시 대신 `git merge -X ours --no-edit origin/<작업 브랜치>`로 원격 기록을 합친 뒤 푸시했다 (내용은 내 쪽 유지).
  - 배포 확인: GitHub Actions의 'Deploy to Firebase' 실행(main, 최신 커밋)이 `success`인지 본다.
- 커밋 메시지·PR 본문은 영어. 끝에 그 세션이 정한 attribution 줄을 붙인다. **모델 이름·ID는 커밋·PR·코드에 넣지 않는다.**
- **저작권**: 원작 곡·영상·레벨 파일·그림은 저장소에 커밋하지 않는다 (비교·시험은 임시 폴더에서만). 원작의 그림·아이콘·소리·폰트를 베끼지 않는다. 사용자 대신 맵을 내려받아 배포하지 않는다.
- 원작 내부 동작은 공개 모드 소스·위키·녹화 비교로 알아내고 **규칙과 숫자만** 우리 코드로 다시 짠다 (원작 코드 복사 금지). 쓴 자료: Overlayer(qwru0905), NoStopMod(Luxusio/ADOFAI-NoStopMod), DoMachinesDreamOfDeparture(kineticnapier — 원작 DLL 상수를 옮긴 시뮬레이터), AdofaiTweaks. 사용자 PC(Steam+ADOFAI)를 Remote Control로 연결하면 디컴파일러로 `Assembly-CSharp.dll`을 볼 수 있다고 안내해 둠 — 약관 주의, 아직 연결된 적 없음.
- 미리보기 서버를 끌 때 `pkill -f "vite preview"`를 쓰지 말 것 (다른 것까지 죽었다). 포트로 PID를 찾아 끈다: `ss -ltnp | grep :4175`.
- 아티팩트는 비공개로 둔다.
- 한 번 확정해 '다시 바꾸지 말 것'이라고 적힌 규칙(5절: 미드스핀 위치, 이벤트 지연 BPM)은 새 증거(원작 녹화 대조) 없이 바꾸지 않는다 — 두 번씩 뒤집었다가 되돌린 이력이 있다.

### 보고 형식 (사용자에게)
- 한국어, 짧게: 무엇을 바꿨는지(사용자 말로), 어떻게 확인했는지(테스트 수·브라우저·원작 녹화 대조), 한계·확인 못 한 것, PR 링크, 배포·아티팩트 링크.
- 사용자에게 받아야 할 것(캡처·파일·녹화)이 있으면 마지막에 구체적으로 부탁한다.

## 3. 명령

```bash
npm ci                 # 의존성 (새 컨테이너면 먼저)
npm run dev            # 개발 서버
npx vitest run         # 테스트 (현재 197개 통과)
npx tsc --noEmit -p .  # 타입 검사 (tests/tmp 같은 임시 테스트 파일이 있으면 node:fs 타입 때문에 실패 — 지울 것)
npm run build          # tsc + vite build → dist/
npx vite preview --port 4175 --strictPort   # 빌드 결과로 브라우저 시험 (백그라운드로)

# scripts/ — 시험 도구 (레벨 파일은 저장소 밖 경로로)
node scripts/single-file.mjs [출력 폴더]                       # 아티팩트용 한 파일 HTML → dist-single/orbit.html
node scripts/shot.mjs <레벨> <포트> <출력 접두사> <초>...       # 곡 시각마다 멈춰 스크린샷
node scripts/perf.mjs <레벨> <초> [CPU 배율=4] [포트] [prof]   # 8초 동안 프레임 계산·그리기 ms
node scripts/memory.mjs <레벨> [포트]                          # 폰 흉내로 탭 메모리 최고치
```

## 4. 구조

- `src/core/` — 게임 규칙 (DOM 없음, 단위 테스트 대상)
  - `types.ts` 레벨 형식(LevelData, Action 유니온), `level.ts` 검증(`validateLevel`, `FILTER_NAMES`, `ACTION_TYPES`)
  - `chart.ts` 레벨 → 타일 위치·박·시각 (`compileChart`, `orbiterAngle`, MultiPlanet 3행성 −60°, 홀드 길이 `holdLen`/`holdEnd`, 조건 연출 키 `condKey`), `math.ts` (`tilePositions`, `TILE_LEN = 100`)
  - `timeline.ts` 연출 상태(`VisualTimeline`: 카메라 축별 채널·필터 `filters` 맵(배경 층은 `bg:` 접두사)·장식·타일 오프셋(`offsetRanges`)·트랙 애니메이션 `tileAnimAt`·조건 연출 `trigger`)
  - `judge.ts` 판정 (`adofaiWindows` = 원작 각도 기준, `judgeError`, `OverloadTracker` = 과부하·멀티프레스 게이지), `stats.ts` 통계(정확도·절대정확도 `xAccuracy`·무적 모드 카운트·멀티프레스 수)
- `src/levels/` — `adofai.ts` 원작 `.adofai` → ORBIT 변환기(가장 큼, 원작 이벤트 대부분이 여기서 우리 액션으로 바뀜), `package.ts` zip/폴더 패키지·파일 찾기·여러 .adofai 중 고르기, `library.ts`/`store.ts` 저장
- `src/render/` — `stage.ts`(Pixi 앱, 레이어: backPlane[bg+backWorld] / worldWrap[world] / overlay, 필터 적용, 잔상, 화질 자동 조절 `adaptQuality`, 고주사율 60fps 고정 `adaptRate`), `track.ts`(타일, 스타일 orbit/standard/neon/basic/neonlight, 격자로 화면 근처 타일만), `planets.ts`(행성 2·3개), `decorations.ts`(장식·입자·가림막·텍스처 메모리 예산), `screenfx.ts`(화면 필터 셰이더(GLSL)·빛 번짐·충격파), `shapes.ts`(타일 모양)
- `src/game/` — `game.ts`(게임 루프·판정·실패/무적 모드·키 제한·과부하·멀티프레스·결과, `perfLine`/`diag`), `input.ts`(입력 이벤트 시각 그대로 보관), `settings.ts`
- `src/audio/` — `engine.ts`(재생·디코딩 `decodeBytes`), 효과음, `wav.ts`(WAV 직접 읽기), `device.ts`(오디오 기기별 오프셋)
- `src/ui/` — 화면들 (`select.ts` 레벨 선택: 자동 플레이·무적 모드, `play.ts` 플레이·결과 화면·프레임 표시, `calibrate.ts` 보정, `offsetUi.ts`, `settings.ts`)
- `src/editor/` — 레벨 에디터 (`schema.ts` = 이벤트 입력 칸 정의 — 새 액션을 만들면 여기에도 넣어야 tsc가 통과)
- `src/online/` — Firebase 로그인·업로드·순위·설정 동기화. `src/diag.ts` — 탭 꺼짐 진단.
- `scripts/` — 시험·빌드 도구 (3절). `tests/` — Vitest.

## 5. 원작(ADOFAI) 동작 — 녹화 비교·자료로 확인한 것

새 원작 레벨 문제를 볼 때 먼저 참고할 것. (출처: 원작 녹화 프레임 비교, 공개 모드 소스 [Overlayer](https://github.com/qwru0905/Overlayer) `Overlayer/Tags/Hit.cs` 등, ADOFAI 위키)

### 판정 (`src/core/judge.ts` `adofaiWindows`)
- 각도 기준 (반 박 = 180°): 완벽 ±30°, 약간 빠름·느림 ±45°, 빠름·느림 ±60°, 그보다 빠르면 너무 빠름, 늦으면 놓침.
- 아주 빠른 곡의 최소 시간: PC 완벽 25ms·약간 30ms·빠름/느림 91(느슨)/65(보통)/40(엄격)ms, 모바일 50/70/90ms. 연습 속도로 나눔. 터치 기기(`pointer: coarse`)는 모바일 값.
- 절대정확도(X-Accuracy) = (완벽×100 + 약간×75 + 빠름/느림×40 + 너무 빠름×20 + 놓침×0) / 판정 수 × 0.9875^체크포인트 사용 횟수. 사용자의 원작 결과 화면 두 장(48.67%, 39.10%)과 정확히 일치.
- 판정 타이밍은 출발 타일의 BPM×속도 기준.
- **너무 빠름**: 판정 창보다 이른 입력은 얼마나 이르든 모두 너무 빠름 (원작 scrMisc.GetHitMargin이 TooEarly에서 시작).
- **과부하** (`OverloadTracker`, 원작 scrFailBar.overloadCounter): 너무 빠름 한 번에 +0.5, 1박(지금 타일 BPM)마다 0.4 회복, 1을 **넘으면**(>) 실패 — 박 사이에 연달아 세 번이면 실패. 값 출처: 원작 DLL을 옮겨 적은 공개 시뮬레이터 [kineticnapier/DoMachinesDreamOfDeparture](https://github.com/kineticnapier/DoMachinesDreamOfDeparture) `src/dmdod/adofai/rules.py`. 
- **멀티프레스** (원작 입력 흐름: NoStopMod `InputFixerManager.cs`가 원작 Update를 옮겨 둔 것 + Overlayer `consecMultipressCounter > 5`): 한 프레임(우리: 한 번의 input.drain)에 들어온 누르기를 한 묶음으로 처리. 첫 키는 평소대로, 둘째부터는 다음 타일 판정 창 안이면 그대로 치고, 아니면 너무 빠름 대신 **멀티프레스**(과부하 없음). 한 프레임에 한 키만 누르면 연속 횟수 0. 연속 5번을 넘은 멀티프레스부터 멀티프레스 게이지 +0.35 (1박 0.2 회복, 6박 조용하면 0), 1을 넘으면 실패 '멀티프레스'. NoStopMod에서 홀드 각도 π(2×바퀴+1)도 확인 — 우리 홀드 길이 공식의 (2n+1)과 같음.

### 변환 규칙 (`src/levels/adofai.ts`)
- 확장 필터(CameraFilterPack)는 **속성값으로 세기**를 정한다 (Blur_Movie 반경 0 = 꺼짐, PlanetMars/Sepia/GrayScale/Rain의 Fade, 등). 값 0으로 "끄는" 이벤트가 많다.
- `plane: Background` 필터는 배경 층(배경 + 트랙 뒤 장식)에만.
- 필터 duration에 ease 적용.
- 음수 `angleOffset` = 그만큼 **먼저** 실행 (0으로 자르면 시작 플래시 순서가 뒤집혔다).
- MoveCamera에서 `relativeTo`가 비면 이전 기준을 이어 쓰고, 타일 기준이면 **이 이벤트의 타일**.
- AnimateTrack: 에디터는 꺼 둔 칸에도 `beatsAhead: 3`/`beatsBehind: 4` 기본값을 적어 둔다 → 해당 애니메이션(`trackAnimation`/`trackDisappearAnimation`)을 같이 바꿀 때만 박 수를 쓴다. **박 길이는 그 박 수를 정한 이벤트(또는 레벨 설정=0번 타일)의 BPM 기준** (#78). 타일마다의 BPM(예전)이면 빠른 구간에서 앞 타일이 거의 안 보였고, 곡 시작 BPM은 Phantigma에서 틀렸다. 검증: Phantigma 2:06 원작 22개·이 규칙 23개, ofnr 1:15 원작 약 40개·이 규칙 40개.
- MultiPlanet ThreePlanets: 매 타일 공전각 −60° (곧은 길 120°). 대회판 Phantigma 끝 시각이 일반판과 일치하는 것으로 검증.
- SetConditionalEvents + Kill 히트박스 → 판정 규칙(JudgeRule, 대회 규칙).
- SetConditionalEvents (일반): **같은 타일**에 있고 조건 칸 태그를 단 이벤트는 제자리에서 실행하지 않고 그 판정(완벽·약간·빠름/느림·너무 빠름·놓침·실패)이 나올 때만 실행 → `Conditional` 액션 + 연출의 `cond` 태그, `VisualTimeline.trigger`. ('NONE' = 빈 칸, 빈 조건 = 끄기)
- Hold 추가 바퀴 0 = 다음 타일까지 누르고 있다가 도착할 때 떼기 (`Hold.toNext`, 떼기가 다음 타일 판정).
- AutoPlayTiles → `AutoPlay` (그 구간 타일은 게임이 진행, 정확도에 안 넣음). SetPlanetRotation → `PlanetEase` (공전 곡선, 박 불변, easeParts·Mirror). SetHoldSound는 무시.
- AddObject: 타일 번호가 없으면 0번(빠뜨리면 통째로 사라짐). 트랙 스타일 Neon = 검은 속 + 색 테두리 (트랙 색으로 칠하면 큰 살구색 사각형이 됐다), Minimal/Basic = 단색, trackType Midspin = 짧은 뾰족한 모양. MoveDecorations `pivotOffset` → `pivot` (회전 중심 이동, 애니메이션).
- **미드스핀(999) 위치 (확정)**: 미드스핀 타일도 한 칸 나아가고(이전 방향의 반대), 다음 타일은 그 앞 타일 자리 (`tilePositions`에 미드스핀 예외 없음). 확정 근거: ofnr 8:20 '마법진'(미드스핀 뒤 14타일 묶음 17개)을 두 규칙으로 좌표를 그려 보면 이 규칙에서만 완벽한 대칭 눈꽃, Phantigma 길도 이 규칙에서 깔끔. '제자리' 규칙은 #74·#79에서 두 번 넣었다가 #77·#81에서 되돌림 — **다시 바꾸지 말 것**. 'a, 999, a' 줄은 원래 제자리에서 접히고, 맵이 PositionTrack 등으로 펼친다 (ofnr 3:18 확인). 사용자의 '미드스핀 맵 전부 깨짐' 보고(#77 직후)는 앞 타일이 안 보이던 문제(#78)였던 것으로 보인다.
- PositionTrack → `TrackBase` (타일 원래 위치·기본 회전·크기·불투명도, MoveTrack은 이 값 기준). 이 타일만(justThisTile)이면 그 타일만, 아니면 위치는 뒤로 누적·나머지는 다음 변경까지 (ofnr 48~62번이 원작에서 끝까지 안 보이는 것으로 확인).
- Hide → 타일 아이콘·판정 글자 숨김. 월드 장식 lockScale은 **레벨 시작 줌** 기준 (ofnr 돌 고리 크기 원작과 일치).
- 장식·오브젝트 `relativeTo` RedPlanet/BluePlanet(GreenPlanet은 빨강으로) → `red`/`blue`: 그 행성을 따라다닌다 (#80, ofnr '시계' 장면 — 행성 덮개·두 번째 행성 쌍). 게임이 매 프레임 `deco.planetPos`를 넣는다.
- AddObject 타일 모양: 원작 `trackAngle`(180 곧게·90 직각·360 끝 막음)·`trackIcon`(토끼·달팽이·소용돌이·체크포인트)을 진짜 타일과 같은 모양 함수로 그린다 (`tileAngle`·`tileIcon`, SetObject로 바뀜). 예전엔 곧은 직사각형을 돌려 흉내 — '그냥 직사각형'. 검증: 원작 길 복사 오브젝트(ofnr rzbA)는 회전 = a[f-1], trackAngle = 180 − (a[f] − a[f-1]) — 이 공식으로 그리면 진짜 길과 똑같이 겹친다.
- 이벤트 지연(angleOffset)은 **이벤트 타일의 BPM**으로 센다 (도중에 BPM이 바뀌어도). 검증: ofnr 7:2x 효과음 이벤트가 타일 시각과 0ms로 일치(누적 박이면 9~23ms 어긋남), 시계 흰 행성이 10604번 타일에서 걷기 시작·걸음 간격 = 회전 8박, Phantigma 32.67박 같은 소수 지연. #80의 누적 박 규칙은 #82에서 되돌림 — **다시 바꾸지 말 것**.
- **ScaleRadius는 다음 타일까지의 간격도 바꾼다** (`Planets.spacing`, 타일 f→f+1 간격 = f에서의 반지름). 검증: ofnr 1:20 반지름 244% 고리·1:22 눈꽃이 원작처럼 띄엄띄엄, 제작자가 반지름 125%와 타일 크기 125%를 늘 짝지어 씀. ORBIT 자체 레벨의 Planets.radius(에디터)는 간격을 안 바꾼다.
- **Hold 타일 길이** = 0.6 × (2 × 추가 바퀴 + 1) × distanceMultiplier/100 칸 (`Hold.length`): 다음 타일까지 그만큼 더 멀고, 홀드 막대는 **실제 다음 타일 쪽**(PositionTrack으로 옮겨도)으로 뻗으며, 누르는 동안 축 행성이 그 위를 미끄러진다 (`ChartTile.holdEnd`). 근거: ofnr 1:51(1770, 1바퀴·100%, 막대 길이 원작과 일치)·7:2x(10116, 0바퀴·500% → 네온 묶음과 흰 행성 위치 일치). 미드스핀 타일의 홀드도 같은 규칙 (ofnr 3:18 — 3440번 등 0바퀴·100%, 예전엔 무시해 D자 줄 간격이 넓었다). 원작 녹화의 무지개 고리는 맵 타일이 아니라(그 타일은 크기 0) 플레이어 설정 효과로 보임.
- RepeatEvents `Floor` 방식 = **다음 floorCount개 타일에서 한 번씩** (repetitions·interval은 Beat 방식 전용). ofnr 7:21 '지나간 타일 숨기기'(floorCount 9)로 확인.
- 불투명도 100% 초과(MoveDecorations·MoveTrack, 최대 2000%) = 검은 바탕에 색을 그만큼 곱한 것처럼 하얗게 타오름 (ofnr 7:21 네온 묶음 1200%→100%).
- MoveCamera position의 빈 축(null)은 그 축을 그대로 두고, 그 축의 진행 중인 이동도 계속된다 (ofnr 10582: y만 바꾸는 이벤트가 x 이동을 끊어 마법진이 치우쳤다).
- 1% 미만의 BPM 변화에는 속도 아이콘을 그리지 않는다 (ofnr 1:20 고리).
- 원작 녹화 배율 주의: 원작은 플레이어의 에디터 줌(userSizeMultiplier)이 플레이에도 적용되고, 사용자 녹화는 폰으로 유튜브를 찍어 파일마다 확대가 다르다 → 같은 녹화 안의 상대 크기로만 비교 (ofnr 7:2x는 우리 화면을 1.47배 키워 겹치면 맞음).
- 원작 녹화 HUD 아래 숫자 줄은 판정 개수(너무 빠름·빠름·약간 빠름·완벽·약간 느림·느림·너무 느림·놓침…) — 원작은 **미드스핀도 판정 하나로 센다**. 이걸 더하면 ofnr 타이밍은 원작과 1초 안으로 일치.
- 확장자 없는 장식 그림 이름('============= ACT 0' 같은 구분용)은 그림 없음. AddObject 타일도 8자리 색 알파·trackOpacity 반영.
- 트랙 스타일 NeonLight는 별도 모양(밝은 속 + 흰 테두리).
- JSON에 쉼표가 빠진 .adofai도 읽는다 (선형 시간 관대한 파서).
- zip 안에 .adofai가 여러 개면 묶인 그림을 가장 많이 쓰는 파일 → 이벤트 수 순으로 고른다 (에디터에서 바꿀 수 있음).

- KeyLimiter → `KeyLimit` (게임 규칙): 그 타일부터 처음 누른 limit개 키만 인정(터치·마우스는 한 키). exceedBehaviour Ignore = 무시, Kill 계열 = 실패('맵 키 제한'), 이벤트 = targetTag 조건 연출 실행(runEventBehaviour Once면 한 번). enabled false·limit 0 = 끄기. QuomodocunquizE는 16개·무시.
- 확장 필터 추가 (QuomodocunquizE): TV_WideScreenHV(위아래+좌우), Film_Grain(Value/10000), TV_LED·TV_ARCADE(_2)·TV_80·Blizzard(Fade), Noise_TV/_2/_3(Fade — Fade 1은 거의 안 보임), Blur_BlurHole(AlphaBlur %), Distortion_ShockWave(새 셰이더 `Shock`: 위치에서 둥근 굴절 고리가 계속 퍼짐), FX_Plasma, Vision_Drost(세기 0 = 없음). 레거시 SetFilter LightWater → Waves, OilPaint → Posterize.

### 장식·화면 (`src/render/`)
- 입자에 그림을 정했는데 그 그림이 없으면(.adofai만 불러옴·불러오는 중) 입자를 내지 않는다 — 흰 사각형으로 대신 그리면 화면이 하얗게 덮였다 (QuomodocunquizE).
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

- 브라우저 자동 시험: Playwright. 클라우드 컨테이너에는 전역 설치(`/opt/node22/lib/node_modules/playwright`)가 있고 `scripts/lib.mjs`가 찾아 쓴다. Chromium은 `--use-gl=swiftshader --enable-unsafe-swiftshader` (소프트웨어 GPU — **그리기 속도는 실제 기기와 다르다**).
- 게임이 열어 둔 시험용 전역:
  - `window.__orbitFreezeAt = 초` → 그 곡 시각에서 화면 멈춤, `window.__orbitSongTime` 현재 곡 시각
  - `window.__orbitStartAt = 초` → 플레이를 그 곡 시각의 타일부터 시작 (긴 곡을 처음부터 틀지 않고 비교)
  - `window.__orbitStats` 이번 프레임 필터·보이는 타일·장식 수·`frameMs`(계산)·`renderMs`(그리기)·장식 텍스처 MB·화질 단계. `window.__orbitTileIds = true`면 보이는 타일 번호 목록도.
  - `window.__orbitHide = new Set([그림 이름 또는 태그…])` 장식 숨기기 (어느 장식이 화면을 덮는지 찾기), `window.__orbitStage` 스테이지
  - 주소에 `?debug` → 플레이 중 진단 상자. 설정 '프레임 표시' → fps·계산·그리기 ms.
- 흐름 (`scripts/lib.mjs` `openAndPlay`): 시작 → 레벨 불러오기(zip) → 경고 모달 확인 → `label:has-text("자동 플레이") input` 체크 → StartAt/FreezeAt → 플레이.
- 원작 녹화와 맞추기: 녹화 HUD의 진행률(Progress %)이나 판정 카운터로 타일 → 곡 시각을 구해 같은 시각끼리 나란히 붙여 비교 (ffmpeg hstack/vstack). 녹화마다 확대가 달라 상대 크기로만 비교 (5절).
- ofnr 원작 녹화 14개의 곡 시각: 영상 2초 지점 = 0:07, 0:52, 1:35, 2:22, 3:08, 3:53, 4:40, 5:22, 5:42, 6:25, 7:11, 7:55, 8:37, 9:25.
- 바꾸기 전·후 비교: `git worktree add <임시 폴더> origin/main` → 거기서 `npm ci && npm run build && npx vite preview --port 4176` → 같은 스크립트를 두 포트로 돌린다.
- 원작 레벨·녹화는 저장소 밖 임시 폴더에만 두고 커밋하지 말 것.
- 한 파일 빌드: `scripts/single-file.mjs` (vite `inlineDynamicImports`, `assetsInlineLimit` 크게, `cssCodeSplit:false` → JS·CSS를 `index.html`에 넣음). 문자열 치환은 **함수형 replace**로 (`$'` 같은 패턴이 JS에 있어 깨졌다), `</script`는 `<\/script`로. 크기 약 1.8MB.

## 7. 제작 과정 (PR 요약, 최근 → 과거)

**원작 레벨 재현 · 원작 규칙 (#71~#90)**
- #91 이 인계 문서 전면 갱신 + `scripts/` 시험 도구(한 파일 빌드·스크린샷·성능·메모리)
- #90 태블릿 성능: 격자 타일 찾기, PixiJS 8.21→8.23, 고주사율 60fps 고정, 설정 '프레임 표시' (화면 모습 그대로, CPU 4배 느리게 계산 시간 30~50% ↓)
- #89 멀티프레스 (같은 프레임 여러 키, 멀티프레스 게이지), #88 과부하 (원작 실패 게이지, 이른 입력은 모두 너무 빠름)
- #87 KeyLimiter (키 개수 제한), #86 QuomodocunquizE: 확장 필터·충격파 셰이더·그림 없는 입자
- #85 미드스핀 위 홀드, #84 홀드 길이·미끄러지는 축 행성·홀드 막대
- #83 ScaleRadius 간격·RepeatEvents Floor·100% 초과 불투명도·작은 BPM 변화 아이콘 생략
- #82 이벤트 지연 = 이벤트 타일 BPM(#80 되돌림)·MoveCamera 축별, #81 타일별 조건 연출·SetObject 스타일·MoveDecorations relativeTo·미드스핀 규칙 확정·HUD 진행/정확도/절대 분리
- #80 행성 따라가는 장식·오브젝트를 진짜 타일 모양으로, #79 미드스핀 제자리(→#81 되돌림)·예각 모서리 둥글게, #78 AnimateTrack 박 수를 그 이벤트 BPM으로, #77 미드스핀 되돌림
- #76 탭 꺼짐 진단(`src/diag.ts`)·WAV 읽기 빠르게, #75 긴 곡 메모리 (낮은 표본율 디코딩, WAV 직접 읽기: 1.7GB→0.5GB)
- #74 PositionTrack·긴 합성 비트 빠르게, #73 오브젝트 스타일·번호 없는 오브젝트, #72 조건 연출·0바퀴 홀드·AutoPlayTiles·SetPlanetRotation, #71 인계 문서 첫판

**판정·보정·화면 (#41~#70)**
- #70 판정 창을 원작 각도 기준으로 (예전 ms 고정 창은 보통 BPM에서 원작보다 약 2배 좁았음)
- #69 보정 키보드 조작, #68 에디터 플레이테스트 무적 모드 + 결과 화면, #67 절대정확도, #66 무적 모드
- #65 Plum - Timeline: 잔상·음수 angleOffset·화면 전체 빛 번짐, #64/#63 AnimateTrack 기본값 무시
- #62/#61 장식 그림 화면 크기 기준 로딩·메모리 예산·카메라 장식 줌·입자 크기 (Phantigma 실제 그림)
- #60 MultiPlanet 3행성, #59 BIKE 검은 화면(가림막·산 장식·Sharpen), #58 Phantigma 확장 필터·배경 층 필터·NeonLight
- #57 대회 판정 규칙, #56 가시성(트랙 외곽선·행성 강조), #55 쉼표 빠진 .adofai, #54 .adofai 고르기
- #51~#52 보정 개편 (기기별 오프셋, 드럼 탭, 2단계 화면 맞추기), #48~#45 원작 16:9 화면 맞춤·회전·전체 화면
- #49~#50/#23 Hello (BPM) 2025 지원·녹화 비교, #44/#36 폰 WebGL 끊김·텍스처, #41 화질 자동 조절

**그 이전**: 기본 게임(궤도 회전·판정·타일), 레벨 에디터(방향 패드·타임라인·파형), 곡에서 자동 생성, 동영상→mp3 변환, 온라인(Firebase 로그인·업로드·순위·동기화).

**시험한 원작 레벨**: Hello (BPM) 2025/2026, Phantigma(AWC2026 결승 타이브레이커, 대회판·일반판), BIKE - Tanger, Plum - Timeline, R(원작 월드), Once Forgotten, Nothing Remains(AWC2026, 'ofnr', 13330타일, 10분 반, wav), Camellia - QuomodocunquizE(6450타일), 메가믹스(10분, 사용자가 잘 된다고 보고).

## 8. 현재 상황 / 남은 일 (2026-11 기준)

### 사용자 응답 대기
- **태블릿 프레임 측정**: #90 뒤 태블릿에서 설정 '프레임 표시'를 켜고 끊기는 장면의 숫자 캡처를 부탁함. 그리기 ms가 크면 → 다음 성능 단계(아래), 계산 ms가 크면 → 그 장면 프로파일링(`scripts/perf.mjs … prof`).
- **태블릿 탭 꺼짐 (ofnr)**: 메가믹스(10분, 압축 음원)는 되고 ofnr(10분 반, wav)는 #75 뒤에도 '불러오고 튕김'. 다시 열면 뜨는 진단 창('지난번에 ○○ 단계에서 멈췄어요') 캡처 대기.
- **보정 피드백**: 판정이 원작 기준(#70)으로 바뀌어 다시 보정해 보도록 안내함.
- QuomodocunquizE: 사용자의 원작 녹화·zip(그림 포함)을 받으면 더 대조. 지금은 .adofai만 받음.

### 성능 다음 단계 (#90에서 화질 그대로인 것만 함)
- 터치 기기 렌더 해상도(지금 기기 배율 최대 2)·안티앨리어싱 끄기 — 보이는 차이 작고 GPU 부담 크게 ↓.
- 자동 화질 조절이 **필터가 켜졌을 때만** 동작 (`stage.ts adaptQuality`) → 장식만 많은 장면도 낮추고, 빨라지면 다시 올리기.
- '시각 효과' 설정 (전체 / 최소: 필터·잔상·입자 끔 / 없음: 장식도 끔).
- 빛 번짐·흐림 절반 해상도, `useBackBuffer`는 섞기 모드 장식이 없는 레벨에서 끄기.
- WebGPU 렌더러 (`screenfx.ts`의 GLSL 셰이더 3개를 WGSL로도), 그리기를 Worker(OffscreenCanvas)로 — 큰 작업.
- 판정은 입력 이벤트 시각(`event.timeStamp`) 기준이라 프레임이 떨어져도 판정은 밀리지 않는다 — 성능 작업은 화면 부드러움 문제.

### 알려진 문제
- **타일 이동(MoveTrack) 중 공이 타일을 따라가는 시각적 오류** — 사용자가 보고. 공을 착지 위치에 고정하는 수정을 넣었다가 되돌림 (트랙 전체가 미끄러지는 연출은 원작도 공이 따라갈 수 있어 확신 없음). 어느 레벨·몇 초인지와 원작 녹화를 받아 비교한 뒤 고칠 것.
- 배경(BGA): Phantigma 29초 근처 회색 장면, 152초 카메라 줌/위치, 145초 만화 집중선 과함, 전체 채도가 원작보다 낮음. Plum - Timeline은 구름 위치(카메라 구도), 타일 반투명도.
- ofnr: 행성 색(원작 녹화는 흰색, 플레이어 설정일 수 있음). 3:18 무지개 고리는 플레이어 설정 효과로 보여 구현 안 함.
- QuomodocunquizE: 3:05 근처 회색은 맵의 11% 흰 번쩍임(의도된 것).

### 미구현 원작 기능
- 필터 SuperComputer(QuomodocunquizE에 한 번), Vision 계열 일부, 레거시 LightWater·OilPaint는 비슷한 효과로 대체(Waves·Posterize).
- SetHitsound 게임 소리, 홀드 소리, 조건 연출로 부른 PlaySound의 소리, MultiPlanet 4개 이상, FreeRoam.

### 긴 곡 메모리 (참고)
- 음원 없을 때 합성 비트: 킥·하이햇 파형 재사용, 5분 넘으면 16kHz → 불러오기 15초 → 1.4초.
- 음원 디코딩 `AudioEngine.decodeBytes(u8, 곡 길이)`: 디코딩 결과가 예산(폰 120MB / PC 400MB)을 넘으면 표본율을 낮춘다(최저 22.05kHz). WAV는 `src/audio/wav.ts`로 직접 읽음 (브라우저 디코더는 원래 표본율로 다 푼 뒤 줄여 중간 메모리가 1GB를 넘었다). 그 밖은 OfflineAudioContext(낮은 표본율).
- 꺼짐 진단 (`src/diag.ts`): 무거운 단계마다 `localStorage orbit.lastStep`에 기록하고 끝나면 지운다. `done(이름…)`은 그 단계일 때만 지운다 (미리듣기 디코딩이 플레이 단계 기록을 지우던 경쟁).
- 측정: `scripts/memory.mjs` (ofnr: 렌더러 최고 약 540MB, Pixel 7 흉내).

## 9. 클라우드 환경에서 겪은 것 (도구 메모)

- GitHub: `gh` CLI 없음 → GitHub MCP 도구(`mcp__github__*`) 사용. owner `XKV7`, repo `tester`. PR 만들기·스쿼시 머지·Actions 실행 목록 모두 이걸로 했다.
- `git push`로 **태그는 거절**됐다(프록시가 끊음) → 백업은 MCP `create_branch`로 브랜치를 만들었다.
- 네트워크: `adofai.fandom.com`, `cloud.adofai.gg`는 막혀 있었다 (환경 설정에서 허용 필요). GitHub·npm은 됨.
- 긴 `sleep`은 막힘 → 배포를 기다릴 땐 Actions 실행 상태를 다시 조회하거나 until-루프.
- 미리보기 서버는 `(nohup npx vite preview --port 4175 --strictPort > <로그> 2>&1 &)`로 띄운다. 컨테이너가 바뀌면 다시 띄워야 한다.
- 컨테이너에 GPU가 없어 그리기 시간·GPU 메모리는 잴 수 없다 → 실제 기기 측정은 사용자에게 '프레임 표시'·진단 창 캡처를 부탁한다.
- 시험용 임시 테스트 파일을 `tests/` 안에 두면 tsc가 깨진다 → 저장소 밖에 둔다.

## 10. 사용자에 대해

- 짧은 한국어로 요청한다 ("원작처럼 만들어줘", "나머지 고쳐줘"). 오타가 섞이기도 한다. 목표는 늘 **원작과 똑같이** — 원작 녹화와 대조한 근거를 보고에 넣으면 좋아한다.
- 원작 레벨(zip/.adofai)과 폰으로 찍은 원작 녹화·캡처를 보내 준다. PC와 태블릿에서 플레이한다.
- 머지·배포는 상시 허락. 큰 변경 전에는 백업을 남긴다.
