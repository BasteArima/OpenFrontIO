"""BasteFront branding: pixel-art logo, favicon, background mark, PWA icons.

Usage: python scripts/selfhost/make_brand.py <out_dir>; copy the results to
resources/images (logo, favicon, BF.png) and resources/icons (bf512_*).

All shapes are drawn on integer pixel grids and emitted as crisp SVG rects
(and PNGs rendered from the same grids), matching the game's pixel style.
"""
import os
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

BLUE = "#0084d1"
BLUE_DARK = "#005a92"
ORANGE = "#ff8a1f"
ORANGE_DARK = "#b85a08"
WHITE = "#ffffff"
NAVY = "#0b1726"

# 5x7 pixel font, only the letters we need.
FONT = {
    "B": ["1111.", "1...1", "1...1", "1111.", "1...1", "1...1", "1111."],
    "A": [".111.", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
    "S": [".1111", "1....", "1....", ".111.", "....1", "....1", "1111."],
    "T": ["11111", "..1..", "..1..", "..1..", "..1..", "..1..", "..1.."],
    "E": ["11111", "1....", "1....", "1111.", "1....", "1....", "11111"],
    "F": ["11111", "1....", "1....", "1111.", "1....", "1....", "1...."],
    "R": ["1111.", "1...1", "1...1", "1111.", "1.1..", "1..1.", "1...1"],
    "O": [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
    "N": ["1...1", "11..1", "1.1.1", "1..11", "1...1", "1...1", "1...1"],
}
# Chevron mark, like the original's ">" but drawn as a stepped arrow.
CHEVRON = ["1....", "11...", ".11..", "..11.", ".11..", "11...", "1...."]


def text_cells(word, gap=1):
    cells = []
    x = 0
    for ch in word:
        g = FONT[ch]
        for y, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == "1":
                    cells.append((x + dx, y))
        x += len(g[0]) + gap
    return cells, x - gap


def rects_svg(cells, scale, color, ox=0, oy=0):
    return "".join(
        f'<rect x="{ox + x * scale}" y="{oy + y * scale}" width="{scale}" height="{scale}" fill="{color}"/>'
        for x, y in cells
    )


# ---------------------------------------------------------------- nav logo
# Keeps the original's 1364x259 box so the nav's aspect class still fits.
def nav_logo():
    chevron = [(x, y) for y, r in enumerate(CHEVRON) for x, c in enumerate(r) if c == "1"]
    baste, wb = text_cells("BASTE")
    front, wf = text_cells("FRONT")
    total = 5 + 2 + wb + 2 + wf  # cells
    S = (1364 - 24) // (total + 1)  # cell size, room for the drop shadow
    width_px = total * S
    ox = (1364 - width_px) // 2
    oy = (259 - 8 * S) // 2
    parts = []
    shift = lambda cs, dx: [(x + dx, y) for x, y in cs]
    groups = [
        (chevron, 0, BLUE, BLUE_DARK),
        (baste, 7, ORANGE, ORANGE_DARK),
        (front, 7 + wb + 2, BLUE, BLUE_DARK),
    ]
    for cells, dx, color, dark in groups:  # shadows first
        parts.append(rects_svg(shift(cells, dx), S, dark, ox + S // 3, oy + S // 3))
    for cells, dx, color, dark in groups:
        parts.append(rects_svg(shift(cells, dx), S, color, ox, oy))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1364 259" '
        'shape-rendering="crispEdges">' + "".join(parts) + "</svg>\n"
    )
    open(os.path.join(OUT, "BasteFrontLogo.svg"), "w").write(svg)


# ------------------------------------------------------- parachute emblem
# 16x16 grid: striped canopy, lines, a paratrooper.
PARACHUTE = [
    "................",
    ".....oobboo.....",
    "...oobbooobbo...",
    "..obbooobbbooo..",
    ".oobbooobbbooob.",
    ".obbooobbbbooob.",
    "obbooobbbbooobbo",
    "l..l...ll...l..l",
    ".l..l..ll..l..l.",
    "..l..l.ll.l..l..",
    "...l..lwwl..l...",
    "....l.lwwl.l....",
    ".....lwwwwl.....",
    "......w..w......",
    "......w..w......",
    "................",
]
PALETTE = {"o": ORANGE, "b": BLUE, "l": "#cfd8e3", "w": WHITE}


def emblem_cells():
    return [(x, y, PALETTE[c]) for y, row in enumerate(PARACHUTE) for x, c in enumerate(row) if c in PALETTE]


def favicon():
    rects = "".join(
        f'<rect x="{x}" y="{y}" width="1" height="1" fill="{c}"/>' for x, y, c in emblem_cells()
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'
        + rects + "</svg>\n"
    )
    open(os.path.join(OUT, "BasteFrontFavicon.svg"), "w").write(svg)


def png_icon(size, rounded, pad):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=NAVY)
    else:
        d.rectangle([0, 0, size, size], fill=NAVY)  # maskable: full bleed
    cell = (size - 2 * pad) // 16
    off = (size - cell * 16) // 2
    for x, y, c in emblem_cells():
        d.rectangle([off + x * cell, off + y * cell, off + (x + 1) * cell - 1, off + (y + 1) * cell - 1], fill=c)
    return img


# ------------------------------------------------- background mark (>BF)
def background_mark():
    chevron = [(x, y) for y, r in enumerate(CHEVRON) for x, c in enumerate(r) if c == "1"]
    bf, w = text_cells("BF")
    W, H = 517, 298
    total = 5 + 2 + w
    S = (W - 20) // (total + 1)
    ox = (W - total * S) // 2
    oy = (H - 8 * S) // 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    groups = [(chevron, 0, BLUE, BLUE_DARK), ([(x + 7, y) for x, y in bf], 0, BLUE, BLUE_DARK)]
    for shadow in (True, False):
        for cells, dx, color, dark in groups:
            for x, y in cells:
                px = ox + (x + dx) * S + (S // 4 if shadow else 0)
                py = oy + y * S + (S // 4 if shadow else 0)
                d.rectangle([px, py, px + S - 1, py + S - 1], fill=dark if shadow else color)
    img.save(os.path.join(OUT, "BF.png"))


nav_logo()
favicon()
png_icon(512, True, 72).save(os.path.join(OUT, "bf512_rounded.png"))
png_icon(512, False, 110).save(os.path.join(OUT, "bf512_maskable.png"))
background_mark()
print("ok")
