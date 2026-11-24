# 시험 레벨 만들기: mklevel.py <name>  (레벨 정의는 아래 LEVELS)
import sys, json, os, shutil
S = os.environ['CMP_DIR']  # 저장소 밖 작업 폴더 (levels/, rec/)
def ev(floor, t, **k): return {"floor": floor, "eventType": t, **k}
def ct(f, style, col="4c74ff", typ="Single", col2="ffffff"):
    return ev(f, "ColorTrack", trackColorType=typ, trackColor=col, secondaryTrackColor=col2, trackColorAnimDuration=2, trackColorPulse="None", trackPulseLength=10, trackStyle=style, angleOffset=0, eventTag="")
def at(f, a, ahead, d, behind):
    return ev(f, "AnimateTrack", trackAnimation=a, beatsAhead=ahead, trackDisappearAnimation=d, beatsBehind=behind, angleOffset=0, eventTag="")
def cam(f, rel, pos, rot, zoom, dur, ease="Linear"):
    return ev(f, "MoveCamera", duration=dur, relativeTo=rel, position=pos, rotation=rot, zoom=zoom, angleOffset=0, ease=ease, eventTag="")
def settings(**k):
    s = {"version": 15, "artist": "t", "song": "t", "author": "t", "songFilename": "", "bpm": 100, "volume": 100, "offset": 0, "pitch": 100, "hitsound": "Kick", "hitsoundVolume": 100, "countdownTicks": 4,
     "trackColorType": "Single", "trackColor": "debb7b", "secondaryTrackColor": "ffffff", "trackColorAnimDuration": 2, "trackColorPulse": "None", "trackPulseLength": 10, "trackStyle": "Standard",
     "trackAnimation": "None", "beatsAhead": 3, "trackDisappearAnimation": "None", "beatsBehind": 4,
     "backgroundColor": "000000", "showDefaultBGIfNoImage": "Disabled", "bgImage": "", "bgImageColor": "ffffff", "parallax": [100,100], "bgDisplayMode": "FitToScreen", "lockRot": "Disabled", "loopBG": "Disabled", "unscaledSize": 100,
     "relativeTo": "Player", "position": [0,0], "rotation": 0, "zoom": 100, "bgVideo": "", "loopVideo": "Disabled", "vidOffset": 0, "floorIconOutlines": "Disabled", "stickToFloors": "Enabled", "planetEase": "Linear", "planetEaseParts": 1, "legacyFlash": False}
    s.update(k); return s
def zig(n): return [0 if i % 2 == 0 else 90 for i in range(n)]
LEVELS = {}
# 시스템 1: 기본 구도 + 트랙 스타일/색 방식 (구간 8타일, 100BPM 곧은길=0.6초)
p = [0]*12 + zig(12) + [0]*8*10
LEVELS['sys1'] = (p, [ct(24, "Neon"), ct(32, "NeonLight"), ct(40, "Basic"), ct(48, "Minimal"), ct(56, "Standard", "4c74ff", "Glow", "ff4060"),
   ct(64, "Standard", "4c74ff", "Blink", "ff4060"), ct(72, "Standard", "4c74ff", "Switch", "ff4060"), ct(80, "Standard", "4c74ff", "Rainbow"), ct(88, "Standard", "4c74ff80"), ct(96, "Neon", "4c74ff80")], {})
# 시스템 2: 트랙 애니메이션 (구간 12타일)
anims = [("Fade","Fade"),("Extend","Shrink"),("Grow","Shrink_Spin"),("Grow_Spin","Retract"),("Assemble","Scatter"),("Assemble_Far","Scatter_Far"),("Rise","Fade"),("Drop","Fade")]
LEVELS['sys2'] = ([0]*6 + [0, 45]*((12*len(anims))//2) + [0]*8, [at(6+12*i, a, 3, d, 2) for i, (a, d) in enumerate(anims)], {})
# 시스템 3: 카메라 (구간 10타일)
LEVELS['sys3'] = (zig(100), [cam(10, "Player", [0,0], 0, 200, 0), cam(20, "Player", [2,1], 0, 100, 4, "InOutSine"), cam(30, "Tile", [0,0], 45, 100, 4, "Linear"),
   cam(40, "Global", [0,0], 0, 150, 0), cam(50, "Player", [0,0], 0, 50, 8, "OutExpo"), cam(60, "LastPosition", [3,0], 0, None, 2), cam(70, "Player", [0,0], 0, 100, 0)], {})
anims2 = [("Fade","Fade"),("Extend","Shrink"),("Grow","Shrink_Spin"),("Grow_Spin","Retract"),("Assemble","Scatter"),("Assemble_Far","Scatter_Far"),("Rise","Fade"),("Drop","Fade")]
LEVELS['sys2b'] = ([0]*(4 + 10*len(anims2) + 6), [cam(0, "Player", [3, 2.5], 0, 100, 0)] + [at(4+10*i, a, 3, d, 2) for i, (a, d) in enumerate(anims2)], {"bpm": 120, "relativeTo": "Player", "position": [3, 2.5]})
name = sys.argv[1]
p, acts, extra = LEVELS[name]
d = f'{S}/levels/{name}'; os.makedirs(d, exist_ok=True)
acts = [{k: v for k, v in a.items() if v is not None} for a in acts]
json.dump({"angleData": p, "settings": settings(**extra), "actions": acts, "decorations": []}, open(f'{d}/main.adofai', 'w', encoding='utf-8'), indent=1)
shutil.make_archive(f'{S}/levels/{name}', 'zip', d)
print(name, len(p), 'tiles')
