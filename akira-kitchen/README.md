# あきらくんと おりょうり

3〜6歳向け、iPad横向き4:3の料理あそび。17画面、Pointer Eventsでの調理・盛り付け、IndexedDBアルバム、Web Audio、PWAを実装。

## 起動

Node 22.18以上で `npm install` → `npm run dev`。http://localhost:3060/akira-kitchen/ を開きます。同じWi-FiのiPadはPCのIPv4アドレス:3060をSafariで開きます。

## 検証・ビルド

`npm ci --prefix tests/akira-kitchen` → `npm test` → `npm run build`。`out/` が静的配布物です。ビルドが全アセットを列挙したService Workerを生成します。オフライン確認はHTTPSで初回オンライン起動後、ホーム画面に追加して行います。

## 保存

作品画像・味・食材・座標・日付はIndexedDB、途中の進行と設定はlocalStorageに保存。サーバー送信、外部API、広告、追跡はありません。データを消すと作品も消えます。

## 2.2の調整

採用済み01〜03を基準に、ホームの人物・料理・背景、握る人物、米びつ、6種類のおにぎりを独立画像として生成。食べる・喜ぶポーズ、ケーキ材料、型抜きにんじんも追加しています。太い日本語フォントを同梱し、共通ボタンの文字が縮む問題と、削除通知が復元ボタンを覆う問題を修正しました。

調理段階ごとの案内、味に応じた生地の色、調理ジェスチャー後のタップ、アルバムの「また つくる」も調整。既存の自由配置・画像保存・設定を引き継ぎます。生成指示と採用素材の記録は `docs/akira-kitchen/qa/v2.2/asset-*.json` にあります。

## 検証の範囲

45件の自動チェックが成功。モデル、React UI、IndexedDB、画像埋め込み、音設定、Service Workerを検証しています。さらに実際のChromiumで1024×768のタッチ操作を行い、17画面、自由配置、保存・再読み込み、削除直後の復元、オフライン再起動を確認しました。22枚のスクリーンショットと設計原本を比較しています。詳細は [design-qa.md](design-qa.md) と `docs/akira-kitchen/qa/v2.2/browser-local.json` を参照。

実ブラウザテストにはGoogle Chromeが必要です。アプリの開発サーバー起動後、アプリフォルダで `npm --prefix tests/akira-kitchen run test:browser` を実行します。独立したブラウザにテスト作品を保存するため、利用者のアルバムは変更しません。

PowerShellで公開版とオフラインを確認する場合：

```powershell
$env:AKIRA_BASE_URL='https://akira.kuremasato.com/akira-kitchen/index.html'
$env:AKIRA_OFFLINE='1'
npm --prefix tests/akira-kitchen run test:browser
```

実機iPad Safariの指への追従感、音の聴感、ホーム画面追加と機内モード、3〜6歳の子どもによる理解度は未検証です。採用原本の手描き文字・小さな装飾には細部の差があり、調理中の鍋・卵液・オーブンは動的SVGを維持しています。

## Synologyへ公開

このフォルダはSynology向けの独立した静的ソースです。リポジトリのルートで `npm run build:akira-kitchen` を実行すると、検証した配布物が `public/akira-kitchen/` に配置されます。mainへコミット・pushすると既存のDeploy Synologyワークフローが公開します。

公開URL: https://akira.kuremasato.com/

Synology直接URL: https://trianglejp14f.synology.me/akira-kitchen/index.html

詳細は親フォルダの `docs/akira-kitchen-synology.md` を参照。元の人物写真・資格情報・サーバー側の利用者データは含みません。以前のSites版とアルバムは別保存です。
