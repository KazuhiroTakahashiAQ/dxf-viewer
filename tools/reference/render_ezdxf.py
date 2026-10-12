"""Render DXF files with ezdxf's drawing add-on (matplotlib) as an independent reference.

uv run --project tools/samples python tools/reference/render_ezdxf.py OUT_DIR FILE.dxf [...]
"""

import sys
from pathlib import Path

import ezdxf
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext
from ezdxf.addons.drawing.config import Configuration
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend


def render(path: Path, out_dir: Path) -> None:
    try:
        doc, _auditor = recover.readfile(path)
    except Exception as e:  # noqa: BLE001
        print(f"FAILED {path.name}: {e}")
        return
    layouts = [("Model", doc.modelspace())] + [(l.name, l) for l in doc.layouts if l.name != "Model"][:1]
    for name, layout in layouts:
        fig = plt.figure(figsize=(12, 9), dpi=100)
        ax = fig.add_axes([0, 0, 1, 1])
        ctx = RenderContext(doc)
        try:
            Frontend(ctx, MatplotlibBackend(ax), config=Configuration()).draw_layout(layout, finalize=True)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED {path.name} [{name}]: {e}")
            plt.close(fig)
            continue
        suffix = "" if name == "Model" else f".{name}"
        fig.savefig(out_dir / f"{path.stem}{suffix}.ezdxf.png", facecolor=ax.get_facecolor())
        plt.close(fig)
        print(f"ok {path.name} [{name}]")


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for f in sys.argv[2:]:
        render(Path(f), out)
