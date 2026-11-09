# こもれび — 次のAIへの引き継ぎ

更新日: 2026-11-09。保存対象: `wechat-chat/` と、親のTypeScriptからこの独立アプリを除外する設定。

GitHub: https://github.com/xxx83482904-glitch/triangle-invoice-os ／ ブランチ: `codex/komorebi-wechat-mvp` ／ 開発対象: `wechat-chat/`。既存のmainにはまだこのアプリをマージしていません。

```powershell
git clone --branch codex/komorebi-wechat-mvp --single-branch https://github.com/xxx83482904-glitch/triangle-invoice-os.git
cd triangle-invoice-os/wechat-chat
```

## まず把握すること

**Mockの双方向チャットPWAは実装・起動・テスト済み。実際の個人WeChatの送受信は未完成です。**

ユーザーの最終目的は、今の個人WeChatアカウント・友達・グループを変えずに、自作の日本語アプリから会話を確認して返信することです。現在の成果は共通基盤とMock動作、Windows常駐、携帯からの接続までです。実WeChatへの橋渡しが次の主要課題です。

開発指示は設計だけで終わらず実装・起動・テストすること、実機未検証を成功としないことです。画像・ファイル・音声・日中翻訳・AI返信案は将来の拡張対象です。

## 最新の追加要望とUI

ユーザーは「AIを前提に、返信の急ぎ順で並べ替え、返信案を出し、次にやることをタスクへ入れたい」と指定した。初期画面を **対応すること** に変更し、理由付きの優先度・手動調整、定型返信案→編集用下書き、タスク候補→本人確定→SQLite保存、未完了／完了と元メッセージへの移動を実装した。チャット一覧も優先度順にできる。

**実AIは未接続。** `backend/app/assistance.py` の `LocalRulesProvider` が保存済み直近50件を簡易判定し、返信案・タスク名は定型文を返す。画面には「AI未接続」と表示し、外部への本文転送はしない。AIを追加する次の作業者は `docs/AI_EXTENSION.md` のUI仕様とデータ制約を必ず読む。

新しいコードは `frontend/src/components/attention-center.tsx`、`frontend/src/app/attention.css`、`backend/app/assistance.py`、`003_assistance_tasks.sql`。`/api/attention`、`/api/tasks`、`/api/chats/{id}/priority` を追加。タスクは1受信メッセージにつき1件。登録時のタイトル・期限編集と完了切替は可能、登録後の編集・削除・通知・外部タスク連携は未実装。

既存下書きの上書き、自動送信、タスク候補の自動登録をしない。送信が未確定／失敗の場合は状態確認を優先。タスク作成と返信済みは別状態。手動優先度は新着で勝手に書き換えない。

## ユーザーが決めた運用

- **Windows常駐**。WindowsがAPI・DB・画面配信を兼ねる。Synologyへのデプロイ案は取りやめた。
- 携帯にはホーム画面から開くPWAを追加する。ネイティブのApp Store / Google Play配布物は作っていない。
- 携帯で毎回VPNを接続する運用はユーザーが却下。現在は **Windows側のTailscale Funnel + アプリ認証** で通常のHTTPSアクセスに変更済み。
- 本人はこのアプリの外部公開を明示的に許可済み。ログイン画面・静的ファイル・固定のヘルス応答が公開され、会話・管理・送信・WebSocketは認証必須。
- Windowsが起動・ログイン・ネット接続している必要がある。スリープやサインアウト中は利用できない。電源設定や無人ログインは変更していない。
- WeChatログインは本人が後日行う方針。最後の実機観測はQRコード認証待ち。実送信の許可はまだない。
- 将来AIと接続したい意向はあるが、AIへの会話転送・APIキー設定・自動返信は未実装。導入サービスも未定。

## 再開時の読む順序

1. このファイルと `AGENTS.md`
2. `README.md` — 起動・API・送信状態・セキュリティ
3. `WECHAT_INTEGRATION_STATUS.md` — 実装済み／実機確認／未対応／ライブラリ調査
4. `TEST_RESULTS.md` — 成功／失敗／未検証の区別
5. `docs/WINDOWS_SETUP.md`、`docs/MOBILE_SETUP.md`、`docs/AI_EXTENSION.md`

別AIへ依頼するときの短い文面は `NEXT_AI_PROMPT.md` にあります。

## 新しいチェックアウトで起動する

Windows、Node.js 20.9以上、Python 3.10以上、PowerShellを使用。実際に検証した環境はWindows 11 / Node 24.18.1 / Python 3.10.6です。

```powershell
# リポジトリのルートから
cd wechat-chat
.\scripts\setup.ps1
.\scripts\start.ps1
```

`http://127.0.0.1:8765` を開く。初回にランダム生成される `.runtime/access-token.txt` の接続キーでログインする。`.env` に独自キーを設定している場合はそちらが優先される。新しいチェックアウトでは新しいキーとMock DBを生成する。稼働PCのキー・DB・Tailscale設定はGitから復元されない。

セットアップはvenv、固定Python依存、npm ci、Next.js静的ビルドを行う。既存 `.env` は上書きしない。Windows UIA診断は追加依存が必要:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-windows.txt
.\.venv\Scripts\python.exe scripts/diagnose-wechat.py
```

同じPCで既存アプリが動いている場合、新しいチェックアウトを同じ8765ポートで二重起動しない。テスト専用サーバーは8877と一時DBを使う。既存DBを複数のサーバーから開かない。

## 技術構成と主要ファイル

| 場所 | 役割 |
|---|---|
| `frontend/src/app/page.tsx` | 日本語の会話一覧、個人/グループ会話、検索、設定、ログイン、送信状態 |
| `frontend/src/components/mobile-install.tsx` | PWA追加案内、private/publicに応じた接続方法 |
| `frontend/src/lib/api.ts` | 型、認証付きfetch、表示用のエラー文言 |
| `frontend/next.config.ts` | Next.js 16.4.5。開発はrewrite、本番は静的export |
| `frontend/public/sw.js` | オフライン案内・アイコンのみキャッシュ。本文・API・キーは保存しない |
| `backend/app/main.py` | FastAPI、REST、WebSocket、静的ファイル配信 |
| `backend/app/security.py` | 接続キー照合、メモリ上のセッション、Origin照合、試行回数制限 |
| `backend/app/body_limit.py` | chunkedを含む32KiBの本文上限と読み取り期限 |
| `backend/app/database.py` / `migrations/` | SQLite、重複排除、永続キュー、既読カーソル |
| `backend/app/engine.py` | 同期、FIFO送信処理、受信監視、変更イベント |
| `backend/app/adapters/base.py` | WeChatAdapterの抽象契約とメッセージ等の型 |
| `backend/app/adapters/mock.py` | 架空の個人3・グループ2、受信、切断、送信結果の再現 |
| `backend/app/adapters/windows_uia.py` | Windows診断のラッパー。実送受信は明示的に拒否 |
| `backend/app/adapters/windows_probe.py` | exe版・ウィンドウ・UIA状態の読み取り専用診断 |
| `scripts/resident.py` | 常駐監視、単一インスタンス、障害再起動、Windows Job Object |
| `scripts/mobile-access.py` | Serve/Funnel設定、公開前の認証チェック、別ルートの上書き防止 |
| `scripts/verify-mobile.py` | HTTPS/WSS確認。公開DNSのIP経由でFunnelを検証可能 |

React 19.2.4 / TypeScript 5.9.3 / Tailwind 4、Python FastAPI / SQLite / Uvicorn / asyncioを使用。依存の正はそれぞれのlockファイル。通常運用ではNext.jsのサーバーは不要で、FastAPIが `frontend/out/` を配信する。バックエンドはworkers=1、待受は127.0.0.1:8765。

## 維持する挙動

- 送信状態は `pending / sending / confirmed / unknown / failed`。画面表示は未送信／送信処理中／送信確認済み／確認不能／失敗。
- 受付時とAdapter呼び出し前に宛先ID・名称を照合する。名前だけで実WeChatへ送らない。
- `sending` のまま停止したキューは再起動時に `unknown` とする。確認不能・失敗を自動再送しない。まだ処理を開始していないpendingは復帰後に処理する。
- UUID受付IDで二重受付を防ぐ。HTTP応答が失われた場合、画面は同じIDのGET照会だけを行い、勝手に再POSTしない。
- 外部IDがあるメッセージはチャット単位で一意。外部IDがない場合は指紋で判定するが、完全精度を保証しない。`identity_quality` / `timestamp_quality`を保持する。
- 取得済み範囲だけ表示・検索する。「完全同期」と誤表示しない。
- WebSocketは変更通知で、本文は認証付きRESTから取得する。切断時は送信ボタンを無効化し、下書きを保持する。
- 本文・キーをログへ出さない。セッションはHttpOnly、HTTPSはSecure、SameSite=Strict。12時間とプロセス再起動で失効。失敗ログインと成功ログインは別枠。
- 本文上限32KiB、読み取り10秒、Uvicorn同時接続64、WS受信4KiB、認証済みWS接続20まで。

## 実WeChatの現在地

実機のWindows版Weixinは **4.1.15.56**。UIA診断でプロセスと版、ログイン待機、応答の有無を確認した。最後の観測はQRコード認証待ちで、本人はログインを後日に延期した。

**チャット一覧・本文・送信者・時刻・方向・安全な宛先IDの取得は未実装。送信も未実装。** 現在のWindowsUIAAdapterは `can_read=false` / `can_send=false` を維持する。

wxauto / wxauto4 / wxautox4の資料を調査したが導入していない。調査時のwxauto4無料版の公称対応は4.1.8.107までで、この実機は範囲外。Plus版は購入・アクティベーションと条件確認が必要で、契約を行っていない。導入判断の一次資料は連携状況ファイルに記載。依存候補の版・ライセンスは次回作業時に再確認する。

プロセス注入・DLL注入・認証回避・DB復号・通信偽装は不採用。プロセスはQUERY_LIMITED_INFORMATIONだけで照会し、メモリを読まない。UIが必要な情報を公開していない場合は未対応として止める。

## 次に進める作業

1. **実WeChatの読み取り可否を確立する。** 本人が正規クライアントで手動ログインし、検証可能なテスト会話を表示してから、4.1.15.56のUIAで取得可能項目を調べる。本文や個人情報を診断ログ・Gitへ保存しない。
2. 取得可能なら版別のChat Discovery / Message ReaderをAdapter内へ実装する。個人・グループ・過去履歴の範囲・時刻・方向・同一文面の別発言・再接続の重複を検証する。
3. **実送信は最後。** 安定した宛先IDと画面の再照合を確立し、本人が指定したテスト相手・本文への送信許可を得てから個人→グループの順に確認する。結果が証明できなければunknownとする。
4. iPhoneでVPNをオフにした携帯回線から、ログイン・ホーム画面追加・キーボード・Mock返信を本人と確認する。Chromeのモバイル幅の成功をiPhone実機成功と呼ばない。
5. AI中心のUIは先に実装済み。`docs/AI_EXTENSION.md` に沿って、簡易Providerを実AIへ拡張する。文脈による優先順位・返信案・タスク候補を本人に提示し、手動確認を残す。対象会話・履歴範囲・転送先を確認するまで外部AI転送は有効にしない。自動返信はしない。

## テスト・検証結果

最終の回帰テストは **Python 54件、Chrome E2E 15件、合計69件成功**。本番ビルドとTypeScript検査も成功。Funnelの公開DNSで得た2つの中継IPを使い、TLS証明書検証、未認証拒否、ログイン、WSS、Mockグループの受信・送信、ログアウトを確認した。Chromeでも公開IP経由で携帯表示とVPN不要の案内を確認した。

```powershell
# wechat-chatから
.\scripts\test.ps1
# 個別に実行する場合
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

PythonにはStarlette TestClient/httpxに関する非推奨警告が1件ある。最終テストに残っている失敗はない。公開切替直後の片系統のTLS失敗は反映後に解消した。詳細な途中の修正と各検証範囲はTEST_RESULTSを参照。

未検証: 実WeChat送受信、iPhone/Mac実機、携帯回線、実際の再ログインによる自動起動、PCスリープ・画面ロック後のWeChat操作。未対応: バックグラウンドPush、画像/音声/ファイル、実AI推論、SQLite自体の暗号化。

## 稼働環境とGitの違い

- Gitにないもの: `.env`、`.runtime/`、`data/`、DB、キー、ログ、venv、node_modules、ビルド結果、テスト画像。接続キーを公開リポジトリや引き継ぎ文へ貼らない。
- 稼働URL・公開モードは元のPCの `.runtime/mobile.json`。生成キーは `.runtime/access-token.txt`、監視状態は `.runtime/resident/state.json`。同PCの詳細はGit対象外の `.runtime/HANDOFF_LOCAL.md`。
- `.runtime`のコピーで別PCへそのまま公開設定を移植しない。新しいPCではTailscaleの本人認証・端末固有URLを設定する。
- インストール済み自動起動は本人のスタートアップの `Komorebi Chat.lnk`。pythonwで対話ユーザーセッションに起動し、Windowsサービスは作っていない。
- 常駐停止は `scripts/stop.ps1`。解除は `scripts/uninstall-resident.ps1`。公開を私設接続へ戻すのは `mobile-access.py enable`、中継解除は `disable`。別アプリの設定を消すresetは使わない。
- 任意のアイコン再生成スクリプトは `@napi-rs/canvas` を必要とする。通常セットアップは既存PNGを使うため不要。再生成時は依存を明示的に追加・確認する。
- 親のmainには別アプリのSynology自動デプロイがある。この引き継ぎ用ブランチをmainへ無断でマージしない。
- GitHubへの保存は最新origin/mainを基にした別worktreeで行った。元の稼働中フォルダーのブランチ・未追跡ファイル・運用設定は切り替えていない。再開は上のclone手順か専用ブランチのworktreeで行い、稼働中フォルダーを無理にcheckoutしない。

この文書は会話全体の代わりに渡せるよう、実装・運用・許可の範囲をまとめたものです。現状を実WeChat連携の完成版として紹介しないでください。
