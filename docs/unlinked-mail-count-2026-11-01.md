# 連携が必要な郵便物の件数（P0-7 / 2026-11-01）

## 調査と再現

本番データは参照していない。本番の19件の実際の内訳は未確認であり、以下は同じ数字になる合成再現と現行コードの調査結果。

修正前のbankReconciliationOverviewとbankDocumentReviewは、分類が請求書・領収書で有効な連携先がない郵便物を数え、mailProcessedを見ていなかった。遷移先も全件の郵便物フォルダーだった。

合成データは旧条件で19件（未処理10件＋手動処理済み9件）。修正後はバナー・確認事項・専用一覧とも10件になる。通知・その他が直接数えられる不具合は現行コードでは再現しなかった。

| 候補 | 確認結果と採用した基準 |
| --- | --- |
| 手動処理済み | 旧条件で数えられる主要な再現原因。分類や参照切れの有無にかかわらず、今回の連携作業件数から除外 |
| 参照先の未設定・不存在・削除 | 未処理の請求書/領収書なら数える。参照IDが存在するだけでは連携済みとしない |
| 参照先の案件が削除・不存在・別会社 | 同上。受領請求書と同じ会社の生存案件が必要 |
| 他の担当者の案件・案件のARCHIVED状態 | 非表示や表示条件を参照切れと混同しない。案件が生存し同じ会社なら有効な連携 |
| 受領請求書のARCHIVED/REJECTED | 支払対象ではなくても参照は有効。未連携に数えない |
| 債務グループの旧請求書・領収書に連携 | 支払対象外でも既存の原本/書類の関連は有効。再作成や最新書類への自動付け替えは求めない |
| 原本ファイルなし・fileUrlなし | 原本欠落だけでは連携不要と確定できない。未処理の請求書/領収書なら確認対象に残す。既存書類への連携も可能なので、原本の存在確認を集計条件にしない |
| 重複登録/重複候補 | 自動判定は候補であり、人の不要判断ではない。同じハッシュ・候補参照だけでは自動除外/自動連携しない。郵便物IDごとに数え、不要なコピーは確認して手動で処理済みにする。有効な同じ請求書に連携済みのコピーは数えない |
| 通知・その他・契約書・見積書・納品書 | 請求書への連携を要求しない。数えない |
| 削除済み・別会社の郵便物 | 数えない |

## 共通の判定と変更

src/lib/mail-links.ts のmailNeedsReceivedInvoice / mailsNeedingReceivedInvoiceを次の条件のANDで定義する。

1. 削除されておらず、選択会社に属する郵便物。
2. 分類がINVOICEまたはRECEIPT。
3. 郵便物自身のmailProcessedがtrueではない。
4. resolveMailLinkで有効な受領請求書を解決できない。

未設定の旧フラグはP0-2どおり未処理として扱い、支払済みや過去の連携から推定しない。既存フラグ・科目・確認状態・支払記録は書き換えない。P0-2追補の旧フラグ補完スクリプトも今回実行しない。

- 照合画面バナー、bank-review.tsのunlinked_mail、絞り込み先の郵便物一覧を同じ関数に統一する。bank-reviewに表示対象を絞ったoverviewを渡しても、有効な参照が「非表示だから未連携」に変わらない。
- リンクは /mail-sorter?company=JAPAN&link=required。サーバー側で対象の郵便物だけを配信し、直接登録された受領請求書や空の月フォルダーを混ぜない。対象0件ならバナーを消し、専用一覧は0件と表示する。
- 専用一覧で処理済み・分類変更・再連携を保存すると、保存成功後の再取得で対象から外れる。失敗時は元の行が残る。未処理に戻す/連携解除した場合も共通判定で再計算する。
- 全件/専用一覧の切り替えにReactのkeyを付け、前の画面の検索・分類・処理フィルターを引き継いで件数が少なく見えることを防ぐ。専用一覧内の追加検索等は従来どおりで、見出しは全対象件数、表は検索後/全対象件数を表示する。「すべての郵便物に戻る」で全件表示へ戻れる。
- 一覧のCSVボタンも、専用一覧ではその対象IDに限定する。0件時に空のID指定で全件を書き出さないようボタンを出さない。画面全体の書き出しダイアログは従来の用途・条件指定のまま。
- 処理変更の既存revalidateに加え、旧分類変更Actionからも照合画面を更新する。再連携/解除では整合性チェックも更新する。金融データを書き換える新しい操作は追加していない。

## 整合性チェック等との違い

整合性チェックのmail_linkは「連携作業の残数」ではなく、保存された参照切れ・原本欠落の検査である。元から通常の未連携郵便物は含めていないため、件数をunlinked_mailと同じにはしない。処理済みの参照切れも隠さず検出し、説明に「処理済みや分類とは別のデータ点検」と明記する。対応案も連携の要否を確認し、必要なものを作り直す/再連携する表現に改めた。

郵便物全件画面の参照切れ・原本欠落件数も同じ構造検査として維持。専用一覧はその全件警告を表示せず、対象行の参照切れ/原本なし表示を使う。P0-1の「郵便処理と支払状況の差（参考）」は変更しない。重複候補の指摘やAI提案用の原本情報も、連携の作業件数とは別用途なので対象を一律削減しない。AI APIは今回呼び出さない。

## 検証と合成データ

- tests/unlinked-mail-fixture.ts: 未処理10件、処理済み9件、有効連携（却下・アーカイブ・別担当・債務グループを含む）、通知等5分類、削除済み/別会社、直接登録OCR請求書、空フォルダー。
- tests/unlinked-mail.test.ts: 追加15件。旧19→新10件、全分類/処理状態、参照先の各条件、原本なし/重複、未設定フラグ、処理/分類の変更と取消・競合・権限、再連携/解除/削除、絞ったoverview、73件のページ送り、0件、構造検査の独立性、集計の非破壊性。
- 全590テスト成功（追加15、失敗/スキップ0）、全lint警告0、隔離tsc/production build/standalone成功。postbuildによるstatic/public配置も確認。
- HTTP/配信RSC/JSON: バナー・確認事項・専用一覧の対象IDと件数10件一致、処理/連携/分類/未処理へ戻す/解除/残り全処理で9→8→7→8→9→0件を確認。0件時のバナー非表示・CSV非表示、CSVの対象限定、全件への復帰用配信、未知フィルター、会社省略時のリダイレクト維持、匿名/主任の拒否、郵便担当の操作、古い更新日時の拒否、監査6件を確認。金融データと元の合成プレビューは不変。整合性の構造検査の対象IDは操作前後で不変。
- 既存scratchpad/node-userinfo-fallback.cjsでサンドボックスのos.userInfo ENOMEMを検証時のみ補完。自分で起動した3070のstandaloneのみ停止済み。既存のサーバーは停止していない。
- 画面確認用DATA_DIR: C:\Users\kure\AppData\Local\Temp\triangle-unlinked-mail-preview-AoPMDv（UPLOAD_DIRはそのuploads）。HTTP成果物: C:\Users\kure\AppData\Local\Temp\triangle-unlinked-mail-check-vhrYGF（各段階のHTML、integrity.json、result.json）。
- ログ: 指定scratchpadのp0-7-tests.log / p0-7-lint.log / p0-7-tsc.log / p0-7-build.log / p0-7-standalone.log。HTTP確認は隔離build-checkでDATA_DIRを指定して tests/check-unlinked-mail.ts を実行する。

作成: node --conditions=react-server --import tsx tests/prepare-unlinked-mail-preview.ts

共通の合成管理者admin@example.invalid、郵便担当mail_editor@example.invalid、権限確認用chief@example.invalidを含む。パスワードは他のprepareと共通の合成値。単体テストの別会社ケースは日本版プレビューの保存データから除く。原本のある郵便物には合成のプレースホルダーPDFを用意する。

Claudeの画面確認:

1. 既存合成管理者で照合画面を開き、バナー10件から専用一覧へ進み10/10件を確認。確認事項の「郵便物の未連携」も10件。未処理だけを表示し、処理済み・通知・有効連携・直接登録の請求書を含まない。
2. 全件画面で検索/分類を変更してから、専用リンクへ移動し、前のフィルターが残らないことを確認。専用一覧内で追加検索をかけ、解除すれば10件に戻ることを確認。
3. open-invoiceを処理済みにして成功通知・一覧からの除外・照合9件を確認。全件画面で未処理に戻すと10件に戻る。
4. open-receiptをliveへ再連携すると9件。解除すると未処理のため10件。通知へ分類変更したものは対象外になる。
5. 全対象を処理済みにすると照合バナーが消え、専用一覧は0件。全件画面や整合性チェックの参照切れ/原本警告は別用途として残る。
6. PC1280 / タブレット820 / スマホ375 × ライト/ダークで、文言・リンク・一覧・保存通知・横はみ出しを確認。

実画面の操作・6条件の描画はClaude担当。CodexはHTML/RSC/JSONで検証する。既存データの補正・移行は不要。本番19件の実内訳は未確認。

## 変更・追加ファイル

変更9: src/lib/mail-links.ts、src/lib/bank-reconciliation.ts、src/lib/bank-review.ts、src/lib/integrity.ts、src/components/app/bank-reconciliation-workspace.tsx、src/app/mail-sorter/page.tsx、src/app/mail-sorter/ocr-documents-table.tsx、src/app/actions.ts、src/app/mail-sorter/link-actions.ts。

追加5: tests/unlinked-mail-fixture.ts、tests/unlinked-mail.test.ts、tests/prepare-unlinked-mail-preview.ts、tests/check-unlinked-mail.ts、本書。

提案コミット: fix(mail): count only unresolved invoice-link tasks and scope the destination list
