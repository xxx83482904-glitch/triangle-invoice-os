# あきらくんと おりょうり

3〜6歳向け、iPad横向き4:3の料理あそび。17画面、Pointer Eventsでの調理・盛り付け、IndexedDBアルバム、Web Audio、PWAを実装。

## 起動

Node 22.18以上で `npm install` → `npm run dev`。http://localhost:3060/akira-kitchen/ を開きます。同じWi-FiのiPadはPCのIPv4アドレス:3060をSafariで開きます。

## 検証・ビルド

`npm ci --prefix tests/akira-kitchen` → `npm test` → `npm run build`。`out/` が静的配布物です。ビルドが全アセットを列挙したService Workerを生成します。オフライン確認はHTTPSで初回オンライン起動後、ホーム画面に追加して行います。

## 保存

作品画像・味・食材・座標・日付はIndexedDB、途中の進行と設定はlocalStorageに保存。サーバー送信、外部API、広告、追跡はありません。データを消すと作品も消えます。

## 検証の範囲

自動テストはJSDOM / fake-indexeddbとService Worker・Audioのスタブを含みます。実機iPad/Safariとブラウザの画面比較は未検証です。詳細は docs/akira-kitchen/qa/verification-v2.md を参照。

## Synologyへ公開

このフォルダはSynology向けの独立した静的ソースです。リポジトリのルートで `npm run build:akira-kitchen` を実行すると、検証した配布物が `public/akira-kitchen/` に配置されます。mainへコミット・pushすると既存のDeploy Synologyワークフローが公開します。

公開URL: https://trianglejp14f.synology.me/akira-kitchen/index.html

詳細は親フォルダの `docs/akira-kitchen-synology.md` を参照。元の人物写真・資格情報・サーバー側の利用者データは含みません。以前のSites版とアルバムは別保存です。
