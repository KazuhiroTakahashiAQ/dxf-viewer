"""Generate sample DXF files for dxf-viewer.

The samples double as demo files (public/samples) and test fixtures. A
manifest with ezdxf-side expectations is written next to them. Note: agreement
with ezdxf only checks consistency between two implementations; behaviour of
real CAD software is verified separately (see docs/coverage.md).

Usage: uv run python generate.py [--perf]
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import ezdxf
from ezdxf import colors
from ezdxf.enums import TextEntityAlignment, MTextEntityAlignment
from ezdxf.math import Vec2, Vec3

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "samples"
PERF_OUT = ROOT / "tests" / "real" / ".cache" / "perf"

manifest: dict[str, dict] = {}


def setup_layers(doc):
    doc.layers.add("WALL", color=1, lineweight=50)
    doc.layers.add("DOOR", color=3, linetype="DASHED")
    doc.layers.add("TEXT", color=7)
    doc.layers.add("DIM", color=2, lineweight=18)
    doc.layers.add("HIDDEN_LAYER", color=5).off()
    frozen = doc.layers.add("FROZEN_LAYER", color=6)
    frozen.freeze()
    tc = doc.layers.add("TRUECOLOR", color=7)
    tc.rgb = (255, 128, 0)
    doc.layers.add("CENTER", color=4, linetype="CENTER")


def record(name: str, doc, extra: dict | None = None):
    msp = doc.modelspace()
    counts: dict[str, int] = {}
    for e in msp:
        counts[e.dxftype()] = counts.get(e.dxftype(), 0) + 1
    texts = sorted(
        {e.dxf.text for e in msp.query("TEXT")} | {e.text for e in msp.query("MTEXT")}
    )
    manifest[name] = {
        "version": doc.dxfversion,
        "encoding": doc.encoding,
        "modelspace": counts,
        "layers": sorted(layer.dxf.name for layer in doc.layers),
        "blocks": sorted(b.name for b in doc.blocks if not b.name.startswith("*")),
        "texts": texts,
        **(extra or {}),
    }


def basic_entities():
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4
    doc.header["$PDMODE"] = 35
    doc.header["$PDSIZE"] = 2
    setup_layers(doc)
    msp = doc.modelspace()

    # --- curves ---
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "WALL"})
    msp.add_line((0, 0), (0, 60), dxfattribs={"layer": "WALL", "lineweight": 100})
    msp.add_circle((20, 20), 8, dxfattribs={"color": 1})
    msp.add_arc((50, 20), 8, 30, 240, dxfattribs={"color": 3})
    msp.add_ellipse((80, 20), major_axis=(10, 4), ratio=0.4, start_param=0.3, end_param=4.5, dxfattribs={"color": 5})
    msp.add_ellipse((80, 45), major_axis=(0, 8), ratio=0.5, dxfattribs={"color": 6})
    # OCS: arc and circle with extrusion (0,0,-1) (mirrored)
    msp.add_arc((-20, 20), 6, 0, 90, dxfattribs={"extrusion": (0, 0, -1), "color": 2})
    msp.add_circle((-20, 40), 4, dxfattribs={"extrusion": (0, 0, -1), "color": 4})
    # polylines
    msp.add_lwpolyline(
        [(0, 70, 0, 0, 0.5), (20, 70, 0, 0, 0), (20, 80, 0, 0, -1), (0, 80)],
        format="xyseb",
        close=True,
        dxfattribs={"color": 2},
    )
    msp.add_lwpolyline([(30, 70), (40, 75), (50, 70)], dxfattribs={"const_width": 1.5, "color": 4})
    msp.add_lwpolyline([(60, 70, 0, 3), (80, 70, 3, 0)], format="xyse", dxfattribs={"color": 1})
    msp.add_polyline2d([(90, 70), (100, 75), (110, 70)], dxfattribs={"color": 3})
    msp.add_polyline3d([(0, 90, 0), (10, 95, 5), (20, 90, 10)], dxfattribs={"color": 5})
    # splines
    msp.add_spline_control_frame([(0, 110), (10, 120), (20, 105), (30, 118), (40, 110)], degree=3, dxfattribs={"color": 6})
    msp.add_spline([(50, 110), (60, 120), (70, 105), (80, 118)], dxfattribs={"color": 3})
    msp.add_rational_spline(
        [(90, 110), (90, 120), (100, 120)], weights=[1, math.sqrt(0.5), 1], degree=2, dxfattribs={"color": 1}
    )
    # points
    for i in range(3):
        msp.add_point((110 + i * 5, 0))
    # solids / faces
    msp.add_solid([(110, 20), (120, 20), (110, 30), (120, 30)], dxfattribs={"color": 4})
    msp.add_trace([(125, 20), (135, 20), (125, 25), (135, 25)], dxfattribs={"color": 5})
    msp.add_3dface([(110, 40, 0), (120, 40, 0), (120, 50, 5), (110, 50, 5)], dxfattribs={"color": 6})
    # infinite
    msp.add_xline((0, -10), (1, 0.2), dxfattribs={"color": 8})
    msp.add_ray((0, -20), (1, -0.1), dxfattribs={"color": 8})
    # true color + transparency
    line = msp.add_line((0, -30), (100, -30), dxfattribs={"layer": "TRUECOLOR"})
    line.rgb = (30, 200, 120)
    line.transparency = 0.5
    msp.add_line((0, -35), (100, -35), dxfattribs={"layer": "CENTER"})
    msp.add_line((0, -40), (100, -40), dxfattribs={"linetype": "DASHDOT", "ltscale": 0.5})
    msp.add_line((0, -45), (100, -45), dxfattribs={"layer": "HIDDEN_LAYER"})
    msp.add_line((0, -50), (100, -50), dxfattribs={"layer": "FROZEN_LAYER"})

    # --- texts ---
    y = 140
    for align in [
        TextEntityAlignment.LEFT,
        TextEntityAlignment.CENTER,
        TextEntityAlignment.RIGHT,
        TextEntityAlignment.MIDDLE_CENTER,
        TextEntityAlignment.TOP_RIGHT,
        TextEntityAlignment.BOTTOM_LEFT,
    ]:
        t = msp.add_text(f"Align {align.name}", height=2.5, dxfattribs={"layer": "TEXT"})
        t.set_placement((50, y), align=align)
        msp.add_circle((50, y), 0.5, dxfattribs={"color": 1})
        y += 6
    t = msp.add_text("ALIGNED text", height=2.5, dxfattribs={"layer": "TEXT"})
    t.set_placement((0, 180), (40, 190), align=TextEntityAlignment.ALIGNED)
    t = msp.add_text("FIT text", height=2.5, dxfattribs={"layer": "TEXT"})
    t.set_placement((50, 180), (90, 180), align=TextEntityAlignment.FIT)
    msp.add_text("Rotated 30° %%c50 %%p0.1 %%uunderline%%u", height=3, rotation=30, dxfattribs={"insert": (100, 140)})
    msp.add_text("Oblique + width", height=3, dxfattribs={"insert": (100, 160), "oblique": 15, "width": 0.7})
    msp.add_text("Backward", height=3, dxfattribs={"insert": (130, 170), "text_generation_flag": 2})
    msp.add_text("Upside down", height=3, dxfattribs={"insert": (130, 175), "text_generation_flag": 4})
    mt = msp.add_mtext(
        "{\\fArial|b1|i0;Bold Arial} plain \\Pline 2 {\\C1;red} {\\H2x;big} \\S1/2; \\S3^4; \\Lunder\\l \\Oover\\o \\Kstrike\\k",
        dxfattribs={"insert": (0, 210), "char_height": 2.5, "width": 60},
    )
    mt = msp.add_mtext(
        "Wrapped paragraph text that should wrap within the reference width of thirty units.",
        dxfattribs={"insert": (70, 210), "char_height": 2.0, "width": 30},
    )
    mt.set_location((70, 210), attachment_point=MTextEntityAlignment.TOP_CENTER)
    mt = msp.add_mtext("Background mask", dxfattribs={"insert": (0, 230), "char_height": 3})
    mt.set_bg_color(2, scale=1.5)
    mt = msp.add_mtext("Rotated MTEXT", dxfattribs={"insert": (110, 210), "char_height": 3, "rotation": 45})

    # --- blocks ---
    blk = doc.blocks.new("DOOR", base_point=(0, 0))
    blk.add_line((0, 0), (10, 0), dxfattribs={"layer": "0", "color": 0})
    blk.add_arc((0, 0), 10, 0, 90, dxfattribs={"layer": "0"})
    blk.add_line((0, 0), (0, 10), dxfattribs={"layer": "DOOR"})
    blk.add_attdef("TAG", (2, 2), dxfattribs={"height": 1.5, "prompt": "Door tag"})
    nested = doc.blocks.new("ROOM")
    nested.add_lwpolyline([(0, 0), (30, 0), (30, 20), (0, 20)], close=True, dxfattribs={"layer": "WALL"})
    nested.add_blockref("DOOR", (5, 0), dxfattribs={"layer": "0"})
    ins = msp.add_blockref("DOOR", (150, 0), dxfattribs={"layer": "DOOR", "color": 1})
    ins.add_auto_attribs({"TAG": "D-01"})
    msp.add_blockref("DOOR", (170, 0), dxfattribs={"xscale": 2, "yscale": 1, "rotation": 45, "color": 5})
    msp.add_blockref("DOOR", (200, 0), dxfattribs={"xscale": -1, "color": 3})  # mirrored
    msp.add_blockref("ROOM", (150, 40), dxfattribs={"layer": "WALL"})
    msp.add_blockref("ROOM", (190, 40), dxfattribs={"rotation": 90, "extrusion": (0, 0, -1)})
    mins = msp.add_blockref("DOOR", (150, 80), dxfattribs={"color": 4})
    mins.grid(size=(3, 4), spacing=(15, 15))

    # --- dimensions (with rendered geometry blocks) ---
    dim = msp.add_linear_dim(base=(0, -60), p1=(0, -70), p2=(50, -70), dxfattribs={"layer": "DIM"})
    dim.render()
    dim = msp.add_aligned_dim(p1=(60, -70), p2=(90, -55), distance=5, dxfattribs={"layer": "DIM"})
    dim.render()
    dim = msp.add_radius_dim(center=(110, -65), radius=8, angle=45, dxfattribs={"layer": "DIM"})
    dim.render()
    msp.add_circle((110, -65), 8)
    dim = msp.add_diameter_dim(center=(140, -65), radius=8, angle=30, dxfattribs={"layer": "DIM"})
    dim.render()
    msp.add_circle((140, -65), 8)
    dim = msp.add_angular_dim_cra(center=(170, -70), radius=12, start_angle=10, end_angle=80, distance=3, dxfattribs={"layer": "DIM"})
    dim.render()

    # --- hatches ---
    h = msp.add_hatch(color=1)
    h.paths.add_polyline_path([(0, 250), (20, 250), (20, 265), (0, 265)], is_closed=True)
    h = msp.add_hatch(color=3)
    h.set_pattern_fill("ANSI31", scale=0.5)
    h.paths.add_polyline_path([(30, 250), (55, 250), (55, 265), (30, 265)], is_closed=True)
    h.paths.add_polyline_path([(38, 254), (47, 254), (47, 261), (38, 261)], is_closed=True)
    h = msp.add_hatch()
    h.set_gradient((255, 0, 0), (0, 0, 255), rotation=30)
    edge = h.paths.add_edge_path()
    edge.add_line((60, 250), (85, 250))
    edge.add_arc((85, 257.5), 7.5, -90, 90)
    edge.add_line((85, 265), (60, 265))
    edge.add_line((60, 265), (60, 250))

    # --- leaders / mleader / mesh / misc ---
    msp.add_leader([(100, 250), (110, 260), (120, 260)], dimstyle="EZDXF", dxfattribs={"layer": "DIM"})
    ml = msp.add_multileader_mtext("Standard")
    ml.set_content("MLEADER text", char_height=2.5)
    ml.add_leader_line(ezdxf.render.mleader.ConnectionSide.left, [Vec2(130, 245)])
    ml.build(insert=Vec2(140, 255))
    mesh = msp.add_mesh(dxfattribs={"color": 6})
    with mesh.edit_data() as md:
        md.vertices = [(160, 250, 0), (170, 250, 0), (170, 260, 0), (160, 260, 0), (165, 255, 5)]
        md.faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    pf = msp.add_polyface(dxfattribs={"color": 5})
    pf.append_face([(180, 250, 0), (190, 250, 0), (190, 260, 0)])
    pf.append_face([(180, 250, 0), (190, 260, 0), (180, 260, 0)])
    pm = msp.add_polymesh((3, 3), dxfattribs={"color": 4})
    for i in range(3):
        for j in range(3):
            pm.set_mesh_vertex((i, j), (200 + i * 5, 250 + j * 5, (i * j) % 3))
    msp.add_wipeout([(100, 225), (115, 225), (115, 235), (100, 235)])
    msp.add_mline([(0, 290), (40, 290), (40, 310)])

    # XDATA
    doc.appids.new("DXFV_TEST")
    line = msp.add_line((0, 320), (30, 320))
    line.set_xdata("DXFV_TEST", [(1000, "hello"), (1040, 3.14), (1070, 42)])

    name = "basic_entities.dxf"
    doc.saveas(OUT / name)
    record(name, doc)


def japanese_sjis_r2000():
    """TFAS / Rebro style: R2000, ANSI_932, MS Gothic / MS Mincho TrueType styles."""
    doc = ezdxf.new("R2000")
    doc.header["$DWGCODEPAGE"] = "ANSI_932"
    doc.header["$INSUNITS"] = 4
    doc.styles.add("ＭＳ ゴシック", font="msgothic.ttc")
    doc.styles.add("ＭＳ 明朝", font="msmincho.ttc")
    doc.layers.add("壁", color=1)
    doc.layers.add("建具", color=3)
    doc.layers.add("寸法", color=2)
    doc.layers.add("文字", color=7)
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (6000, 0), (6000, 4000), (0, 4000)], close=True, dxfattribs={"layer": "壁"})
    msp.add_text("平面図　Ｓ＝１：１００", height=300, dxfattribs={"layer": "文字", "style": "ＭＳ ゴシック", "insert": (0, -600)})
    msp.add_text("会議室", height=250, dxfattribs={"layer": "文字", "style": "ＭＳ 明朝", "insert": (2500, 2000)})
    t = msp.add_text("中央揃え（全角ＡＢＣ）", height=200, dxfattribs={"layer": "文字", "style": "ＭＳ ゴシック"})
    t.set_placement((3000, 3500), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_mtext(
        "{\\fＭＳ ゴシック|b0|i0|c128|p49;複数行テキスト}\\P２行目：①②③　㎡　℃",
        dxfattribs={"layer": "文字", "insert": (200, 3800), "char_height": 200, "width": 3000},
    )
    dim = msp.add_linear_dim(base=(0, -300), p1=(0, 0), p2=(6000, 0), dxfattribs={"layer": "寸法"})
    dim.render()
    name = "japanese_sjis_r2000.dxf"
    doc.saveas(OUT / name, encoding="cp932")
    # ezdxf keeps ANSI_1252 in the header when forcing an encoding; declare it properly
    path = OUT / name
    data, n = re.subn(rb"(\$DWGCODEPAGE\r?\n  3\r?\n)ANSI_1252", rb"\1ANSI_932", path.read_bytes())
    assert n == 1
    path.write_bytes(data)
    record(name, doc)


def jwcad_like_r12():
    """Jw_cad style: R12, Shift_JIS, no $DWGCODEPAGE, bigfont.shx, no handles style."""
    doc = ezdxf.new("R12")
    doc.header["$DWGCODEPAGE"] = "ANSI_932"
    st = doc.styles.get("STANDARD")
    st.dxf.font = "txt"
    st.dxf.bigfont = "bigfont.shx"
    doc.layers.add("0-1", color=1)
    doc.layers.add("0-2", color=2)
    msp = doc.modelspace()
    for i in range(10):
        msp.add_line((i * 1000, 0), (i * 1000, 5000), dxfattribs={"layer": "0-1"})
    msp.add_circle((4500, 2500), 1200, dxfattribs={"layer": "0-2"})
    msp.add_arc((4500, 2500), 1500, 0, 180, dxfattribs={"layer": "0-2"})
    msp.add_text("Ｊｗ＿ｃａｄ風の文字列　寸法１２３４", height=250, dxfattribs={"insert": (0, 5300), "layer": "0-2", "width": 1.0})
    msp.add_text("半角ｶﾀｶﾅ と 全角カタカナ", height=250, dxfattribs={"insert": (0, 5800)})
    name = "jwcad_like_r12.dxf"
    doc.saveas(OUT / name, encoding="cp932")
    # Jw_cad does not write $DWGCODEPAGE: remove it to exercise detection
    path = OUT / name
    data = path.read_bytes()
    data, n = re.subn(rb"  9\r?\n\$DWGCODEPAGE\r?\n  3\r?\n[A-Z_0-9]+\r?\n", b"", data)
    assert n == 1, "DWGCODEPAGE not removed"
    path.write_bytes(data)
    record(name, doc, {"note": "$DWGCODEPAGE removed after saving"})


def autocad_like_shx():
    doc = ezdxf.new("R2013", setup=True)
    doc.header["$INSUNITS"] = 4
    doc.styles.add("JIS", font="romans.shx").dxf.bigfont = "extfont2.shx"
    doc.styles.add("SIMPLEX", font="simplex.shx")
    doc.styles.add("TXT", font="txt.shx").dxf.bigfont = "bigfont.shx"
    msp = doc.modelspace()
    msp.add_text("ROMANS + EXTFONT2 日本語", height=5, dxfattribs={"style": "JIS", "insert": (0, 0)})
    msp.add_text("SIMPLEX 0123456789", height=5, dxfattribs={"style": "SIMPLEX", "insert": (0, 10)})
    msp.add_text("TXT.SHX %%c25 %%d45", height=5, dxfattribs={"style": "TXT", "insert": (0, 20)})
    msp.add_mtext("MTEXT with \\fMS Gothic;ＭＳゴシック\\f;and {\\Fromand.shx;ROMAND}", dxfattribs={"insert": (0, 40), "char_height": 4, "width": 120, "style": "JIS"})
    name = "autocad_like_shx.dxf"
    doc.saveas(OUT / name)
    record(name, doc)


def revit_archicad_like():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    doc.styles.add("Arial_2.5mm", font="arial.ttf").set_extended_font_data(family="Arial")
    doc.styles.add("Arial Narrow", font="ARIALN.TTF").set_extended_font_data(family="Arial Narrow")
    doc.styles.add("Times", font="times.ttf").set_extended_font_data(family="Times New Roman", bold=True)
    msp = doc.modelspace()
    msp.add_text("Arial 2.5mm – Room 101", height=2.5, dxfattribs={"style": "Arial_2.5mm", "insert": (0, 0)})
    msp.add_text("Arial Narrow condensed", height=2.5, dxfattribs={"style": "Arial Narrow", "insert": (0, 5)})
    msp.add_text("Times New Roman Bold", height=2.5, dxfattribs={"style": "Times", "insert": (0, 10)})
    msp.add_mtext("Level 1\\PFFL +0.000", dxfattribs={"insert": (0, 20), "char_height": 2.5, "style": "Arial_2.5mm"})
    name = "revit_archicad_like.dxf"
    doc.saveas(OUT / name)
    record(name, doc)


def unicode_escapes():
    """R2000 with ANSI_1252: Japanese text can only be stored as \\U+ escapes."""
    doc = ezdxf.new("R2000")
    doc.header["$DWGCODEPAGE"] = "ANSI_1252"
    doc.layers.add("図面枠", color=3)
    msp = doc.modelspace()
    msp.add_text("Unicode 漢字 ÄÖÜ €", height=3, dxfattribs={"insert": (0, 0), "layer": "図面枠"})
    msp.add_mtext("MTEXT 東京\\P第二段落", dxfattribs={"insert": (0, 10), "char_height": 3})
    name = "unicode_escapes_r2000.dxf"
    doc.saveas(OUT / name)
    # add a raw MIF escape (\M+1XXXX is Shift_JIS) to the file
    path = OUT / name
    text = path.read_text("cp1252")
    text = text.replace("Unicode ", "MIF:\\M+18ABF Unicode ", 1)  # 0x8ABF = 漢 in Shift_JIS
    path.write_text(text, "cp1252")
    record(name, doc, {"note": "MIF escape \\M+18ABF inserted"})


def binary_dxf():
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 10), dxfattribs={"color": 1})
    msp.add_circle((5, 5), 3, dxfattribs={"color": 3})
    msp.add_text("Binary DXF", height=1, dxfattribs={"insert": (0, -2)})
    name = "binary.dxf"
    doc.saveas(OUT / name, fmt="bin")
    record(name, doc)


def large_offset():
    """Survey-like coordinates (~1e8) with small details to test precision."""
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    ox, oy = -123_456_789.0, 98_765_432.0
    for i in range(20):
        x = ox + i * 0.1
        msp.add_line((x, oy), (x, oy + 1), dxfattribs={"color": 1 + i % 6})
    msp.add_circle((ox + 1, oy + 0.5), 0.05, dxfattribs={"color": 2})
    msp.add_text("0.1 spacing at 1e8", height=0.05, dxfattribs={"insert": (ox, oy - 0.1)})
    msp.add_lwpolyline([(ox - 5, oy - 5), (ox + 7, oy - 5), (ox + 7, oy + 6), (ox - 5, oy + 6)], close=True)
    name = "large_offset.dxf"
    doc.saveas(OUT / name)
    record(name, doc, {"origin": [ox, oy]})


def minsert_bomb():
    """Nested MINSERT grids that expand to ~10^10 primitives (budget test)."""
    doc = ezdxf.new("R2018")
    b0 = doc.blocks.new("CELL")
    b0.add_line((0, 0), (1, 1))
    b0.add_circle((0.5, 0.5), 0.4)
    prev = "CELL"
    for level in range(1, 4):
        b = doc.blocks.new(f"GRID{level}")
        r = b.add_blockref(prev, (0, 0))
        r.grid(size=(40, 40), spacing=(2 * 40 ** (level - 1), 2 * 40 ** (level - 1)))
        prev = f"GRID{level}"
    msp = doc.modelspace()
    msp.add_blockref(prev, (0, 0))
    msp.add_text("Budget test: nested 40x40 MINSERTs", height=50, dxfattribs={"insert": (0, -100)})
    name = "minsert_budget.dxf"
    doc.saveas(OUT / name)
    record(name, doc)


def layouts():
    doc = ezdxf.new("R2018", setup=True)
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 60), (0, 60)], close=True, dxfattribs={"color": 1})
    msp.add_circle((50, 30), 20, dxfattribs={"color": 3, "layer": "VP_FROZEN"})
    msp.add_text("Model space", height=5, dxfattribs={"insert": (5, 5)})
    doc.layers.add("VP_FROZEN", color=3)
    psp = doc.layout("Layout1")
    psp.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units="mm")
    psp.add_viewport(center=(140, 150), size=(200, 150), view_center_point=(50, 30), view_height=80)
    vp = psp.add_viewport(center=(320, 150), size=(120, 120), view_center_point=(50, 30), view_height=40)
    vp.frozen_layers = ["VP_FROZEN"]
    psp.add_text("Paper space title", height=8, dxfattribs={"insert": (20, 260)})
    doc.layouts.new("Layout2").add_text("Second layout", height=10, dxfattribs={"insert": (20, 20)})
    name = "layouts.dxf"
    doc.saveas(OUT / name)
    record(name, doc, {"layouts": [l.name for l in doc.layouts]})


def perf(n: int = 500_000):
    PERF_OUT.mkdir(parents=True, exist_ok=True)
    doc = ezdxf.new("R2018")
    for i in range(20):
        doc.layers.add(f"L{i}", color=1 + i % 7)
    msp = doc.modelspace()
    side = int(math.sqrt(n / 4))
    k = 0
    for i in range(side):
        for j in range(side):
            x, y = i * 10.0, j * 10.0
            layer = f"L{(i + j) % 20}"
            msp.add_line((x, y), (x + 8, y), dxfattribs={"layer": layer})
            msp.add_circle((x + 4, y + 4), 3, dxfattribs={"layer": layer})
            msp.add_lwpolyline([(x, y + 1), (x + 3, y + 7), (x + 7, y + 2)], dxfattribs={"layer": layer})
            if (i * side + j) % 4 == 0:
                msp.add_text(f"T{i}-{j}", height=1, dxfattribs={"insert": (x, y + 8), "layer": layer})
            else:
                msp.add_arc((x + 4, y + 4), 2, 0, 180, dxfattribs={"layer": layer})
            k += 4
    doc.saveas(PERF_OUT / f"perf_{k}.dxf")
    print(f"perf file with {k} entities")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    basic_entities()
    japanese_sjis_r2000()
    jwcad_like_r12()
    autocad_like_shx()
    revit_archicad_like()
    unicode_escapes()
    binary_dxf()
    large_offset()
    minsert_bomb()
    layouts()
    (ROOT / "tests" / "fixtures").mkdir(parents=True, exist_ok=True)
    (ROOT / "tests" / "fixtures" / "samples-manifest.json").write_text(
        json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    index = [{"file": k, "version": v["version"]} for k, v in manifest.items()]
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    if "--perf" in sys.argv:
        perf()
    print(f"wrote {len(manifest)} samples to {OUT}")


if __name__ == "__main__":
    main()
