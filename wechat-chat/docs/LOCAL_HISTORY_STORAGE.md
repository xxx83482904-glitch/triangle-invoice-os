# WeChatの保存先と直接インポート調査

2026-11-10。本人の最新指示により画面経由の取得は停止。UIA・wxauto・OCRへ戻さず、実物ファイルを調査しました。実パス・アカウントIDは私有の `.runtime/local-history-storage.json` に保存し、Gitには含めません。

| 保存場所（アカウント部分は省略） | 実測 | 直接インポート |
|---|---|---|
| `xwechat_files/<account>/db_storage/message/message_0.db`〜`message_5.db` | 本文DB候補6ファイル。PC移行完了付近に更新 | 通常SQLiteとして読めない |
| `db_storage/contact/contact.db`、`session/session.db` 等 | 現行DB合計29個を検査。全対象で通常SQLiteヘッダーなし・スキーマ読取失敗 | そのままコピーしても読めない |
| 旧 `Documents/WeChat Files/<account>/Msg` | 本文・基本情報DB9個を検査。同様に読取失敗 | 旧形式も直接取込不可 |
| 指定の `xwechat_files/Backup/...` | 前回検査: 20,824ファイル、ChatPackageを持つ1,734フォルダー、主にRMFH形式 | 本文取得0件。フォルダー数は読めた会話数ではない |
| `temp/phone/migration.db` | 通常SQLite。移行開始時刻・移行タスク用の2テーブル | 会話本文のDBではない |
| `msg/attach`、`msg/file`、`msg/video`、`msg/migrate` | 媒体・受信ファイルの領域が存在 | 本文との対応付け・音声原本は未検証 |

## 調べた方法

SDK起動・画面取得・UI操作を使わず、配置・サイズ・更新時刻・先頭16バイトを確認しました。SQLiteは `mode=ro&immutable=1` と `query_only` でスキーマだけを読み取りました。現行29DBと旧9DBは `file is not a database` でした。暗号化形式と整合しますが、実物の鍵での復号・全件読取は未検証です。

移行・一時領域738ファイルの拡張子を調査し、DB/JSON/JSONL/CSV/TXT候補は上記migration.dbのみでした。一般の添付文書は読んでいません。稼働中のWeChatにはWALがあるため、immutable検査は基本ファイルの形式確認であり、最新履歴の一貫したスナップショット取得ではありません。ファイル数・サイズから会話数・メッセージ数を推測しません。

WeChat本体・原本バックアップを変更せず、会話本文をログ・Git・外部サービスへ出力していません。鍵抽出・DLL注入・通信偽装・暗号回避は実施していません。

## 資料との照合

- [Tencent公式FAQ](https://kf.qq.com/faq/250710MraIZj250710QniyAr.html): 4.xは新しいxwechat_filesを使い、旧WeChat Filesと保存方式が異なる。そのまま混在できない。
- [Tencent公式バックアップ説明](https://kf.qq.com/faq/161224mmmUju161224A3UVrE.html): PCへの保存とスマートフォンへの復元用。
- [Tencent WCDB](https://github.com/Tencent/wcdb): SQLite/SQLCipherを基盤に暗号化をサポート。ただし、このPCの個別DBの暗号方式・鍵を実測したわけではない。
- [ChatImportKit](https://github.com/Cjh-y/ChatImportKit): 現公開版はRMFH検出・会話単位のメタデータまで。本文の復号は研究中であり、導入すれば読めるとは判断できない。
- [WeChatMsg-4xの作者の説明](https://github.com/chenanhan230-del/WeChatMsg-4x/blob/main/doc/%E5%BE%AE%E4%BF%A14.x%E9%80%82%E9%85%8D%E8%AF%B4%E6%98%8E.md): DB読取に鍵を必要とし、取得にプロセスメモリの走査を使う。今回の非侵襲的な方針に合わないため実行・組み込みしない。

## 判断

**保存先は特定できましたが、手元のファイルから本文を直接取り込める経路は未確認です。** 次の入力条件のいずれかが必要です。

1. 本人が用意した、本文を含むJSON/CSV等のエクスポート。
2. 本人が利用権を持ち、通常SQLiteとして開けるDBと形式情報。
3. この版に対応し、侵襲的な操作を必要としない公式・正規のデータ読取方法。

入手できた段階で形式確認 → 試験DBへ少量取込 → 件数・重複・日時・送信者・添付の照合 → 本番取込の順で実装します。任意形式のインポーターが完成したとは扱いません。

## 現在の運用

`WECHAT_UI_ACCESS_ENABLED=false` により、元のadapter/DBパスを保ったまま `StoredHistoryAdapter` を選択。再起動後もSDK worker・巡回・画面診断・OCR・送信・未取得添付の取得を開始しません。保存済み会話の閲覧・検索と保存済み添付配信は利用できます。Mockテストは別DBで継続できます。UI取得の再開は本人の現在の指示に反するため行いません。
