# Writes hooks/glyphs.ts: the outlines of the glyphs the poems use, from Long Cang.
import re, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path, poems_path, out_path = sys.argv[1:4]
font = TTFont(font_path)
em = font['head'].unitsPerEm
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()

src = open(poems_path, encoding='utf-8').read()
lines = re.findall(r"^\s*\['([^']+)',", src, flags=re.M)
chars = sorted(set(''.join(lines) + '北星际指南·远征航段距还有天终点已过程'))
chars = [c for c in chars if not c.isspace()]

rows, missing, total = [], [], 0
for c in chars:
    name = cmap.get(ord(c))
    if name is None:
        missing.append(c); continue
    pen = SVGPathPen(glyphs, ntos=lambda v: str(int(round(v))))
    # y grows downward on screen: flip here, so the scene only scales.
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    d = pen.getCommands()
    adv = font['hmtx'][name][0]
    total += len(d)
    rows.append(f"  {c!r}: [{adv}, '{d}'],")
open(out_path, 'w', encoding='utf-8').write(
    "// Outlines of the glyphs the poems use, from Long Cang (龙藏体), Copyright 2018 The Long\n"
    "// Cang Project Authors, under the SIL Open Font License 1.1 (see LICENSE-LongCang.txt).\n"
    "// Generated: a scene can load no font, so the brush is carried as paths. y runs down.\n"
    "// A poem that uses a glyph not listed here is set in the system's 行楷 instead.\n\n"
    f"/** Font units to the em. */\nexport const EM = {em}\n\n"
    "/** Each glyph: how far it advances, and its outline. */\n"
    "export const GLYPHS: Readonly<Record<string, readonly [advance: number, outline: string]>> = {\n"
    + "\n".join(rows) + "\n}\n")
print('em', em, 'glyphs', len(rows), 'missing', ''.join(missing) or 'none', 'avg path chars', total // max(1, len(rows)), 'total', total)
longest = max(lines, key=len)
print('longest line', len(longest), 'chars; its outlines:', sum(len(r) for r in rows if r[3] in longest))
