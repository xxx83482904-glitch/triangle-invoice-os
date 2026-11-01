# あきらくんと おりょうり — Synology 公開

既存の Synology アプリが静的ファイルを配信します。入口は `/akira-kitchen`、表示先は `/akira-kitchen/index.html`。画像・JS・CSS・Service Workerはすべて `/akira-kitchen/` 以下に置きます。

## 修正・再公開

```sh
npm --prefix akira-kitchen ci
npm --prefix akira-kitchen/tests/akira-kitchen ci
npm --prefix akira-kitchen test
npm run build:akira-kitchen
```

`akira-kitchen/` が独立したソース、`public/akira-kitchen/` が検証済みの配布ファイルです。配布ファイルもコミットします。既存の Deploy Synology ワークフローが main の更新をNASへ反映します。NAS側の請求管理アプリのビルドで料理アプリを再ビルドする必要はありません。

通常の開発は `npm --prefix akira-kitchen run dev`。iPadは同じWi-FiからPCのIPv4アドレスとポート3060でアクセスします。PWA・オフラインの確認はHTTPSの公開URLで行います。

## 確認

`node scripts/check-akira-kitchen-assets.mjs` は、公開ファイルのSHA-256、JS/CSSの専用パス、全オフラインアセット、マニフェスト、既存ルートの維持を検証します。`release.json` から公開後のファイルとの一致を確認できます。

17画面・調理・自由配置・IndexedDBアルバム・音設定を実装。アプリの自動テストは43件。実機iPad/Safariのタッチ、ホーム画面追加、機内モードでの再起動は別途確認が必要です。

アルバムは開いたURLのドメインごとに保存されます。以前のSites版で作った作品はNAS版に自動移動しません。写真、アカウント、作品をサーバーへ送る機能はありません。
