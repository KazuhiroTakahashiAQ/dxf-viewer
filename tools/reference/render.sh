#!/bin/sh
# Reference renderings for visual comparison (macOS):
#   ezdxf drawing add-on  → OUT/<name>.ezdxf.png
#   LibreCAD dxf2pdf      → OUT/<name>.librecad.png (PDF converted with sips)
#   this viewer (Chrome)  → OUT/<name>.viewer.png  (dev server must run on :5173)
# and an index.html that shows them side by side.
#
#   sh tools/reference/render.sh public/samples/*.dxf
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/tools/reference/out"
LIBRECAD=${LIBRECAD:-/Applications/LibreCAD.app/Contents/MacOS/LibreCAD}
mkdir -p "$OUT"
uv run --project "$ROOT/tools/samples" python "$ROOT/tools/reference/render_ezdxf.py" "$OUT" "$@"
for f in "$@"; do
  name=$(basename "$f" .dxf)
  if [ -x "$LIBRECAD" ]; then
    "$LIBRECAD" dxf2pdf -a -m -p 420x297 -o "$OUT/$name.librecad.pdf" "$f" >/dev/null 2>&1 || echo "LibreCAD failed: $f"
    [ -f "$OUT/$name.librecad.pdf" ] && sips -s format png -Z 1400 "$OUT/$name.librecad.pdf" --out "$OUT/$name.librecad.png" >/dev/null 2>&1 || true
  fi
  node "$ROOT/tools/e2e/shot.ts" --file "$f" --out "$OUT/$name.viewer.png" --keys "Control+Shift+F,f" --wait 2500 >/dev/null 2>&1 || echo "viewer shot failed: $f"
done
uv run --project "$ROOT/tools/samples" python "$ROOT/tools/reference/montage.py" "$OUT" $(for f in "$@"; do basename "$f" .dxf; done) >/dev/null
{
  echo '<!doctype html><meta charset="utf-8"><title>Reference comparison</title>'
  echo '<style>body{font:13px system-ui;margin:12px;background:#222;color:#ddd}figure{margin:0}img{width:100%;background:#fff}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:24px}</style>'
  for f in "$@"; do
    name=$(basename "$f" .dxf)
    echo "<h3>$name</h3><div class=row>"
    for k in viewer ezdxf librecad; do echo "<figure><figcaption>$k</figcaption><img src=\"$name.$k.png\" alt=\"\"></figure>"; done
    echo "</div>"
  done
} > "$OUT/index.html"
echo "open $OUT/index.html"
