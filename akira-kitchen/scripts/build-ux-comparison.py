"""Assemble the recorded reference / before / after screenshots without changing UI artwork."""
from pathlib import Path
import shutil
import html
from PIL import Image, ImageDraw

app = Path(__file__).resolve().parents[1]
repo = app.parent
out = app / 'docs/akira-kitchen/qa/browser-v3'
before = repo / 'outputs/akira-adjustment-2026-11-01/public-production'
reference = repo / 'outputs/akira-ui-audit-2026-11-01/references'
titles = ['ホーム', 'おべんとう メニュー', 'おにぎり', 'たまごやき', 'からあげ', 'やさい', 'おべんとうに つめる', 'おべんとう できあがり', 'たべてみよう', 'アルバムに ほぞん', 'ケーキ メニュー', 'きじを まぜる', 'スポンジを やく', 'クリーム・かざる', 'ケーキ できあがり', 'アルバム', 'せってい']
notes = [
    '採用レイアウトを保ち、音声・絵・手の案内を追加。カード全体が反応し、設定は3秒長押しの先へ。',
    '箱を中央に拡大。未完成の白いシルエットと完成マークを分け、料理ができるまで「つめよう」をロック。',
    '大きなご飯をタップで三角に。具の選択は下段、人物は小窓へ。「さんかく」のおだいを追加。',
    '卵を2個数え、混ぜて巻く。進行は既存データを維持しながら、見えるステップを3つに整理。',
    '料理を中央に拡大。混ぜる・丸める・鍋に入れる動きと3段階の焼き色で案内。',
    '野菜の色・形を音声と絵で案内。選んだ形と種類を完成品まで保持。',
    '箱を約70%幅へ。右棚を3個ずつのページ式に変更。タップ配置・ドラッグ・90度回転・棚へ戻す・1手戻す。',
    '実際に作った配置を大きく表示。統一したお祝いポーズ、紙吹雪、音声。「たべてみる」を主操作に。',
    '各食材を2口で食べる。食べる前の作品を保持し、ケーキにも同じ流れを適用。',
    '保存を一つの主操作に。実際の食材・座標・回転・クリームを画像にし、本棚へ移る演出。',
    '3つの味を選ぶとケーキの色が即反映。先の工程で使う飾りにも音声で反応。',
    '材料3つを順番に入れて数える。指の円に連動して生地が混ざる。',
    '大きなオーブンの窓、3段階の色と膨らみ。待ち時間を増やさず操作で進む。',
    'クリームの実際の塗布面積から飾りへ。右棚は3個ずつ。いちご3個のおだいとカウント。',
    '自分のケーキを大きく表示。人物の絵柄を統一し、お弁当と同じ味見・保存へ。',
    '大きな3列と全画面表示。削除は保護者ゲート内。IndexedDBと旧作品の読み込みを維持。',
    'ナレーション切替を追加。単一言語の行を削除。保護者向け3項目を30px以上で常時表示。',
]
for folder in ['before', 'design']:
    (out / folder).mkdir(exist_ok=True, parents=True)
sections = []
for i, (title, note) in enumerate(zip(titles, notes), 1):
    num = f'{i:02}'
    shutil.copyfile(before / f'{num}.png', out / 'before' / f'{num}.png')
    ref = next(reference.glob(f'{num}_*.png'))
    shutil.copyfile(ref, out / 'design' / f'{num}.png')
    assert (out / f'{num}.png').is_file()
    sections.append(f'''<section id="screen-{num}"><h2>{num} {html.escape(title)}</h2><p>{html.escape(note)}</p>
<div class="pair"><figure><figcaption>Before · 公開版 2.2</figcaption><a href="before/{num}.png"><img loading="lazy" src="before/{num}.png" alt="変更前 {title}"></a></figure>
<figure><figcaption>After · 3.0 / 1024 × 768</figcaption><a href="{num}.png"><img loading="lazy" src="{num}.png" alt="変更後 {title}"></a></figure></div>
<details><summary>採用デザイン原本（01〜03採用済み、04〜17設計案）</summary><img class="reference" loading="lazy" src="design/{num}.png" alt="設計資料 {title}"></details></section>''')
(out / 'comparison.html').write_text('''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>あきらくん 3.0 · 17画面比較</title>
<style>body{margin:0;background:#f3f6fc;color:#0d2867;font-family:system-ui,sans-serif;line-height:1.7}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:32px}section{background:white;border:1px solid #d9e2f3;border-radius:20px;padding:24px;margin:30px 0}figure{margin:0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}img{width:100%;height:auto;border-radius:12px}figcaption{font-weight:700;padding:8px 0}details{margin-top:18px}summary{cursor:pointer;padding:12px}.reference{max-width:724px;display:block;margin:16px auto}nav{display:flex;flex-wrap:wrap;gap:10px}nav a{padding:8px 16px;background:white;border-radius:8px;color:#0d2867}p{max-width:1000px}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:16px}}</style>
<main><h1>あきらくんと おりょうり · 17画面比較</h1><p>2026-11-01。変更前は公開版2.2、変更後は今回の静的ビルドをPlaywrightで操作して撮影した画面です。文字を読めなくても遊べる仕様に沿って、元の色・世界観と料理素材を活かし、料理の大きさ・案内・ボタンの優先順位を調整しました。キャラクターは指定されたデフォルメ版を基準に生成しています。</p><p>各画像はクリックで原寸表示できます。撮影中の料理の種類・工程・配置は異なるため、同じ作品のピクセル差分ではありません。原本を各画面で開いて比較できます。実機iPadのスクリーンショットではありません。</p><nav>''' + ''.join(f'<a href="#screen-{i:02}">{i:02}</a>' for i in range(1,18)) + '</nav>' + ''.join(sections) + '</main></html>', encoding='utf-8')

# Contact sheets are review aids, kept outside the source and deploy artifacts.
review = repo / 'outputs/akira-preschool-ux-2026-11-01/review'
review.mkdir(parents=True, exist_ok=True)
for group in range(3):
    sheet = Image.new('RGB', (1024, 3 * 414), '#e8eef8')
    draw = ImageDraw.Draw(sheet)
    for slot in range(6):
        i = group * 6 + slot + 1
        if i > 17: break
        x, y = (slot % 2) * 512, (slot // 2) * 414
        draw.text((x + 12, y + 9), f'Screen {i:02} - After', fill='#0d2867')
        with Image.open(out / f'{i:02}.png') as im:
            sheet.paste(im.convert('RGB').resize((512,384)), (x, y + 30))
    sheet.save(review / f'contact-{group + 1}.jpg', quality=90)
print('17 comparison sections + 3 review sheets generated')
