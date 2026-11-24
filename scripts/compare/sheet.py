# sheet.py orig|orbit|pair  ... make grid images
import sys, os, glob, bisect
from PIL import Image, ImageDraw
S = os.environ['CMP_DIR']  # 저장소 밖 작업 폴더 (levels/, rec/)
def load(d, pre):
    fs = sorted(glob.glob(f'{S}/rec/{d}/{pre}_*.jpg'))
    ts = [float(os.path.basename(f)[2:-4].replace('00-','-').lstrip('0') or 0) for f in fs]
    z = sorted(zip(ts, fs)); return [a for a,b in z], [b for a,b in z]
def near(ts, fs, t):
    i = bisect.bisect_left(ts, t); i = min(max(i,0), len(ts)-1)
    if i>0 and abs(ts[i-1]-t) < abs(ts[i]-t): i -= 1
    return fs[i], ts[i]
mode, out = sys.argv[1], sys.argv[2]
W, H = 480, 270
if mode == 'one':  # one dir, times
    d, pre = sys.argv[3], sys.argv[4]; times = [float(x) for x in sys.argv[5:]]
    ts, fs = load(d, pre); cols = 4; rows = (len(times)+cols-1)//cols
    im = Image.new('RGB', (W*cols, H*rows))
    for k,t in enumerate(times):
        f, tt = near(ts, fs, t); x = Image.open(f).resize((W,H))
        ImageDraw.Draw(x).text((5,5), f'{tt:.2f}', fill=(255,0,0)); im.paste(x, ((k%cols)*W, (k//cols)*H))
    im.save(out)
else:  # pair: origdir offset orbitdir times  -> rows: orig | orbit
    od, off, bd = sys.argv[3], float(sys.argv[4]), sys.argv[5]; times = [float(x) for x in sys.argv[6:]]
    ot, of = load(od, 'f'); bt, bf = load(bd, 'o')
    im = Image.new('RGB', (W*2, H*len(times)))
    for k,t in enumerate(times):
        f1, t1 = near(ot, of, t+off); f2, t2 = near(bt, bf, t)
        a = Image.open(f1).resize((W,H)); b = Image.open(f2).resize((W,H))
        ImageDraw.Draw(a).text((5,5), f'orig {t:.2f}', fill=(255,0,0)); ImageDraw.Draw(b).text((5,5), f'orbit {t2:.2f}', fill=(255,0,0))
        im.paste(a, (0, H*k)); im.paste(b, (W, H*k))
    im.save(out)
