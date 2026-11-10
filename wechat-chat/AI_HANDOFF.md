# こもれび — 開発引き継ぎ

更新日: 2026-11-10。最新の実装基準は `4119918d63dad2377be46764f788c7b9b2980295`。この文書を保存する後続コミットは引き継ぎ資料の更新であり、直接同期の新実装ではありません。

## 現在地

**次の目標は、WeChatのローカル履歴から、画面を使わずにこもれびへ直接同期することです。直接同期は未実装で、ファイルから取り込めた本文は0件です。** 保存先と形式を調査済みですが、現行DB・旧DB・バックアップをそのまま読める経路は確認できていません。

本人の最新指示は「WeChatの画面経由で取得しない」。常駐版は `WECHAT_UI_ACCESS_ENABLED=false` で、保存済み会話の閲覧・検索・取得済み添付の配信だけを行います。新着取得、履歴巡回、画面診断、OCR、実送信は停止中です。再起動しても画面取得を再開しない実装を検証済みです。

以前はwxautox4 Plusによる個人・グループの読み取り、画像・ファイル取得、ボイス文字起こし、本人が許可した自分宛てのテキスト1件の送信に成功しました。これは**過去のUI方式の実績**です。現在の直接同期成功や、UI方式を再開する許可ではありません。

## リポジトリと作業範囲

- [GitHub](https://github.com/xxx83482904-glitch/triangle-invoice-os)
- ブランチ: `codex/komorebi-wechat-mvp`
- 開発対象: `wechat-chat/`。親は別の請求書アプリです。
- mainには別アプリのSynologyデプロイworkflowがあります。mainへのマージ・workflow実行は依頼されていません。
- 同じPCでは既存の専用worktreeを使い、稼働フォルダーをcheckoutし直さないでください。

```powershell
git clone --branch codex/komorebi-wechat-mvp --single-branch https://github.com/xxx83482904-glitch/triangle-invoice-os.git
cd triangle-invoice-os/wechat-chat
```

読む順序: `AGENTS.md` → 本文書 → `docs/LOCAL_HISTORY_STORAGE.md` → `WECHAT_INTEGRATION_STATUS.md` → `TEST_RESULTS.md` → `docs/architecture.md`。最新の停止条件は古い実機記録より優先します。

元のPCの絶対パス、実DB、バックアップ保存先、接続設定の所在は **Git対象外の `.runtime/HANDOFF_LOCAL.md`** に記載しています。実パスを含む調査報告は `.runtime/HISTORY_STORAGE_REPORT.md`。別PCやクラウドAIにはこれらが自動で渡るわけではありません。

## 保存場所の実測

| 対象 | 確認した内容 | まだできないこと |
|---|---|---|
| `%USERPROFILE%/xwechat_files/<account>/db_storage/message/message_0.db`〜`message_5.db` | 本文DB候補6ファイル。PC移行完了付近に更新 | 通常SQLiteでは開けない |
| 現行 `db_storage` 全体 | contact・session等を含む29DBすべてで通常SQLiteヘッダーなし、スキーマ読取失敗 | 本文・会話ID・件数の読取 |
| 旧 `Documents/WeChat Files/<account>/Msg` | 選択した本文・基本情報DB9個も同様 | 旧DBの本文取込 |
| 本人指定の `xwechat_files/Backup/...` | 20,824ファイル、148,043,691,223論理バイト。20,818ヘッダーがRMFH | 専用バックアップ本文の取込 |
| `temp/phone/migration.db` | 通常SQLite。移行タスク用の2テーブル | 会話本文のエクスポートとして利用できない |
| `msg/attach`・`file`・`video`・`migrate` | 媒体の保存領域が存在 | 全メッセージへの対応付け・ボイス原音取得 |

バックアップの1,734はChatPackageを持つフォルダー数です。読めた会話数や、完全な会話数ではありません。本人はスマートフォンの全履歴をPCへ移行済みと報告し、PC側の移行完了も以前に確認しました。**PCへの移行完了と、こもれびへの取り込み完了は別です。**

調査はファイル配置・サイズ・更新時刻・16バイトのヘッダーと読み取り専用のスキーマ照会まで。`mode=ro&immutable=1` の形式検査はWALを反映しないため、最新履歴の一貫したスナップショットではありません。暗号化形式と整合する観測ですが、具体的な鍵・暗号設定を実証したわけではありません。鍵抽出・復号は行っていません。

根拠と一次資料へのリンクは `docs/LOCAL_HISTORY_STORAGE.md` にあります。SiverWXBot Plus / wxautoは画面操作を中心とする参考実装で、ネイティブ履歴DBの直接読取を解決するものとは確認していません。

## 次の開発

1. **直接読取の条件を確立する。** 対応版・ライセンス・鍵の取得方法・外部通信の有無まで調査する。本文付きの正規エクスポート、利用権のある読み取り可能なDB、非侵襲的な読取方法が候補。暗号化DBを通常SQLiteとして開く試行を繰り返すだけで終えない。
2. 条件を満たす方法があれば、UI Adapterと独立したReader／Importerを追加する。まず一時DBへ少量取り込み、会話ID・送信者・時刻・方向・本文・添付対応を実データと照合する。取得できない値は推測で確定しない。
3. 元DBを変更せず、一貫した読み取りコピーを用いる。WAL、複数DB、アカウント切替、途中停止、再起動、再実行、同文の別発言を扱う。元のメッセージIDと出典・取得範囲を保存して重複を防ぐ。原本への書き戻しをしない。
4. 一括インポート後の増分取得・永続カーソル・切断からの回復を実装する。初回履歴には通知や未読を発生させず、新着だけ通知する。ファイルが読めたことだけで「全会話・全期間・リアルタイム同期済み」と表示しない。
5. 既存UI由来の会話・メッセージとの安全な対応付けを検証する。名称一致だけで統合・送信先変換しない。既存の部分履歴、キュー、添付、通知を保持する。
6. 読み取りの直接同期と送信は別問題として扱う。DBへの直接書き込みで送信を実装しない。現在の実送信停止を勝手に解除しない。追加実テスト送信には宛先・本文を含む本人の明示許可が必要。

この条件で読める方法を見つけられなければ、何が不足するかを具体的に報告してください。実装可能な部分は一時DB・合成データで進められますが、ダミーのImporterを実データの直接同期成功として報告しないでください。

前回の終了直前に検索結果で見つけた未評価の候補は [ExportWeChat CLI](https://exportwechat.com/cli-usage)、[GreenBubblesの形式説明](https://github.com/bojieli/greenbubbles/blob/main/docs/WECHAT_DATABASE_FORMAT.md) です。**ソース・鍵取得経路・Windows互換性・ライセンスは未監査で、導入も実行もしていません。** 名前や検索結果だけで安全・対応済みとは扱わないでください。

## 維持する制約

- UIA、wxauto、wxautox4、OCR、SDKによる会話の画面巡回を再開しない。以前の私有診断スクリプトを実行しない。
- プロセス／DLL注入、認証回避、不正な復号、通信偽装は採用しない。これまでの非侵襲方針では、プロセスメモリからの鍵抽出も採用していない。「直接同期」という目標だけを制約解除と解釈しない。
- WeChat認証・購入・ライセンス操作は本人が行う。認証コードやキーを再掲しない。
- 実送信は過去の自分宛て1件のみ。永続送信試行記録も1件。前回のテストを再送しない。
- 未送信／処理中／確認済み／確認不能／失敗を維持。確認不能・失敗を自動再送しない。送信時の宛先ID・名称の照合を省略しない。
- 外部AIは無効のまま。会話・添付を外部AIや解析サービスへ勝手に送信しない。AI生成結果は下書き／候補とし、送信・タスク登録は本人が確定する。
- `.env`、`.runtime/`、`data/`、DB、ログ、接続キー、会話本文、認証情報はGitや公開の引き継ぎ文に含めない。
- 現在のWindows常駐と認証付きTailscale Funnel公開は許可済み。通常の修正・テスト・同じアプリの再起動に再承認は不要。別の公開先を勝手に追加しない。

## 実装の構成

Next.js 16.4.5 / React 19.2.4 / TypeScript / Tailwind / PWA、Python 3.10 / FastAPI / SQLite / WebSocket。フロントは静的exportをFastAPIから配信し、通常運用でNext.jsサーバーは不要。127.0.0.1:8765、workers=1。Windowsログイン中に常駐し、携帯は認証付きFunnel HTTPSから接続する構成です。

最後に検証したWeixinは4.1.8.107、中国語UI。wxautox4 Plus 41.2.3は別venvへ導入・本人許可の認証済みですが、現在は起動しません。無料版・UIA・OCRのコードも残っています。

| ファイル | 役割／再利用する箇所 |
|---|---|
| `backend/app/adapters/base.py` | Adapter契約・会話／メッセージ型 |
| `backend/app/adapters/stored_history.py` | 現在の閲覧専用Adapter。SDKを構築せず読取／送信不可を返す |
| `backend/app/config.py`・`main.py` | UI無効設定、Adapter選択、取得API拒否。環境変数省略時はtrueのため、falseの明示設定を落とさない |
| `backend/app/database.py`・`migrations/001`〜`009` | 保存、出典／重複、キュー、添付、通知、履歴フラグ・時系列ページング |
| `backend/app/engine.py` | 非同期同期・送信キュー・更新イベント |
| `backend/app/adapters/plus_core.py`・`plus_history.py` | 過去方式の永続処理・履歴ジョブの参考。UI取得部分は停止したまま |
| `backend/app/media_store.py` | 添付本体のローカル保存と整合性 |
| `frontend/src/components/history-sync.tsx` | 画面取得停止の表示。巡回ボタンを表示しない |
| `frontend/src/app/page.tsx`・`frontend/src/lib/api.ts` | チャット、検索、設定、送信状態、認証付きAPI |
| `scripts/resident.py` | Windows常駐・単一起動・アプリ障害復旧 |
| `scripts/inspect-backup.py` | ネイティブバックアップの形式・件数調査。本文Importerではない |
| `scripts/import-reader-archive.py` | 旧Readerの保存済み履歴の移行用。ネイティブWeChat DBのImporterではない |

UI・API・認証・Mock・DBを作り直す必要はありません。SiverWXBot Plusの再利用調査は `docs/architecture.md`。AI優先度・翻訳・返信案・要約・タスクは `docs/AI_EXTENSION.md`。OpenAI Providerは実装されていますが、稼働環境では外部AI無効・実API未検証です。

Next.js変更前に `frontend/node_modules/next/dist/docs/` の該当ガイドを読んでください。

## 検証済み範囲と未検証

| 対象 | 結果 | 範囲 |
|---|---|---|
| 最終実装のPython回帰 | 成功 | 247件。Starletteの非推奨警告1件 |
| TypeScript・Next.js | 成功 | 型検査・静的export |
| 最後のUI停止変更のChrome検証 | 成功 | 関連2シナリオ。全ブラウザテストを最後に一括再実行したという意味ではない |
| 常駐版のデータ保持 | 成功 | 313メッセージ、85添付レコード、送信キュー1件、通知イベント10件を更新前と同一に保持。保存済み添付本体のハッシュ一致 |
| 画面停止の実運用 | 成功 | UI worker 0、取得関連API 409、携帯幅Chromeで保存履歴閲覧・返信不可。送信POST・外部AI POSTとも0 |
| DB／バックアップの直接本文読取 | 失敗・未対応 | 取得0件。通常SQLiteによる対象スキーマ照会は全件失敗 |
| 全会話・全履歴の直接同期 | 未検証 | 実装・読み出し条件が未確立 |
| 携帯のPush到達・通知音 | 未検証 | 本人が「あとで試す」と回答。Chrome幅の検証は携帯実機の代わりにならない |
| グループ実送信、WeChat再起動復旧、実AI品質、音声原音、メディア送信 | 未検証または未対応 | 過去のMock／合成SDK試験と混同しない |

保存済み43チャット行はUI観測の世代等を含み、43個の一意なWeChat会話や全会話数を証明しません。313行も全履歴取込件数ではありません。詳細と過去の試験は `TEST_RESULTS.md` を参照してください。

## 新しい環境での起動・テスト

Windows、Python 3.10以上、Node.js 20.9以上。既存の稼働PCでは先に私有の `.runtime/HANDOFF_LOCAL.md` を確認してください。新しいチェックアウトはMockの別DB・別キーになります。

```powershell
# wechat-chat/ で実行。新しい環境のMock用。
.\scripts\setup.ps1
.\scripts\start.ps1
# http://127.0.0.1:8765
```

`.env.example` は `WECHAT_ADAPTER=mock`、`WECHAT_UI_ACCESS_ENABLED=false`。セットアップは既存 `.env` を上書きしません。稼働版の `.env`、DB、メディアをMockで置換しないでください。稼働PCで8765ポートへ二重起動しないでください。

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
cd frontend
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
```

テストはMock・一時DB・8877ポートを使います。変更に応じてテストを選び、UI禁止条件、原本非変更、重複防止、停止再開、既存データ保持を確認してください。成功・失敗・未検証を区別して報告します。

## 今回の引き継ぎ保存

この更新は引き継ぎ文書の整理です。稼働アプリを再起動せず、実送信・UI取得・外部AI呼び出しを行いません。コードは専用GitHubブランチへ保存し、既存のDB・添付・運用設定は元のPCの私有バックアップへ保存します。バックアップの実パスと確認結果は `.runtime/HANDOFF_LOCAL.md` に記載します。GitHubやソースZIPだけでは個人データ・認証設定は復元されません。
