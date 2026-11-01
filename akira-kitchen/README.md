# あきらくんと おりょうり 3.0

3〜6歳向けの料理あそび。17画面を音声・絵・手のヒントで案内します。iPad横向き4:3、1448×1086の固定ステージを画面に合わせて縮小。Next.js App Routerの静的書き出しと公開パス `/akira-kitchen/` を維持しています。

公開先: https://akira.kuremasato.com/akira-kitchen/

## 起動とビルド

Node.js 22.18以上を使用し、このフォルダで実行してください。

```powershell
npm ci
npm run dev
```

http://localhost:3060/akira-kitchen/ を開きます。同じWi-FiのiPadからは `http://PCのIPv4アドレス:3060/akira-kitchen/` をSafariで開きます。Windowsのファイアウォールでローカル接続を許可する必要があります。PWAのホーム画面追加・オフライン起動はHTTPSの公開先で確認してください。

```powershell
npm ci --prefix tests/akira-kitchen
npm test
npm run build
npm --prefix tests/akira-kitchen run test:browser
node tests/akira-kitchen/webkit.test.mjs
node tests/akira-kitchen/performance.test.mjs
```

`out/` が静的配布物です。ビルドにTypeScript検査を含みます。ブラウザテストは静的サーバーを自動起動し、独立したブラウザに作品を保存します。利用者のアルバムには触れません。ChromiumテストはWindows版Google Chromeの標準インストール先を使用します。WebKitは初回だけ `npm exec --prefix tests/akira-kitchen -- playwright install webkit` で導入してください。

公開先の検証は環境変数で切り替えられます。結果を分ける場合は `AKIRA_QA_OUTPUT` に絶対パスを指定してください。

```powershell
$env:AKIRA_BASE_URL='https://akira.kuremasato.com/akira-kitchen/index.html'
npm --prefix tests/akira-kitchen run test:browser
```

## 遊び方

- ホームの大きな絵から、お弁当かケーキを選びます。最初のタップで音声が使えるようになり、右上のスピーカーで案内をもう一度聞けます。
- ご飯はタップで握り、卵は2個割って混ぜ、巻きます。からあげは混ぜる・丸める・色の変化、野菜は色や形を楽しめます。正確なジェスチャーでなくても進みます。
- 作ったおかずは右の棚に3個ずつ並び、大きな矢印で切り替えます。タップでもドラッグでも置けます。置いた食材は移動、ダブルタップで90度回転、棚に戻して取り外し、「もどす」で1手取り消せます。
- ケーキは味を選び、材料を入れて混ぜ、焼き、ドラッグでクリームを塗ってから飾ります。色・数・形のおだいは、できなくても完成を妨げません。空の作品では完成へ進みません。
- 味見では2口で食材が消えます。保存する画像には食べる前の作品を使います。アルバムで作品を大きく表示できます。
- 設定と作品削除は3秒長押しの保護者ゲートから開きます。効果音、BGM、ナレーションと音量を設定できます。再起動時は一度だけ「つづきから／さいしょから」を選びます。
- 縦向きと幅600px未満では、回転するタブレットの絵で横持ちを案内します。

## 保存とオフライン

作品画像・食材・配置・日時は既存のIndexedDB `akira-kitchen-album`、進行は `akira-kitchen:session:v2` に保存します。レシピ構造と既存作品を引き継ぎます。Blobを書き込めないWebKitでは同じストアにバイト列で保存し、読み出し時にBlobへ戻します。

写真撮影、サーバーへの作品送信、ログイン、広告、ユーザー追跡、実行時の外部APIはありません。ブラウザのサイトデータを消すと作品も消えます。通常タブとホーム画面アプリでは端末の保存領域が分かれる場合があります。

Service Workerは起動用約1.60MBだけを事前キャッシュします。残りは表示時に保存し、次の画面を先読みします。初回のオンライン起動後に残りの画像と音声も少しずつ保存します。設定のオフライン準備完了表示を確認してから接続を切ってください。更新時は開いているアプリのタブを閉じて開き直します。更新のためにサイトデータを消す必要はありません。

## 素材と音声の再生成

PNGと元TTFは編集用原本としてソース内に保持し、公開配布物から除外します。WebPの51ファイルは合計約1.38MB、1枚150KB未満、WOFF2は31,380bytesです。大型画像は1448/2896px、ホームカードは960pxも用意し、`srcset` で選びます。料理の小物は256pxです。

人物はホームのデフォルメ版を基準に、おたま・握る・お祝い・味見をImageGenで生成しました。顔、黒い前髪、白い帽子、クマのワッペンの黄色いエプロンを統一。指示と記録は [preschool-character-prompts.json](docs/preschool-character-prompts.json) を参照してください。

Pythonに `Pillow`、`fonttools[woff]`、`brotli`、`zopfli`、`imageio-ffmpeg` が必要です。生成済みファイルを同梱するため通常のビルドには不要です。

```powershell
python scripts/optimize-media.py
powershell -NoProfile -File scripts/generate-narration.ps1
python scripts/encode-narration.py
```

音声はWindowsのMicrosoft Sayakaを使って事前生成した102本のMP3（最長1.765秒）です。明るめの速度・高さに調整しています。実行時はWeb Audioで再生し、`speechSynthesis` は使いません。原稿は `content/narration.json`、容量と長さは `audio-build.json` に記録しています。

## 検証と残る確認

自動チェック、Chromiumの1024×768タッチ操作、WebKitでの両料理の作成・保存・再表示、17画面の撮影を行っています。結果・数値・実行条件は [検証報告](docs/preschool-ux-results.md)、画面比較は [Before / After](docs/akira-kitchen/qa/browser-v3/comparison.html) を参照してください。

実機iPad Safariでの指への追従、音声の聴感、ホーム画面追加、3〜6歳の子どもによる理解度は未確認です。WindowsのPlaywright WebKitを実機Safariとして扱っていません。調理中の変形するご飯・卵液・鍋・オーブンは操作と同期するSVGで描画し、静止イラストの差し替えだけにはしていません。

## Synologyへ公開

リポジトリルートで `npm run build:akira-kitchen` を実行すると、検証した配布物が `public/akira-kitchen/` に配置されます。mainへコミット・pushすると既存のDeploy Synologyワークフローが公開します。詳細は親フォルダの `docs/akira-kitchen-synology.md` を参照してください。

元の人物写真、認証情報、利用者のアルバムを公開ファイルに含めません。既存のホスト側アプリと他の公開ルートは変更していません。
