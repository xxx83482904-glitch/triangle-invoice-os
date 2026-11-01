"""Record visible bounds of existing assets; no image files are changed.

Run after optimize-media.py when artwork changes. Normal npm builds consume the
checked-in JSON and do not need Python/Pillow.
"""
from pathlib import Path
from PIL import Image
import json

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'src/app/akira-kitchen/media-manifest.json').read_text(encoding='utf-8'))
result = {}
for name, asset in manifest.items():
    src = asset['srcSet'].split(',')[-1].strip().split(' ')[0] if asset.get('srcSet') else asset['src']
    im = Image.open(root/'public'/src.lstrip('/')).convert('RGBA')
    x, y, right, bottom = im.getchannel('A').point(lambda a:255 if a > 16 else 0).getbbox()
    result[name] = {'src':src, 'width':im.width, 'height':im.height, 'x':x, 'y':y, 'paintWidth':right-x, 'paintHeight':bottom-y}
(root/'src/app/akira-kitchen/media-geometry.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Recorded alpha > 16 bounds for',len(result),'existing assets.')
