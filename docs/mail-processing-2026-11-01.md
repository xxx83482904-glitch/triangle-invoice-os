# P0-2 郵便物の処理状態を手動の書類整理状態にする

対象ブランチ: `codex/p0-2-mail-processed-save`。P0-1 の上に積み上げる。Git の commit / push / PR と画面操作の確認は Claude が担当する。本番データの補正・移行は実行していない。旧データの表示を維持する任意の補完については末尾の追補を参照。

## 原因と再現

- 一覧・詳細の「処理」の onChange はローカルの下書きを更新するだけだった。別の保存操作まで Server Action が送信されず、保存フォームは成功を待たずに下書きを消していた。
- 支払状態再計算が受領請求書と連携郵便物の `mailProcessed` を上書きしていた。再連携は支払記録から処理状態を作り直し、連携解除・請求書削除は未処理に戻していた。
- フラグ未設定時に「支払済み」「連携済み」を処理済みとみなす表示・集計が残っていた。
- 合成データで true / false / 未設定の処理状態を用意し、支払記録の登録・訂正・取消、連携・解除・削除時の保持と旧表示を検証した。修正前は最初の7テスト中6件失敗、修正後は成功した。

## 保存と表示

- 一覧・詳細で共通の処理プルダウンは変更時に Server Action を呼ぶ。一括選択中の操作も従来と同じ選択対象に即時保存する。
- 保存中は処理・分類の操作を無効化し、成功・失敗を常設メッセージと通知で表示する。処理値はサーバー保存値を表示し、失敗時は元の表示と理由を残す。分類は引き続き下書き方式で、成功した変更だけ消す。処理の保存は分類下書きを送信・破棄しない。
- `saveMailSorterBulkEdits` は `{ ok, updated / error }` を返す。認証、現在の権限、日本の対象、存在・削除状態、連携先、更新日時、列挙値を検証する。一括対象をすべて検証してから変更し、競合や不正な対象があれば全体を保存しない。同じ値の再送は成功する。
- 明示的な手動操作は従来どおり、選んだ郵便物とその連携先の受領請求書を更新する。同じ請求書に連携する別の郵便物は巻き込まない。請求書だけの行はその請求書のみ更新する。支払状態・金額・支払日・支払記録・銀行明細・照合は変更しない。
- 郵便物・受領請求書はそれぞれ自身の保存済みフラグを表示する。未設定は未処理表示とし、読込時にデータへ false を書き足さない。
- ダッシュボードは同じ請求書の連携書類を重複計上しない。請求書または連携郵便物のいずれかが未処理なら、そのまとまりを未処理1件とする。未設定フラグを推定しなくなるため、保存データを変えなくても未処理件数が増える場合がある。

## 自動書き換えの調査結果

| 箇所 | 対応 |
| --- | --- |
| `bank-reconciliation.ts` の `updatePaymentStatus` / `syncInvoicePaymentState` | 処理フラグの変更と連携郵便物の updatedAt 更新を削除。照合確定・解除・状態再計算、支払記録の登録・訂正・取消の各呼出元に共通で適用。支払状態と paidAt の再計算は維持。 |
| `mail-links.ts` の link / unlink / unlinkMailDocumentsForInvoice | 処理フラグを保持。参照・必要な分類・更新日時は従来どおり更新。請求書の削除による参照解除も同じ。 |
| `actions.ts` の処理保存3アクション | 共通の `applyMailSorterEdits` に集約。手動保存のみフラグを更新し、既存の mutation lock・監査ログ・Undo 経路を使う。 |
| 郵便物一覧・詳細、受領請求書詳細、郵便担当者向け書類一覧、ダッシュボード | 支払済み・連携済みからの補完を除去。自身のフラグと上記の集計規則を使う。 |
| 郵便物アップロードの3経路 | **変更なし**。新規郵便物を false で作る初期値であり、既存状態の上書きではない。 |
| 郵便物から請求書の作成・作り直し | **変更なし**。既存郵便物の処理フラグを書き換えていない。新しい請求書のフラグは未設定で、未処理と表示する。旧請求書の状態を自動継承しない。初期入力値の修正は P0-8 の範囲。 |
| 明示的な Undo・復元 | **変更なし**。ユーザーが取り消す操作の保存前状態を戻すもので、支払完了の推定ではない。 |
| agent API | API の追加・権限拡張なし。読み取りは保存済みフラグを返し、支払・連携操作は修正した既存業務関数を通る。回帰テストを追加。 |
| bank AI / 税金・保険一覧 | **変更なし**。既に保存済みフラグを参照している。対象推定の改修は P0-3。 |
| P0-1 の整合性チェック | **変更なし**。「郵便処理と支払状況の差（参考）」は INFO として残す。支払不整合とは別種類。 |

## 検証と引き継ぎ

- 全テスト526件（追加20件）成功。支払登録・訂正・取消、照合確定・解除・再計算、連携・解除・削除時のフラグ保持、手動保存、権限・会社・更新競合・一括原子性、集計と API を検証。
- `tests/check-bank-reconciliation.ts` の旧「照合で処理済み」期待値も更新。この既存の個別HTTPスクリプトは今回単独実行していない。
- 全 lint 成功。tsc と本番 build は隔離コピーで成功（standalone の static / public 配置を含む）。Windowsサンドボックスの `os.userInfo()` が ENOMEM になるため、scratchpad にある既存のローカル検証用 preload を NODE_OPTIONS に指定した。アプリ・本番への変更はない。
- `tests/check-mail-processing.ts` は合成プレビューの使い捨てコピーで standalone を起動し、実際のログインと Server Action を HTTP で検証する。元のプレビューは保持し、自分で起動した子プロセスだけ停止する。成功・拒否・永続化・再読込したHTMLの選択値・監査記録・金融データ不変、5画面と整合性チェックJSONを確認する。
- `tests/prepare-mail-processing-preview.ts` で合成プレビューを作成する。`admin@example.invalid` と `mail_editor@example.invalid` は既存 prepare スクリプト共通の合成テスト用パスワードを使う。P0-1 の prepare スクリプトも同じ管理者ログインへ統一した。
- PC 1280px・タブレット820px・スマホ375px × ライト・ダーク、実クリックによる成功通知・エラー表示・分類下書き保持・横はみ出しは **Claude の画面確認待ち**。HTTP検証だけではクライアント側操作と見た目の完了確認にはならない。

画面確認では、支払済み・未処理のA、未払い・処理済みのB、未連携通知C、直接登録の請求書Dを使用する。一覧行と詳細欄の両方で処理を変更して再読込する。分類を下書きにしたまま処理だけ保存し、分類下書きが残ることも確認する。別タブで更新した後の保存では競合理由が出て、入力の下書きが保持されることを確認する。

提案コミットメッセージ: `fix(mail): save manual processing independently of payment state`

### 2026-11-01 08:54 JST 最終結果

- 526 / 526 テスト成功、lint / tsc / production build / standalone HTTP 成功。再取得HTMLでAの未処理→処理済み→未処理とC・Dの処理済みを確認。支払不整合0、処理状態を手動変更した検証コピーで郵便参考3件（すべてINFO）。元の画面確認用データは不変。
- 画面確認用 `DATA_DIR`: `C:\Users\kure\AppData\Local\Temp\triangle-mail-processing-preview-dc4InJ`。`UPLOAD_DIR` は同ディレクトリの `uploads`。共通合成ログインを使用する。確認用サーバーは停止済み。
- HTTP検証のHTML・`result.json`: `C:\Users\kure\AppData\Local\Temp\triangle-mail-processing-check-1XrgVk`。
- アプリ側の変更・追加は下記19ファイル。既存の他者差分は含めない。Git操作・デプロイ・本番データの読取/変更なし。PC/タブレット/スマホ×ライト/ダークの描画・実クリックはClaudeの確認待ち。追加の仕様判断は不要。

```text
src/app/actions.ts
src/app/mail-sorter/ocr-documents-table.tsx
src/app/mail-sorter/page.tsx
src/app/received-invoices/page.tsx
src/lib/bank-reconciliation.ts
src/lib/dashboard.ts
src/lib/documents.ts
src/lib/mail-links.ts
src/lib/mail-processing.ts (追加)
tests/agent-api.test.ts
tests/bank-reconciliation.test.ts
tests/check-bank-reconciliation.ts
tests/mail-links.test.ts
tests/payment-records.test.ts
tests/prepare-payment-state-preview.ts
tests/mail-processing.test.ts (追加)
tests/prepare-mail-processing-preview.ts (追加)
tests/check-mail-processing.ts (追加)
docs/mail-processing-2026-11-01.md (追加)
```

### P0-2 追補: 未設定の処理フラグに旧表示値を補完する移行の準備

P0-2 本体は Claude が全526テスト・lint・tscを再検証し、実クリックによる即時保存・成功通知・再読込後の保持・監査と、PC1280 / タブレット820 / スマホ375 × ライト・ダークで横はみ出しなしを確認。commit `551216a` を同ブランチへpush済み。

以前の「移行不要」は業務処理を独立させる修正についての判断。未設定の古いフラグが未処理と見える変化を避けたい場合に備え、`scripts/migrations/mail-processed-legacy-flags.mjs` を追加した。**今回は作成と合成テストのみ。CLIを一度も起動せず、実データのドライラン・適用・復元はいずれも未実施。適用はユーザー承認後にClaudeが別作業で行う。**

- 対象は `mailProcessed` が欠損または `undefined` の生存中の日本の郵便物・受領請求書。既存のtrue/falseや、nullなど明示的な別値は上書きしない。
- 受領請求書は生存中の日本の案件に属するものだけ。案件が削除済み・存在しない・別会社なら除外する。郵便物・案件のcompany未設定は既存の扱いに合わせ日本とする。データ全体の `appEdition` がJAPANでない場合は拒否する。
- 受領請求書の提案値は `status === "PAID"`。支払記録の有無・金額では判定しない。郵便物は `Boolean(relatedReceivedInvoiceId)`。参照切れや削除された請求書のIDが残っていてもtrueとし、指定された旧ルールをそのまま使う。リンク修復や支払状態の訂正は行わない。
- 件数（種別別・true/false別）、対象ID、適用前のupdatedAt、提案値、根拠を表示する。氏名・金額・原本・認証情報はレポートに含めない。既定はデータ・バックアップとも変更しないドライラン。
- `--json` は標準出力をJSONにする。`--out` は同じ候補一覧を新しいJSONファイルに出力する。既存ファイルの上書きは拒否する。必要なら `--apply --plan <report.json>` で承認対象の一覧を読み込み、ドライラン後の更新も検出する。`--plan` がない場合は、その実行で抽出した一覧を直前再読込したデータと照合する。
- `--apply` は全対象のupdatedAt・未設定状態・会社・削除状態・提案値を再検証した後、`backups/<日時>-mail-processed-legacy-flags-<識別子>.json` に元ファイルをそのまま保存する。フラグと対象updatedAt、移行監査ログのみ更新し、一時ファイルから置換する。途中で1件でも対象が変化していたら全件中止する。updatedAtが未設定・不正な候補は表示されるが適用は拒否する。
- 置換直前にもファイル全体を再比較し、他の行だけの更新も上書きしない。アプリの排他はプロセス内キューなので、この外部CLIとは共有されない。適用・復元は書き込みのない保守時間帯に行う。スクリプトがサーバーを停止することはない。
- `--restore <backup>` は現ファイルを別途バックアップしてから、指定した日本版バックアップをファイル全体として復元する。復元時にも直前の変更を検出する。個別行のUndoではないので、移行後に行われた変更も戻る。`--restore` と `--apply` の同時指定は拒否する。
- 支払状態・支払記録・照合・銀行明細・科目・確度・確認状態は補完対象外。新しい候補抽出で再実行すると補完済みの行は対象外になり、0件ならバックアップ・監査追加も行わない。古いplanの再適用は競合として拒否する。

以下は承認後の担当者向けの使用例であり、今回実行したコマンドではない。

```powershell
# 確認用一覧（データを変更しない。report.jsonは未作成のパスを指定）
node scripts/migrations/mail-processed-legacy-flags.mjs --data "<app-data.json>" --out "<report.json>" --json
# 承認後・書き込み停止中に、確認済みの一覧を適用
node scripts/migrations/mail-processed-legacy-flags.mjs --data "<app-data.json>" --apply --plan "<report.json>"
# 必要な場合のみ、現ファイルを退避して全体復元
node scripts/migrations/mail-processed-legacy-flags.mjs --data "<app-data.json>" --restore "<backup.json>"
```

テストは `tests/mail-processed-legacy-flags.test.ts`。モジュールの関数をimportし、メモリー上の合成データと擬似ファイルI/Oのみで選定・提案・更新日時競合・全件原子性・バックアップ・復元・I/O失敗・ドライラン無変更を検証する。CLIプロセスの起動も実ファイルへの移行も行わない。Nextアプリの変更はなく、今回のbuild・standalone・画面確認は対象外。

追補の検証結果（2026-11-01 09:05 JST）: 追加19件を含む全545テスト成功、全lint成功（警告0）、隔離コピーのtsc成功。検証用preloadは前項と同じ。変更は移行スクリプト・テストの追加と本ドキュメントの更新の3ファイル。移行CLIの実ファイルI/O・本番候補件数は未確認。commit/pushはClaude担当、P0-8には進まない。

追補の提案コミット: `feat(migrations): prepare legacy mail processing flag backfill`
