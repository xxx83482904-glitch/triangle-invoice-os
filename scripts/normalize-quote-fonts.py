"""Align TrueType outlines for reliable pdf-lib/fontkit short-loca subsetting.

Requires fontTools. Run after replacing quotation fonts, before building assets.
Only storage padding changes; glyph outlines and font metrics are preserved.
"""
from pathlib import Path
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1] / "design-fee-calculator/public/fonts"
for path in root.glob("*.ttf"):
    font = TTFont(path, recalcTimestamp=False)
    font["glyf"].padding = 2
    font.save(path)
    verified = TTFont(path)
    assert all(offset % 2 == 0 for offset in verified["loca"].locations)
    print(f"{path.name}: aligned glyph offsets")
