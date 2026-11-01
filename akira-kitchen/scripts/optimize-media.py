"""Build runtime WebP/WOFF2 assets; keep original PNG/TTF source files intact.
Install Pillow and fonttools[woff] in a build environment before running.
"""
from pathlib import Path
import json
import re
import sys
from PIL import Image
from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public' / 'akira-kitchen'
DEST = SOURCE / 'media'
DEST.mkdir(exist_ok=True)
MANIFEST = {}
STATS = []

def emit(name, image, sizes=(256,), ceiling=149000, quality=75):
    urls = []
    for i, width in enumerate(sizes):
        target = image.resize((width, max(1, round(image.height * width / image.width))), Image.Resampling.LANCZOS)
        suffix = f'-{i+1}x' if len(sizes) > 1 else ''
        filename = f'{name}{suffix}.webp'
        output = DEST / filename
        selected = quality
        # Flat illustration edges need far less alpha precision than a photograph.
        # Quantizing only the alpha channel avoids huge lossless-alpha payloads at 2x.
        target.putalpha(target.getchannel('A').point(lambda a: round(a / 17) * 17))
        for q in range(quality, 19, -10):
            target.save(output, 'WEBP', quality=q, method=4)
            selected = q
            if output.stat().st_size <= ceiling:
                break
        if output.stat().st_size > 150000:
            target = target.quantize(colors=96).convert('RGBA')
            target.save(output, 'WEBP', quality=35, method=4)
            selected = 35
        if output.stat().st_size > 150000:
            raise RuntimeError(f'{filename} exceeds 150KB')
        urls.append({'url': '/akira-kitchen/media/' + filename, 'width': width})
        STATS.append({'file': filename, 'bytes': output.stat().st_size, 'width': width, 'height': target.height, 'quality': selected})
    MANIFEST[name] = {'src': urls[0]['url'], 'srcSet': ', '.join(f'{v["url"]} {v["width"]}w' for v in urls) if len(urls) > 1 else None}

def source(name):
    return Image.open(SOURCE / f'illustration-{name}.png').convert('RGBA')

# A single canonical chibi character; no realistic-style pose enters runtime media.
emit('chef-home', source('chef-home-v2'), (512,), 42000)
for pose in ['ladle', 'squeeze', 'celebrate', 'taste']:
    emit('chef-' + pose, source('chef-' + pose + '-v3'), (512,), 42000)
for name, original in [('home-backdrop', 'home-backdrop-v2'), ('kitchen', 'kitchen'), ('home-bento', 'home-bento-v2'), ('home-cake', 'home-cake-v2')]:
    emit(name, source(original), (1448, 2896), 60000 if name.startswith('home') else 100000, 65)
    if name in ['home-bento','home-cake']:
        # At 1024px/DPR2 these half-screen cards need about 940 physical pixels.
        # Keep the requested 1448/2896 originals and add a properly sized candidate.
        emit(name+'-small', source(original), (960,), 32000, 65)
        MANIFEST[name]['srcSet']=MANIFEST[name+'-small']['src']+' 960w, '+MANIFEST[name]['srcSet']
emit('title-cloud', source('title-cloud-v2'), (768,), 12000)
emit('bento-box', source('bento-box').crop((78, 186, 1459, 835)), (1448, 2896), 70000)
for name in ['cake-base', 'cake-chocolate', 'cake-strawberry']:
    emit(name, source(name), (1448, 2896), 110000)
for name in ['rice-round-v2', 'rice-triangle-v3', 'rice-tub-v2']:
    emit(name.rsplit('-', 1)[0], source(name), (768,), 80000)
for variant in ['nori', 'ume', 'wakame', 'salmon', 'yukari', 'sesame']:
    emit('rice-' + variant, source('rice-' + variant + '-v2'))
emit('rice-smile', source('rice-smile-v2').crop((100, 210, 1670, 750)), (256,), 12000)
for name in ['carrot-star', 'carrot-heart', 'ingredient-egg', 'ingredient-flour', 'ingredient-milk']:
    emit(name, source(name + '-v2'))

SPRITES = {
    'onigiri': ('bento-foods', 39, 103, 448, 407), 'tamago': ('bento-foods', 543, 110, 455, 404),
    'karaage': ('bento-foods', 1041, 86, 476, 438), 'broccoli': ('bento-foods', 29, 527, 487, 453),
    'tomato': ('bento-foods', 555, 536, 428, 441), 'carrot': ('bento-foods', 1063, 543, 440, 421),
    'strawberry': ('cake-toppings', 93, 65, 405, 428), 'chocolate': ('cake-toppings', 572, 113, 406, 380),
    'banana': ('cake-toppings', 1056, 116, 442, 372), 'blueberry': ('cake-toppings', 61, 613, 424, 331),
    'cream': ('cake-toppings', 573, 580, 392, 378), 'sprinkles': ('cake-toppings', 1085, 615, 406, 335),
}
for name, (sheet, x, y, width, height) in SPRITES.items():
    crop = source(sheet).crop((x, y, x + width, y + height))
    side = max(width, height)
    square = Image.new('RGBA', (side, side))
    square.paste(crop, ((side - width) // 2, (side - height) // 2))
    emit(name, square)

icons = ROOT / 'src' / 'app' / 'akira-kitchen' / 'media-manifest.json'
icons.write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

characters = set(chr(c) for c in range(32, 127))
characters.update(chr(c) for c in range(0x3040, 0x3100))
characters.update('０１２３４５６７８９。、！？〜ー「」（）％＋✓×')
for folder in [ROOT / 'src', ROOT / 'content']:
    if folder.exists():
        for file in folder.rglob('*'):
            if file.suffix in ['.ts', '.tsx', '.json']:
                characters.update(file.read_text(encoding='utf-8'))
options = subset.Options()
options.flavor = 'woff2'
options.layout_features = ['*']
font = subset.load_font(SOURCE / 'fonts' / 'MPLUSRounded1c-Black.ttf', options)
worker = subset.Subsetter(options=options)
worker.populate(text=''.join(characters))
worker.subset(font)
font_path = SOURCE / 'fonts' / 'AkiraRounded-v3.woff2'
subset.save_font(font, font_path, options)
if font_path.stat().st_size > 300000:
    raise RuntimeError('Font exceeds 300KB')
report = {'images': len(STATS), 'imageBytes': sum(f['bytes'] for f in STATS), 'fontBytes': font_path.stat().st_size, 'files': STATS}
if report['imageBytes'] > 5000000:
    raise RuntimeError('Runtime images exceed 5MB')
(ROOT / 'media-build.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}))
