# こもれび — Personal WeChat Bridge

個人用WeChatのための、日本語・レスポンシブPWAです。既存の請求書アプリから独立した `wechat-chat/` に実装しています。

**Mockモードは起動・送受信・履歴保存・ブラウザテスト済みです。Windows版WeChatとの実送受信はまだ完成していません。** 実機の検証状況は [WECHAT_INTEGRATION_STATUS.md](WECHAT_INTEGRATION_STATUS.md) を確認してください。

このPCではWeixin 4.1.15.56と、本人がダウングレードした4.1.8.107の両方で、ログイン後のUIA本文取得ができませんでした。wxauto4 41.1.7も隔離環境で読み取りを確認しましたが、画面部品は公開されません。補助として、Windows内のOCRで表示中の文字を読み、確認して保存する機能を追加しました。**自動同期・実送信は無効です。OCRを恒久的な同期方式にはしません。** [画面OCRのセットアップ・使い方](docs/SCREEN_OCR.md)

## AIを前提にした操作のプレビュー

- **対応すること**: 返信・確認の候補を理由付きで優先度順に整理。優先度は手動変更・保存が可能。
- **返信案**: 定型の案を編集用下書きへ追加。既存下書きを残し、送信は本人が別に操作。
- **タスク**: 元のメッセージを確認し、タイトルと任意の期限を編集して保存。未完了／完了、元の発言への移動に対応。

現在は端末内の簡易ルールと定型文です。**AI未接続**であり、会話の意味をモデルが理解しているわけではありません。モデル・外部タスクサービスは未選定です。範囲と今後の実装は [AI中心のUIと拡張方針](docs/AI_EXTENSION.md) を参照してください。

## すぐ起動する（Windows）

Node.js 20.9以上、Python 3.10以上、PowerShellが必要です。今回の検証環境はWindows 11 / Node 24.18.1 / Python 3.10.6です。

```powershell
# リポジトリのルートから
cd wechat-chat
.\scripts\setup.ps1
.\scripts\start.ps1
```

1. `http://127.0.0.1:8765` を開きます。
2. `.runtime/access-token.txt` の接続キーを画面に貼り付けます。これはこのアプリのローカル接続キーです。WeChatのパスワードは入力しません。
3. 初期画面「対応すること」で優先度・返信案・タスク候補を試せます。「チャット」から「林 佳怡」などのサンプル会話を選ぶとMock返信できます。実際のWeChatには送信されません。
4. 設定の「Mockテスト」で受信・切断・再接続・確認不能・失敗を試せます。新着はWebSocketで反映します。

初回のみ依存をインストール・ビルドします。セットアップ済みなら `start.ps1` だけで起動します。`.env` の `WECHAT_ACCESS_TOKEN` にキーを指定した場合は、その値を使います。キーは共有・コミットしないでください。

```powershell
.\scripts\stop.ps1          # このプロジェクトが起動したプロセスだけを停止
.\scripts\dev.ps1           # Next.js開発画面 http://127.0.0.1:3100
.\scripts\test.ps1          # Python・型チェック・本番ビルド・ブラウザテスト
```

詳細は [Windowsセットアップ](docs/WINDOWS_SETUP.md) を参照してください。スクリプトが実行ポリシーで拒否される環境では、ポリシーを変更せず、同文書の手動コマンドを使用できます。

## Windowsに常駐して携帯から使う

Windowsがサーバーを兼ねる構成です。Synologyへの配置は行いません。本人の許可に基づき、携帯のVPNが不要なFunnel＋アプリ認証へ切り替えました。携帯には「こもれび」PWAを追加し、通常のHTTPSで閲覧・送信します。Windowsの電源・ログイン・ネットワーク接続が必要です。

```powershell
.\scripts\install-resident.ps1     # ログイン時の自動起動を登録し、今すぐ開始
.\.venv\Scripts\python.exe scripts/mobile-access.py enable-public  # 外部公開を許可した環境だけ
.\scripts\stop.ps1
.\scripts\start.ps1 -NoBrowser     # 設定した携帯用URLを反映
```

このPCで常駐・自動復旧を検証済みです。**Funnelの公開経路でHTTPS・認証・WebSocket・Mock送受信を検証しました。** 携帯用URLはアプリの設定画面、または稼働PCの `.runtime/mobile.json` で確認できます。ログイン画面はインターネットから開けますが、会話・送信・管理機能は認証必須です。PWAはApp Store配布用のネイティブアプリではありません。詳細は [携帯セットアップ](docs/MOBILE_SETUP.md)。将来のAI接続は [AI拡張方針](docs/AI_EXTENSION.md) を参照してください。

## AIアシスト

会話ヘッダーの「AI」から、翻訳・返信案・要約／決定事項・タスク抽出を使います。送る本文を選択して確認した後にだけ実行し、生成結果は下書きやタスク候補として扱います。送信・タスク登録は本人の別操作です。

外部AIは既定で無効です。PC側の `.env` に `OPENAI_API_KEY` と対応する `OPENAI_MODEL` を指定し、本人が利用する場合のみ `WECHAT_AI_ENABLED=true` にして再起動します。キーはブラウザへ渡しません。実AIの疎通・翻訳品質は未検証で、合成応答による処理テストを完了しています。設定・データ範囲・制限は [AIアシスト](docs/AI_EXTENSION.md) を参照してください。

## 実装された機能

無料版wxauto4の実機試験は [検証記録](docs/FREE_WXAUTO4_TRIAL.md)、SiverWXBot Plusの再利用調査は [アーキテクチャ](docs/architecture.md) にまとめています。現在の実機では無料版の初期化が失敗しており、実メッセージを同期できたとは扱いません。アプリ設定にも日時付きの試験結果を表示します。

- 個人／グループ一覧、未読・グループ絞り込み、チャット名検索、本文検索（日本語・中国語）
- 会話表示、テキスト返信、Ctrl / ⌘ + Enter送信、IMEのEnterだけでは送信しない操作
- ライト／ダーク／OS連動テーマ、スマートフォン向け画面、PWAマニフェスト・アイコン・オフライン画面
- SQLiteマイグレーション、永続履歴、チャット単位の重複排除、読み取りカーソル
- 永続FIFOキュー、宛先ID・名称の再照合、受付IDによる重複送信防止、送信結果照会
- WebSocketの再接続・再取得、バックエンド切断表示、履歴の取得範囲表示
- Windowsログイン時の自動起動、バックエンド障害の再起動、携帯PWAのインストール案内
- 管理・読み取り・送信APIの認証、HttpOnlyセッション、Origin照合、接続元Host制限
- Mock Adapterと独立したWindows UIA Adapter。後者の対応範囲は連携状況ファイルに記載

### 送信状態

| 状態 | 意味 |
|---|---|
| 未送信 / `pending` | SQLiteキューに受付済み。まだAdapterに渡していない |
| 送信処理中 / `sending` | 1件ずつ処理。送信前に宛先を再確認 |
| 送信確認済み / `confirmed` | Adapterが宛先・内容・方向を一致確認した結果。相手の既読を意味しない |
| 確認不能 / `unknown` | 結果不明・タイムアウト・送信処理中に再起動。自動再送しない |
| 失敗 / `failed` | 宛先不一致、送信前の切断など、送信不可を確認。自動再送しない |

オフラインで新しく送信するとAPIは409で拒否します。キュー受付後に切断した場合、まだ送信処理を始めていない `pending` のみ接続回復後に処理します。`sending` のまま停止したものは再起動時に `unknown` へ移します。受付HTTP応答が失われた場合、UIは同じ受付IDで**状態だけを照会**し、勝手に再POSTしません。

### 履歴と重複排除

`external_message_id` がある場合は `(chat_id, external_message_id)` を一意にします。外部IDがない場合はチャット・送信者・方向・本文・種別・日時・同一画面内の出現識別子をSHA-256で組み合わせます。日時や出現識別子が不明だと同じ文面の別メッセージを取りこぼす可能性があり、UI再生成で識別子が変わると重複が残り得ます。`identity_quality` と `timestamp_quality` で精度を区別します。実機での精度は未検証です。

Mockのサンプル全件取得と実WeChatの全履歴同期を混同しません。UI経由で未取得の履歴は「未取得」と表示し、検索は保存済みデータだけを対象とします。検索は最大100件、会話は100件ずつ取得します。

## 構成

```text
wechat-chat/
  frontend/                  Next.js / React / TypeScript / Tailwind / PWA
    src/app/                 チャット・検索・設定
    src/lib/api.ts           型定義・認証付きAPIクライアント
    public/                  PWAアイコン・Service Worker
    tests/                   PlaywrightのMockブラウザ検証
  backend/
    app/adapters/base.py      WeChatAdapterの抽象契約
    app/adapters/mock.py      ローカルMock
    app/adapters/windows_*   Windows接続診断（送信無効）
    app/database.py           永続化・重複排除・キュー
    app/engine.py             同期・送信・WebSocketイベント
    app/main.py               FastAPI
    app/security.py           認証・Origin照合
    migrations/              バージョン付きSQLiteマイグレーション
    tests/                   API・障害・永続化のテスト
  scripts/                   セットアップ・起動・停止・検証
  data/                      実行時のSQLite（Git対象外）
  .runtime/                  接続キー・PID・内容を含まない起動ログ（Git対象外）
```

本番用起動ではNext.jsを静的ビルドし、FastAPIが画面・API・WebSocketを**同じlocalhostポート**で配信します。Next.jsサーバーを別途運用する必要がありません。開発時のみNext.jsのrewriteでローカルAPIへ接続します。SQLiteとUI操作の直列性を保つため、バックエンドは**単一プロセス・workers=1**で運用してください。同じDBを複数サーバーから開かないでください。

画像・音声・ファイルはまだ未対応です。`message_type` とAdapterの境界を用意しており、将来メディア保存や翻訳を拡張できます。AI・外部APIへのメッセージ転送は実装していません。

## API

`GET /api/health` とログイン以外のAPIは認証必須です。ブラウザはHttpOnly Cookie、ローカル連携テストは `Authorization: Bearer <接続キー>` を使用できます。APIレスポンスは `no-store`、アクセスログは無効です。

| エンドポイント | 用途 |
|---|---|
| `POST /api/auth/login`, `/api/auth/logout` | ローカルセッション（12時間、再起動・ログアウトで失効） |
| `GET /api/status`, `/api/chats` | 接続状態・チャット一覧 |
| `GET /api/chats/{id}/messages?before=...` | 保存済み履歴のページ取得 |
| `POST /api/chats/{id}/read` | 表示済みIDまで既読（このアプリ内のみ） |
| `POST /api/chats/{id}/send` | 宛先ID・名称・UUID受付ID付き送信受付 |
| `GET /api/queue`, `/api/requests/{uuid}` | 送信状態・個別受付照会 |
| `GET /api/search?q=...` | 保存済み本文を検索 |
| `POST /api/sync` | Adapterから取得可能範囲を再取得 |
| `POST /api/mock` | Mock専用の受信・接続・結果シミュレーション |
| `WS /ws` | 認証・Origin照合付きの変更通知。接続後にRESTで再取得 |

## セキュリティとリモート利用

バックエンドは `127.0.0.1` のみで待ち受けます。本人の許可を得て、携帯接続用のログイン画面をFunnelで外部公開しました。会話・API・WebSocketにはアプリ認証が必要です。Funnelは暗号化通信を中継し、履歴はWindowsに保存します。外部AI転送・実WeChat認証・実送信は行っていません。

- WeChat認証は正規クライアントで本人が行います。資格情報の収集、プロセス注入、DLL注入、復号、通信偽装はありません。
- `data/`、`.runtime/`、`.env` はこのPCの本人だけがアクセスできる場所で管理し、BitLocker等のOSディスク暗号化を前提にします。SQLite自体の暗号化（SQLCipher）は未導入です。
- Service Workerはオフライン案内とアイコンのみ保存します。チャット本文・API・セッションはキャッシュしません。テーマだけlocalStorageに保存します。
- `scripts/mobile-access.py enable-public` は認証・非公開ファイルの保護を確認してから、このアプリのルートだけFunnelに切り替えます。`enable` はTailscale内限定のServeへ戻す操作です。別アプリのルートは上書きしません。ルーターのポート転送は不要です。
- `.runtime/mobile.json` の検証済みHTTPS URLから許可Origin・Hostを追加します。HTTPSでの認証Cookieには自動でSecure属性が付き、localhostも引き続き利用できます。任意の転送ヘッダーは信頼しません。別のHTTPS構成を手動設定する場合は `.env` の許可リスト・Secure設定を使用します。
- このPCからFunnelの公開IPを使ったHTTPS・WSS通信を検証済みです。iPhone/Macの実機、携帯回線、Safariのインストールは未検証です。ブラウザを閉じた状態でのPush通知は未対応です。

## テスト

[TEST_RESULTS.md](TEST_RESULTS.md) に成功・失敗・未検証を分けて記載しています。テストは別の一時DBを使い、実WeChatへ送信しません。ブラウザ検証はWindowsのインストール済みGoogle Chromeを使います。Chromeがない場合はPlaywrightの設定から `channel: 'chrome'` を外し、`npx playwright install chromium` を実行してください。

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm run typecheck
npm run build
npm run test:e2e
npm audit
```

依存は `package-lock.json` と `backend/requirements-lock.txt` で固定しています。Windows UIA依存は別の `requirements-windows.txt` です。既存リポジトリの依存は変更していません。親の `tsconfig.json` には新しい独立プロジェクトの除外だけを追加しています。
