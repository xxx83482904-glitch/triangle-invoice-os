# あきらくんと おりょうり — Synology 公開

既存の Synology アプリが静的ファイルを配信します。入口は `/akira-kitchen`、表示先は `/akira-kitchen/index.html`。画像・JS・CSS・Service Workerはすべて `/akira-kitchen/` 以下に置きます。

公開URL: https://akira.kuremasato.com/

Cloudflareの既存トンネル `triangle-invoice-os` に、ホスト `akira.kuremasato.com`、パス `^/akira-kitchen(/.*)?$` の公開ルートを追加しています。接続先は既存の日本版と同じSynologyです。CNAMEはトンネル設定から作成されます。

- `Akira kitchen home`: `http.host eq "akira.kuremasato.com" and http.request.uri.path eq "/"` をHTTPSの `/akira-kitchen/index.html` へ302転送。
- `Akira kitchen - no analytics`: このホストだけCloudflare RUMを無効化し、解析スクリプトの自動挿入を停止。
- ドメイン直下のA/MX、既存の請求管理・予定管理・注文システムのルートは変更しません。
- このホストでは料理アプリのパスだけを通します。その他はトンネルの404になります。

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

17画面・調理・自由配置・IndexedDBアルバム・音設定を実装。2.2ではアプリの自動テスト45件と、Chromiumの1024×768タッチ操作による全17画面・保存・復元・オフライン再起動を確認。実機iPad/Safariのタッチ、ホーム画面追加、機内モードでの再起動は別途確認が必要です。

`node scripts/verify-akira-domain.mjs` は独自ドメインのHTTPS・入口の転送・release.jsonに記録された全ファイルのSHA-256・Service Workerヘッダー・料理以外のルートの404・既存サービスの正常応答を確認し、`docs/akira-kitchen-domain-verification.json` に結果を保存します。2.2の配布対象は69ファイル、オフラインキャッシュ対象は63ファイルです。

Service Workerは転送のない `/akira-kitchen/index.html` を直接キャッシュします。ディレクトリURLの転送後レスポンスをナビゲーションへ再利用するとブラウザが再読み込みを拒否するためです。実際のHTTP転送を使う回帰テストで検証しています。以前のキャッシュを保持している場合は、開いているアプリをすべて閉じてから開き直すと更新版へ切り替わります。

アルバムは開いたURLのドメインごとに保存されます。以前のSites版で作った作品はNAS版に自動移動しません。写真、アカウント、作品をサーバーへ送る機能はありません。
