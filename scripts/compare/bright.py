import sys, glob, os
from PIL import Image, ImageStat
d, pre, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
for f in sorted(glob.glob(f'{d}/{pre}_*.jpg')):
    s = os.path.basename(f)[2:-4].replace('00-','-'); t = float(s)
    if a <= t <= b:
        im = Image.open(f).convert('L').crop((100, 150, 700, 450))
        print(f'{t:.3f} {ImageStat.Stat(im).mean[0]:.0f}')
