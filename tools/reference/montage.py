"""Combine <name>.viewer.png, <name>.ezdxf.png and <name>.librecad.png side by side.

uv run --project tools/samples python tools/reference/montage.py tools/reference/out NAME [...]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

W = 640


def load(p: Path) -> Image.Image:
    if not p.exists():
        im = Image.new("RGB", (W, 480), (90, 90, 90))
        ImageDraw.Draw(im).text((10, 10), f"missing: {p.name}", fill=(255, 255, 255))
        return im
    im = Image.open(p)
    if im.mode in ("RGBA", "LA", "P"):
        # PDFs converted by sips keep a transparent page: put it on white paper
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert("RGB")
    return im.resize((W, max(1, round(im.height * W / im.width))))


out = Path(sys.argv[1])
for name in sys.argv[2:]:
    ims = [load(out / f"{name}.{k}.png") for k in ("viewer", "ezdxf", "librecad")]
    h = max(i.height for i in ims) + 20
    canvas = Image.new("RGB", (W * 3 + 16, h), (40, 40, 40))
    d = ImageDraw.Draw(canvas)
    for k, (label, im) in enumerate(zip(("viewer", "ezdxf", "LibreCAD"), ims)):
        canvas.paste(im, (k * (W + 8), 20))
        d.text((k * (W + 8) + 4, 4), f"{name} — {label}", fill=(255, 255, 255))
    canvas.save(out / f"{name}.compare.png")
    print("ok", name)
