"""Prepare fonts and original product marks for the video renderer."""
from pathlib import Path
from fontTools.ttLib import TTFont
import cairosvg

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parents[1] / 'website/public'
ASSETS = ROOT / 'assets'
ASSETS.mkdir(parents=True, exist_ok=True)
for name in ['manrope', 'plex-mono']:
    font = TTFont(SITE / 'fonts' / f'{name}-latin.woff2')
    font.flavor = None
    font.save(ASSETS / f'{name}.ttf')
for name in ['codex', 'claude-code', 'cursor']:
    svg = (SITE / 'agents' / f'{name}.svg').read_text().replace('currentColor', '#202321')
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(ASSETS / f'{name}.png'), output_width=144, output_height=144)
print('Prepared website fonts and agent marks')
