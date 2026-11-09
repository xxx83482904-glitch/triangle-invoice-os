# 携帯の「こもれび」アプリ

携帯版はホーム画面に追加するPWAです。専用アイコン・独立した画面から、個人／グループ会話の閲覧とテキスト送信ができます。App Store / Google Play配布用のネイティブアプリは今回の成果物には含みません。

2026-11-09に本人の許可を得て、**携帯のVPN接続が不要なFunnel + アプリ認証**へ切り替えました。TailscaleはWindows側だけで動かし、携帯では通常のHTTPSで接続します。

~~~text
携帯の「こもれび」（VPN不要）
    ↓ HTTPS・WSS / 接続キーでログイン
Funnel中継（通信内容は復号しない）
    ↓ Windows上でTLSを終端
Windows常駐アプリ（API・送信キュー・SQLite）
    ↓ Adapter
Mock / Windows版WeChat（実送受信は未対応）
~~~

Windowsがサーバーを兼ねます。Synologyや別のクラウドサーバーの運用は不要です。Windowsの起動・ログイン・ネットワーク接続が必要で、スリープ・電源オフ・サインアウト中は使えません。

## 携帯から開く

1. **アプリの設定に表示される携帯用URL** をSafari / Chromeで開きます。携帯のTailscale接続は不要です。
2. Windowsの .runtime/access-token.txt にある接続キーを入力します。.envに独自キーを設定した場合はそちらを使います。WeChatのパスワードは使いません。キーをURLやチャットに含めないでください。
3. iPhoneはSafariの共有メニュー → **ホーム画面に追加**。表示される場合は「Webアプリとして開く」をオンにします。AndroidはChromeのメニュー → **アプリをインストール** または **ホーム画面に追加**。
4. 次回からホーム画面の **こもれび** を開きます。ホーム画面版の初回起動時は、ブラウザとは別に接続キーの入力が必要になる場合があります。
5. 相手を選び、入力して送信します。Mockバッジが表示されている間は実際のWeChatへは送信されません。

セッションは12時間で期限切れとなり、Windows側アプリの再起動でも失効します。期限切れ後は接続キーを再入力します。画面を閉じている間のPush通知は未対応です。接続が切れた際に成功表示や自動再送はしません。

## Windowsの公開設定

本人はこの方式への外部公開を許可しています。他の環境では公開の許可を得てから enable-public を実行してください。

~~~powershell
# リポジトリのルートから
cd wechat-chat
.\scripts\install-resident.ps1
.\.venv\Scripts\python.exe scripts/mobile-access.py enable-public
.\scripts\stop.ps1
.\scripts\start.ps1 -NoBrowser
~~~

enable-public は起動中アプリの認証・管理/送信API・非公開ファイルの保護を確認してから、このアプリのポートだけFunnelに切り替えます。別アプリのルートは上書きしません。Tailscale管理画面で有効化を求められた場合は、本人が認証・有効化を行った後に再実行します。

ログイン画面・静的PWAファイル・固定のヘルスチェック応答はインターネットからアクセス可能です。会話・検索・送信・管理API・WebSocketは引き続きアプリ認証が必要です。Funnel自体はアプリの認証を代行しません。

バックエンドは127.0.0.1:8765のみで待ち受けます。ルーターのポート転送は使いません。HTTPSセッションはSecure・HttpOnly・SameSite=Strictとし、Host/Originは実際のURLだけ許可します。転送ヘッダーのIPは信頼しません。本文は実データ量32KiB・読み取り10秒以内、同時接続64、WebSocket受信サイズ4KiBに制限します。失敗ログインと正しいログインの試行回数制限を分け、外部の失敗試行で本人を締め出さないようにしています。

Funnel中継は通信内容を復号せず、TLSはWindows上で終端します。履歴の保存先はWindowsのSQLiteです。Funnelはベータ機能で帯域制限があり、Windows・Tailscale・中継サービスの稼働に依存します。公開直後はDNSの反映に最大10分程度かかる場合があります。依存ソフトウェアは更新し、不要になったら公開を解除してください。[Funnel公式説明](https://tailscale.com/docs/features/tailscale-funnel)

## 状態確認・検証・公開解除

~~~powershell
.\.venv\Scripts\python.exe scripts/resident.py status
.\.venv\Scripts\python.exe scripts/mobile-access.py status

# 公開DNSの中継経由で検証（PC内のTailscale経路への近道を避ける）
.\.venv\Scripts\python.exe scripts/verify-mobile.py --public
.\.venv\Scripts\python.exe scripts/verify-mobile.py --public --mock-send

# 公開を止め、Tailscale内だけから使う状態に戻す
.\.venv\Scripts\python.exe scripts/mobile-access.py enable
.\scripts\stop.ps1
.\scripts\start.ps1 -NoBrowser

# 携帯用の中継自体を解除（履歴は保持）
.\.venv\Scripts\python.exe scripts/mobile-access.py disable
.\scripts\stop.ps1
.\scripts\start.ps1 -NoBrowser
~~~

status の funnel: true / access_mode: public が公開状態です。.runtime/mobile.json に端末固有のURLとモードを保存します。enable は従来のプライベートServeに戻す操作です。その場合は携帯にもTailscale接続が必要になります。別アプリの設定を消す serve reset / funnel reset は使用しません。

verify-mobile.py --public はGoogleの公開DNSに公開ホスト名だけを照会し、検証プロセス内で接続先をFunnelの公開IPに固定します。Host・TLS SNIは元の名前を維持し、証明書検証を無効にしません。接続キーとMock本文は自分のHTTPS接続先以外へ送信しません。

## 検証範囲

このPCから公開DNSで取得したFunnel中継2系統のHTTPS応答を確認し、公開経路でログイン・Secure Cookie・WebSocket・Mockグループの受信と送信・ログアウトを確認しました。詳細は [TEST_RESULTS.md](../TEST_RESULTS.md)。iPhone / AndroidでのPWAインストール・携帯回線・OSのキーボードは、このPCのChromeテストとは別に確認が必要です。

参考: [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel)、[iPhoneでWebサイトをアプリにする（Apple）](https://support.apple.com/ja-jp/guide/iphone/iphea86e5236/ios)。
