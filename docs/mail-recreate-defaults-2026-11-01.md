# P0-8 郵便物から受領請求書を作り直すフォームの初期値

対象ブランチ: `codex/p0-8-recreate-defaults`（P0-2追補 `8204522` の上）。Gitの書き込み・画面の実操作はClaude担当。P0-8のみを修正し、本番データ・原本・環境設定には触れない。データ移行は不要。

## 原因と修正

一覧内のDocumentEditorとフォルダー詳細に反映フォームが重複し、どちらも支払先・案件の先頭候補、登録日と30日後、合計0を初期値にしていた。フォルダー詳細のuncontrolled入力は郵便物を切り替えても同じDOMを再利用し、前の入力が残る構造だった。

- 両方を `MailInvoiceReflectionForm` に統一した。郵便物IDをReactのkeyにし、controlled入力の初期状態・エラー・保存中状態を郵便物ごとに作り直す。フォルダー詳細全体もIDでkeyを付ける。
- `mailInvoiceDefaults` が、その郵便物の保存済みOCR本文、差出人、OCR要約メモ、原本ファイル名から候補を作る。他の郵便物・削除された連携先の請求書・候補配列の先頭を使わない。新しいOCR/API呼出しも行わない。
- 支払先は明示的なOCR請求元／差出人、保存済み差出人、保存済み要約の順。一意に完全一致（NFKC・空白・大文字小文字を正規化）した既存支払先だけ選択する。明示された差出人が不一致なら、弱い根拠に切り替えて別の支払先を選ばない。複数一致・部分一致は空欄。案件も明示的な案件名の一意一致だけを採用する。
- 差出人・案件名の明示がなければファイル名の区切り単位で一意一致する名前を使う。日付・金額は既存 `receivedInvoiceEvidence` を利用し、OCR→保存済み要約→ファイル名の順でラベル付きの情報を採用する。要約の「金額: 合計」、OCRの「合計」「税込総額」にも対応する。
- 日付の根拠がなければ空欄にする。自動命名ファイルの冒頭日付は登録日なので、単独の日付を請求日と推定しない。ファイル名では「請求日」「支払期限」などラベルがある日付だけを採用する。期限の30日後補完は行わない。
- 金額未抽出は空欄、明示された0は0。差引支払額を優先し、税込総額と源泉額の根拠がある場合は差引額を使う。状態の初期値は従来のREVIEWINGを維持する。

## 保存とエラー

`reflectMailInvoice` に業務処理を切り出した。Server Actionは既存のmutation lock・監査・Undoを通し、結果を `{ ok, invoiceId / error }` で返す。成功後は再検証した画面に連携済み情報を返し、通知する。保存失敗時はフォーム内に理由を表示して入力を保持する。

支払先と案件は必須。空の選択肢とHTMLのrequired、サーバーの明示的エラーで先頭候補の無意識な保存を防ぐ。存在・削除状態・日本のスコープ・現在の権限を検証する。郵便物のupdatedAtを照合し、別の操作による更新・既に有効な請求書と連携済みの場合は保存しない。

日付は既存の受領請求書編集と同じ `validateReceivedDates` を使い、空欄を許可する。サーバー側で現在日や30日後を補わない。金額空欄は従来の反映処理に合わせ未確認の0円として保存でき、その扱いをフォームに明示する。入力された金額は既存の金額検証に従う。PAIDは従来どおり支払記録の裏付けが必要で、この新規作成では裏付けなしのPAIDを拒否する。

検証をすべて終えてから請求書・添付参照・郵便物の連携先を更新する。削除された旧請求書、支払記録、銀行明細、照合、郵便物の手動処理フラグは保持する。新規請求書の処理フラグは従来どおり未設定。P0-2の独立性を維持する。

## 合成データと確認手順

`tests/prepare-mail-recreate-preview.ts` が4件の参照切れ郵便物を生成する。先頭の支払先・案件と削除された旧請求書には意図的に異なる値を置く。

| 郵便物 | 支払先 / 案件 | 請求日 / 期限 | 合計 | 根拠 |
| --- | --- | --- | --- | --- |
| A | 合成制作A / 合成案件A | 2026-09-10 / 2026-10-10 | 12,300 | OCR本文 |
| B | 合成設備B / 合成案件B | 2026-10-05 / 2026-11-20 | 45,600 | 別のOCR本文 |
| C | 空欄 / 空欄 | 空欄 / 空欄 | 空欄 | OCRなし、未登録差出人。ファイルの登録日は無視 |
| D | 合成設備B / 合成案件B | 2026-08-12 / 空欄 | 7,800 | 原本ファイル名のラベル |

ログインは `admin@example.invalid` または `mail_editor@example.invalid`、既存prepareスクリプト共通の合成パスワード。画面確認では一覧の編集欄とフォルダー詳細の両方でA→B→C→D→Aを開く。Aの入力を一度変えてからBへ移り、BにAの値が残らず、Cが空欄になることを確認する。支払先・案件未選択のエラーと、選択後の日付・金額空欄保存も確認する。PC1280 / タブレット820 / スマホ375 × ライト・ダークの描画・実クリックはClaude担当。

`tests/mail-recreate.test.ts` は初期値の根拠・不一致・曖昧さ・A/B/C切替での候補独立性、部分保存、入力不正・更新競合・重複作成の拒否、P0-2の処理状態保持を検証する。

`tests/check-mail-recreate.ts` は隔離buildのstandaloneを使い、プレビューの使い捨てコピーにのみ書き込む。共通合成ユーザーでログインし、HTML内RSCの4件分の初期値、Server Actionの必須エラー・日付エラー・再送拒否・A/B作成・Cの空欄保存、再取得した5画面・整合性JSON・監査を確認する。元のプレビューは保持し、自分で起動した子プロセスだけ停止する。HTTPでは隠れた編集欄のReact状態切替や通知の実描画まで確認したことにはならない。

## 変更ファイル

- 更新: `src/app/actions.ts`、`src/app/mail-sorter/ocr-documents-table.tsx`、`src/app/mail-sorter/page.tsx`
- 追加: `src/app/mail-sorter/mail-invoice-reflection-form.tsx`、`src/lib/mail-invoice-defaults.ts`、`src/lib/mail-invoice-reflection.ts`
- 追加: `tests/mail-recreate-fixture.ts`、`tests/mail-recreate.test.ts`、`tests/prepare-mail-recreate-preview.ts`、`tests/check-mail-recreate.ts`
- 追加: 本ドキュメント

提案コミット: `fix(mail): initialize recreated invoices from their own document evidence`

## 検証結果（2026-11-01 09:16 JST）

- 全560テスト成功（追加15件）、全lint警告0、隔離tsc / production build / standalone成功。Windowsの `os.userInfo()` ENOMEM回避には従来と同じscratchpadの検証用preloadを使用した。アプリ依存・本番設定は変更していない。
- HTTPでA〜Dの配信初期値、必須項目エラー、日付エラー、匿名拒否、更新競合・連携後の再送拒否、A/B作成、Cの空欄保存を確認。再取得5画面と整合性JSONは200、支払不整合0、作成監査3件。旧請求書・金融データ・郵便処理フラグは不変。
- 画面確認用DATA_DIR: `C:\Users\kure\AppData\Local\Temp\triangle-mail-recreate-preview-ZGHXYt`。UPLOAD_DIRは同ディレクトリの `uploads`。この元データはHTTP検証で変更していない。
- HTTP検証コピー・HTML・result.json: `C:\Users\kure\AppData\Local\Temp\triangle-mail-recreate-check-aPcvb7`。自分で起動した3070のstandaloneは停止済み。
- 未確認: 実クリックでのA→B→C切替、エラー時の入力保持・通知、PC/タブレット/スマホ×ライト/ダークの実描画。Claudeの画面確認待ち。追加の仕様判断は不要。
- アプリ11ファイルを変更/追加。指定進捗ファイルとVaultにも結果を追記する。Gitのcommit/push・デプロイ、本番データの読取/変更、中国版・NAS操作は未実施。P0-8で終了する。
