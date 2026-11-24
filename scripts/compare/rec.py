import sys, time, os, mss
from PIL import Image
out, dur = sys.argv[1], float(sys.argv[2]); fps = float(sys.argv[3]) if len(sys.argv) > 3 else 12
os.makedirs(out, exist_ok=True)
t0 = time.perf_counter(); n = 0
with mss.mss() as s:
    mon = s.monitors[1]
    while True:
        t = time.perf_counter() - t0
        if t > dur: break
        g = s.grab(mon)
        im = Image.frombytes('RGB', g.size, g.bgra, 'raw', 'BGRX').resize((960, 540), Image.BILINEAR)
        im.save(f'{out}/f_{t:08.3f}.jpg', quality=85); n += 1
        nxt = t0 + n / fps
        d = nxt - time.perf_counter()
        if d > 0: time.sleep(d)
print('frames', n)
