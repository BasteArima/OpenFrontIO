"""Generate BasteFront's free cosmetics catalog.

Usage: python scripts/selfhost/make_cosmetics.py .   (from the repo root)
Then run prettier on resources/lang/*.json if it reformats anything.

Writes resources/cosmetics/cosmetics.json, resources/cosmetics/flags/*.svg and
the en/ru names. Patterns use the engine's bitmap format (PatternDecoder.ts):
[version=0][b1: scale | (w-2)<<3][b2: (w-2)>>5 | (h-2)<<2] then 1 bit per cell,
row-major, LSB first; 0 = territory color, 1 = second color.
"""
import base64
import json
import math
import os
import random
import sys

REPO = sys.argv[1]
OUT_DIR = os.path.join(REPO, "resources", "cosmetics")
os.makedirs(os.path.join(OUT_DIR, "flags"), exist_ok=True)


def encode(width, height, scale, bit):
    assert 2 <= width <= 129 and 2 <= height <= 65 and 0 <= scale <= 7
    assert width * height <= 8192, "renderer keeps 1024 bytes per player"
    w2 = width - 2
    h2 = height - 2
    data = bytearray([0, (scale & 7) | ((w2 & 0x1F) << 3), ((w2 >> 5) & 3) | (h2 << 2)])
    bits = bytearray((width * height + 7) // 8)
    for y in range(height):
        for x in range(width):
            if bit(x, y):
                i = y * width + x
                bits[i >> 3] |= 1 << (i & 7)
    out = base64.urlsafe_b64encode(bytes(data + bits)).decode().rstrip("=")
    assert len(out) <= 1403
    return out


def from_rows(rows):
    h = len(rows)
    w = len(rows[0])
    return w, h, lambda x, y: rows[y][x] == "#"


# ------------------------------------------------------------------ patterns
P = {}  # name -> (width, height, scale, bitfn, palettes, en, ru)

PAL = {
    "ember": ("#7a1f12", "#ff8a1f", "Ember", "Угли"),
    "ocean": ("#0d3b66", "#4fc3f7", "Ocean", "Океан"),
    "forest": ("#1f4d2b", "#8bc34a", "Forest", "Лес"),
    "royal": ("#3b1f5c", "#f5c542", "Royal", "Королевская"),
    "arctic": ("#dfe9f2", "#5b8fb9", "Arctic", "Арктика"),
    "desert": ("#c9a66b", "#7a4e1d", "Desert", "Пустыня"),
    "neon": ("#111827", "#22ff88", "Neon", "Неон"),
    "candy": ("#ff9ecf", "#ffffff", "Candy", "Конфета"),
    "volcano": ("#2b2b2b", "#ff3d00", "Volcano", "Вулкан"),
    "bastefront": ("#0084d1", "#ff8a1f", "BasteFront", "BasteFront"),
    "graphite": ("#e5e5e5", "#3a3a3a", "Graphite", "Графит"),
    "toxic": ("#2e3b12", "#c6ff00", "Toxic", "Токсик"),
    "sakura": ("#ffd6e0", "#d6336c", "Sakura", "Сакура"),
    "midnight": ("#0b1020", "#8ea2ff", "Midnight", "Полночь"),
    "gold": ("#4a3600", "#ffd54a", "Gold", "Золото"),
}


def pattern(name, w, h, scale, bit, palettes, en, ru):
    P[name] = (w, h, scale, bit, palettes, en, ru)


pattern("diag_stripes", 8, 8, 1, lambda x, y: (x + y) % 8 < 2,
        ["bastefront", "volcano", "gold", "ocean", "candy"], "Diagonal Stripes", "Диагональ")
pattern("pinstripes", 6, 2, 1, lambda x, y: x % 6 == 0,
        ["graphite", "midnight", "royal", "forest", "desert"], "Pinstripes", "Тонкая полоска")
pattern("bands", 2, 10, 1, lambda x, y: y % 10 < 3,
        ["ocean", "ember", "sakura", "toxic", "bastefront"], "Bands", "Широкие полосы")
pattern("checker", 8, 8, 1, lambda x, y: ((x // 4) + (y // 4)) % 2 == 1,
        ["graphite", "volcano", "candy", "neon", "arctic"], "Checkerboard", "Шахматка")
pattern("polka", 8, 8, 1, lambda x, y: (x % 8 - 3.5) ** 2 + (y % 8 - 3.5) ** 2 <= 3.2,
        ["candy", "sakura", "midnight", "gold", "ocean"], "Polka Dots", "Горошек")
pattern("grid", 10, 10, 1, lambda x, y: x % 10 == 0 or y % 10 == 0,
        ["neon", "midnight", "arctic", "graphite", "toxic"], "Grid", "Сетка")
pattern("bricks", 12, 6, 1,
        lambda x, y: y % 3 == 0 or (x % 12 == (0 if (y // 3) % 2 == 0 else 6)),
        ["desert", "ember", "graphite", "volcano", "arctic"], "Bricks", "Кирпичи")


pattern("waves", 24, 16, 1, lambda x, y: abs(y % 8 - (4 + 2.6 * math.sin(2 * math.pi * x / 24))) < 0.9,
        ["ocean", "arctic", "midnight", "candy", "toxic"], "Waves", "Волны")
pattern("zigzag", 12, 8, 1, lambda x, y: (y % 8) in (abs((x % 12) - 6) // 2 + 1, abs((x % 12) - 6) // 2 + 2),
        ["royal", "gold", "volcano", "neon", "sakura"], "Zigzag", "Зигзаг")


def argyle(x, y):
    u = abs((x % 16) - 8)
    v = abs((y % 16) - 8)
    return u + v == 8 or u + v == 7


pattern("argyle", 16, 16, 1, argyle,
        ["royal", "forest", "graphite", "sakura", "gold"], "Argyle", "Ромбы")


HEX = from_rows([
    "...######...",
    "..#......#..",
    ".#........#.",
    "#..........#",
    ".#........#.",
    "..#......#..",
    "...######...",
    "..#......#..",
    ".#........#.",
    "#..........#",
    ".#........#.",
    "..#......#..",
])
honeycomb = HEX[2]


pattern("honeycomb", HEX[0], HEX[1], 1, honeycomb,
        ["gold", "toxic", "midnight", "desert", "bastefront"], "Honeycomb", "Соты")


def camo_bits(w, h, seed, fill):
    rnd = random.Random(seed)
    field = [[rnd.random() for _ in range(w)] for _ in range(h)]
    for _ in range(4):  # blur with wraparound -> blobs
        field = [[sum(field[(y + dy) % h][(x + dx) % w] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
                  for x in range(w)] for y in range(h)]
    flat = sorted(v for row in field for v in row)
    threshold = flat[int(len(flat) * (1 - fill))]
    return lambda x, y: field[y % h][x % w] >= threshold


pattern("camo", 32, 32, 2, camo_bits(32, 32, 7, 0.42),
        ["forest", "desert", "arctic", "graphite", "volcano"], "Camo", "Камуфляж")
pattern("speckle", 24, 24, 1, (lambda r: lambda x, y: r[(y % 24) * 24 + x % 24])(
    [random.Random(11 + i).random() < 0.12 for i in range(576)]),
        ["graphite", "arctic", "desert", "midnight", "candy"], "Speckle", "Крапинка")
pattern("plaid", 16, 16, 1,
        lambda x, y: (x % 16 in (0, 1, 6)) or (y % 16 in (0, 1, 6)),
        ["ember", "forest", "royal", "ocean", "graphite"], "Plaid", "Клетка")


def rings(x, y):
    d = math.hypot((x % 16) - 7.5, (y % 16) - 7.5)
    return 5.2 <= d <= 6.6 or d <= 1.6


pattern("rings", 16, 16, 1, rings,
        ["arctic", "neon", "sakura", "gold", "ocean"], "Rings", "Кольца")

SKULL = from_rows([
    "............",
    "...######...",
    "..########..",
    ".##..##..##.",
    ".##..##..##.",
    ".##########.",
    "..###..###..",
    "...######...",
    "...#.##.#...",
    "............",
    "............",
    "............",
])
pattern("skulls", SKULL[0], SKULL[1], 1, SKULL[2],
        ["graphite", "volcano", "toxic", "midnight", "candy"], "Skulls", "Черепа")

HEART = from_rows([
    "..........",
    "..##..##..",
    ".########.",
    ".########.",
    "..######..",
    "...####...",
    "....##....",
    "..........",
])
pattern("hearts", HEART[0], HEART[1], 1, HEART[2],
        ["candy", "sakura", "ember", "royal", "arctic"], "Hearts", "Сердечки")

CHUTE = from_rows([
    "............",
    "....####....",
    "..########..",
    ".##########.",
    ".#.#.##.#.#.",
    "..#..##..#..",
    "...#.##.#...",
    "....####....",
    ".....##.....",
    ".....##.....",
    "............",
    "............",
])
pattern("parachutes", CHUTE[0], CHUTE[1], 1, CHUTE[2],
        ["bastefront", "ocean", "arctic", "gold", "neon"], "Paratroopers", "Десант")

STAR = from_rows([
    "..............",
    "......#.......",
    "......#.......",
    ".....###......",
    "#############.",
    "..#########...",
    "...#######....",
    "...###.###....",
    "..##.....##...",
    "..............",
    "..............",
    "..............",
])
pattern("stars", STAR[0], STAR[1], 1, STAR[2],
        ["midnight", "royal", "gold", "volcano", "ocean"], "Stars", "Звёзды")


def maze_bits(cells, seed):
    # Recursive-backtracker maze on a torus, drawn at 2 px per cell.
    rnd = random.Random(seed)
    n = cells
    w = h = 2 * n
    grid = [[True] * w for _ in range(h)]  # True = wall
    seen = set()
    stack = [(0, 0)]
    seen.add((0, 0))
    grid[1][1] = False
    while stack:
        cx, cy = stack[-1]
        nbrs = [((cx + dx) % n, (cy + dy) % n, dx, dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
        nbrs = [t for t in nbrs if (t[0], t[1]) not in seen]
        if not nbrs:
            stack.pop()
            continue
        nx, ny, dx, dy = rnd.choice(nbrs)
        grid[(2 * cy + 1 + dy) % h][(2 * cx + 1 + dx) % w] = False
        grid[2 * ny + 1][2 * nx + 1] = False
        seen.add((nx, ny))
        stack.append((nx, ny))
    return w, h, lambda x, y: grid[y % h][x % w]


MZ = maze_bits(16, 3)
pattern("maze", MZ[0], MZ[1], 1, MZ[2],
        ["neon", "graphite", "desert", "arctic", "toxic"], "Maze", "Лабиринт")

# --------------------------------------------------------------- catalog
def base(name):
    return {"name": name, "product": None, "rarity": "common", "artist": "BasteFront"}


catalog = {"colorPalettes": {}, "patterns": {}, "flags": {}, "effects": {}}
names_en = {"pattern": {}, "color_palette": {}, "effects": {}, "flags": {}}
names_ru = {"pattern": {}, "color_palette": {}, "effects": {}, "flags": {}}

for key, (primary, secondary, en, ru) in PAL.items():
    catalog["colorPalettes"][key] = {"name": key, "primaryColor": primary, "secondaryColor": secondary}
    names_en["color_palette"][key] = en
    names_ru["color_palette"][key] = ru

for key, (w, h, scale, bit, palettes, en, ru) in P.items():
    entry = base(key)
    entry["rarity"] = "uncommon" if key in ("camo", "maze", "honeycomb") else "common"
    if key in ("parachutes", "skulls", "stars", "hearts"):
        entry["rarity"] = "rare"
    entry["pattern"] = encode(w, h, scale, bit)
    entry["colorPalettes"] = [{"name": p, "isArchived": False} for p in palettes]
    catalog["patterns"][key] = entry
    names_en["pattern"][key] = en
    names_ru["pattern"][key] = ru

# ----------------------------------------------------------------- effects
FX = {}


def effect(etype, name, attrs, en, ru, rarity="common"):
    e = base(name)
    e["rarity"] = rarity
    e["effectType"] = etype
    e["attributes"] = attrs
    FX.setdefault(etype, {})[name] = e
    names_en["effects"][name] = en
    names_ru["effects"][name] = ru


RAINBOW = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#0a84ff", "#af52de"]
FIRE = ["#ffe066", "#ff8a1f", "#e63946"]
ICE = ["#ffffff", "#9be7ff", "#2f80ed"]
TOXIC = ["#c6ff00", "#2e7d32"]
POLICE = ["#ff2d2d", "#2d6bff"]

for etype, prefix, en_t, ru_t in (("transportShipTrail", "boat", "Boat", "Корабль"),
                                  ("nukeTrail", "nuke", "Nuke", "Ракета")):
    effect(etype, f"{prefix}_rainbow", {"type": "gradient", "colors": RAINBOW, "colorSize": 4, "movementSpeed": 10},
           f"{en_t}: Rainbow", f"{ru_t}: Радуга", "rare")
    effect(etype, f"{prefix}_fire", {"type": "gradient", "colors": FIRE, "colorSize": 3, "movementSpeed": 14},
           f"{en_t}: Fire", f"{ru_t}: Огонь")
    effect(etype, f"{prefix}_ice", {"type": "gradient", "colors": ICE, "colorSize": 5, "movementSpeed": 6},
           f"{en_t}: Ice", f"{ru_t}: Лёд")
    effect(etype, f"{prefix}_police", {"type": "transition", "colors": POLICE, "frequency": 4},
           f"{en_t}: Siren", f"{ru_t}: Мигалка", "uncommon")
    effect(etype, f"{prefix}_dna", {"type": "spiral", "colors": ["#00e5ff", "#ff00e5"], "radius": 4, "strands": 2, "rotationSpeed": 4},
           f"{en_t}: DNA", f"{ru_t}: ДНК", "rare")
    effect(etype, f"{prefix}_toxic", {"type": "transition", "colors": TOXIC, "frequency": 1},
           f"{en_t}: Toxic", f"{ru_t}: Токсик")

for nuke, en_n, ru_n in (("atom", "Atom", "Атомная"), ("hydro", "Hydrogen", "Водородная"),
                         ("mirvWarhead", "MIRV", "РГЧ")):
    common = {"nukeType": nuke, "size": 210, "speed": 140, "thickness": 4, "transitionSpeed": 0}
    slug = nuke.lower()
    effect("nukeExplosion", f"plasma_{slug}", {"type": "shockwave", "colors": ["#00e5ff", "#ff00e5"], **common},
           f"{en_n}: Plasma", f"{ru_n}: Плазма", "uncommon")
    effect("nukeExplosion", f"fireworks_{slug}", {"type": "sparkles", "colors": RAINBOW, "density": 300, **common},
           f"{en_n}: Fireworks", f"{ru_n}: Салют", "rare")
    effect("nukeExplosion", f"inferno_{slug}", {"type": "embers", "colors": FIRE, "density": 300, **common},
           f"{en_n}: Inferno", f"{ru_n}: Пекло", "rare")
    effect("nukeExplosion", f"frost_{slug}", {"type": "shockwave", "colors": ICE, **common},
           f"{en_n}: Frost", f"{ru_n}: Мороз")

for etype, prefix, en_t, ru_t in (("structures", "city", "Buildings", "Постройки"),
                                  ("warship", "ship", "Warship", "Линкор"),
                                  ("train", "train", "Train", "Поезд"),
                                  ("railroad", "rail", "Railroad", "Рельсы")):
    effect(etype, f"{prefix}_rainbow", {"type": "gradient", "colors": RAINBOW, "colorSize": 4, "movementSpeed": 10},
           f"{en_t}: Rainbow", f"{ru_t}: Радуга", "rare")
    effect(etype, f"{prefix}_gold", {"type": "transition", "colors": ["#ffd54a", "#fff3c4"], "frequency": 1},
           f"{en_t}: Gold", f"{ru_t}: Золото", "uncommon")
    effect(etype, f"{prefix}_neon", {"type": "transition", "colors": ["#22ff88", "#00e5ff", "#ff00e5"], "frequency": 2},
           f"{en_t}: Neon", f"{ru_t}: Неон")

catalog["effects"] = FX

# ------------------------------------------------------------------- flags
FLAGS = {}


def flag(name, svg_body, en, ru, rarity="common"):
    path = f"/cosmetics/flags/{name}.svg"
    with open(os.path.join(OUT_DIR, "flags", f"{name}.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" shape-rendering="crispEdges">'
                + svg_body + "</svg>\n")
    e = base(name)
    e["rarity"] = rarity
    e["url"] = path
    FLAGS[name] = e
    names_en["flags"][name] = en
    names_ru["flags"][name] = ru


def rects(cells, color, s=1, ox=0, oy=0):
    return "".join(f'<rect x="{ox + x * s}" y="{oy + y * s}" width="{s}" height="{s}" fill="{color}"/>' for x, y in cells)


def rows_cells(rows):
    return [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == "#"]


CHUTE_FLAG = [
    "....####....",
    "..########..",
    ".##########.",
    ".#.#.##.#.#.",
    "..#..##..#..",
    "...#.##.#...",
    "....####....",
    ".....##.....",
    ".....##.....",
]


def chute_color(x, y):
    if y < 3:
        return "#ff8a1f" if (x // 2) % 2 == 0 else "#0084d1"
    return "#e8eef5"


flag("bastefront", '<rect width="30" height="20" fill="#0b1726"/>'
     + "".join(f'<rect x="{3 + x * 2}" y="{1 + y * 2}" width="2" height="2" fill="{chute_color(x, y)}"/>'
               for x, y in rows_cells(CHUTE_FLAG)),
     "BasteFront", "BasteFront", "rare")
flag("pirate", '<rect width="30" height="20" fill="#111"/>' + rects(rows_cells([
    "..######..",
    ".########.",
    "##..##..##",
    "##..##..##",
    "##########",
    ".###..###.",
    "..######..",
    "..#.##.#..",
]), "#f5f5f5", 1, 10, 4) + '<path d="M6 15 L24 19 M24 15 L6 19" stroke="#f5f5f5" stroke-width="1.2"/>',
     "Jolly Roger", "Весёлый Роджер", "rare")
flag("rainbow", "".join(f'<rect y="{i * 20 / 6:.4f}" width="30" height="{20 / 6 + 0.05:.4f}" fill="{c}"/>'
                        for i, c in enumerate(RAINBOW)), "Rainbow", "Радуга")
flag("checkered", "".join(f'<rect x="{x * 3}" y="{y * 2.5}" width="3" height="2.5" fill="{"#111" if (x + y) % 2 else "#f5f5f5"}"/>'
                          for y in range(8) for x in range(10)), "Checkered", "Финиш")
flag("radioactive", '<rect width="30" height="20" fill="#ffd400"/><circle cx="15" cy="10" r="1.6" fill="#111"/>'
     + "".join(f'<path d="M15 10 L{15 + 7 * math.cos(math.radians(a)):.3f} {10 + 7 * math.sin(math.radians(a)):.3f} '
               f'A7 7 0 0 1 {15 + 7 * math.cos(math.radians(a + 60)):.3f} {10 + 7 * math.sin(math.radians(a + 60)):.3f} Z" fill="#111"/>'
               for a in (-120, 0, 120))
     + '<circle cx="15" cy="10" r="2.6" fill="#ffd400"/><circle cx="15" cy="10" r="1.6" fill="#111"/>',
     "Radioactive", "Радиация", "uncommon")
flag("toxic_green", '<rect width="30" height="20" fill="#1b2a0a"/><path d="M0 14 Q7 10 15 14 T30 14 V20 H0Z" fill="#c6ff00"/>'
     '<circle cx="9" cy="7" r="2" fill="#c6ff00"/><circle cx="20" cy="5" r="1.3" fill="#c6ff00"/>',
     "Toxic Swamp", "Токсичное болото")
flag("ocean_wave", '<rect width="30" height="20" fill="#0d3b66"/><path d="M0 12 Q5 7 10 12 T20 12 T30 12 V20 H0Z" fill="#4fc3f7"/>'
     '<path d="M0 16 Q5 12 10 16 T20 16 T30 16 V20 H0Z" fill="#e1f5fe"/>', "Big Wave", "Большая волна")
flag("night_sky", '<rect width="30" height="20" fill="#0b1020"/><circle cx="23" cy="6" r="3" fill="#fff3c4"/>'
     '<circle cx="24.2" cy="5.2" r="2.6" fill="#0b1020"/>'
     + "".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#8ea2ff"/>'
               for x, y in ((4, 4), (9, 2), (13, 7), (6, 12), (17, 14), (25, 15), (11, 16), (2, 17))),
     "Night Sky", "Ночное небо")
catalog["flags"] = FLAGS

with open(os.path.join(OUT_DIR, "cosmetics.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)
    f.write("\n")


# ------------------------------------------------------------ translations
def sort_dict(d):
    return {k: sort_dict(v) if isinstance(v, dict) else v for k, v in sorted(d.items())}


for lang, names in (("en", names_en), ("ru", names_ru)):
    p = os.path.join(REPO, "resources", "lang", f"{lang}.json")
    data = json.load(open(p, encoding="utf-8"))
    tp = data.setdefault("territory_patterns", {})
    tp.setdefault("pattern", {}).update(names["pattern"])
    tp.setdefault("color_palette", {}).update(names["color_palette"])
    fx = data.setdefault("effects", {})
    for k in names["effects"]:
        assert k not in ("nukeType", "type"), k
    fx.update(names["effects"])
    data.setdefault("flags", {}).update(names["flags"])
    data["territory_patterns"] = sort_dict(tp)
    data["effects"] = sort_dict(fx)
    data["flags"] = sort_dict(data["flags"])
    if lang == "en":
        data = sort_dict(data)  # en.json is kept sorted (EnJsonSorted.test.ts)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

print("patterns", len(P), "palettes", len(PAL), "effects", sum(len(v) for v in FX.values()), "flags", len(FLAGS))
