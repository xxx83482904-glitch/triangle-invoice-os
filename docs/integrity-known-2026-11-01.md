# P0-6 整合性チェックの既知管理

対象: `codex/p0-6-integrity-known`（基点09412cf）。会計データへの補正・移行、P1の書き込みAPI、デプロイは行わない。

## 原因と変更

従来は毎回保存データから同じ指摘を作り、利用者が確認した理由を記録する場所がなかった。`reviewed_guess` を消すために確度・確認状態を変更する必要はない。optionalな `integrityAcknowledgements` を追加し、閲覧ではコレクションの新設も書き込みも行わない。

- 指摘1件、または同じ種類の表示対象（全ページ分、最大500件）を理由付きで既知登録する。確認画面に対象件数を表示する。
- 種類単位でも恒久ルールは作らず、確認画面のID・指紋の配列をそのまま対象にする。新しい指摘は含めない。保存時に1件でも変更・解消・登録済みなら全件を拒否し、理由の入力を保持する。
- 登録には指摘ID・種類・指紋・理由・日時・実施者ID/当時の表示名・共通batchIdを保存する。新しい登録を先頭へ追加し、会社と指摘IDごとに最新の登録だけを評価する。過去の登録に戻って一致を探さない。
- 既知一覧は `?known=1`。理由・日時・実施者と、理由必須の取り消しを表示する。取り消し日時・実施者・理由を同じ記録に追加する。新しい登録を取り消しても古い既知登録は復活しない。
- 画面とServer Actionは管理者・経理の `manage:banking` に限定。保存ロック内で利用者の現在の権限を再確認し、取り消しは記録のupdatedAtでも競合検出する。
- `ACKNOWLEDGE_INTEGRITY` / `REVOKE_INTEGRITY_ACKNOWLEDGEMENT` を監査へ記録。初回登録を含め既存Undo対応。変更対象は既知コレクションと監査のみで、明細・書類・支払・照合には触れない。

## 指紋 v1

種類と以下の投影値を、オブジェクトキー順を固定したJSONにしてSHA-256で比較する。集合はID順に整列する。`updatedAt`・`createdAt`、同期のsourceMemo、一般的なメモ、実施者名の変更は指紋に含めない。分類理由や保留の質問、旧支払記録の識別結果など、判定根拠となる値は含める。削除は日時そのものではなく有無で扱う。

指紋生成はサーバー側。画面用の定数・型を `integrity-types.ts` に分け、クライアントへ `node:crypto` を持ち込まない。ルール・投影の意味を変える際はバージョンを更新する。

| 種類 | 比較する根拠 |
|---|---|
| `reviewed_guess` | 明細ID/会社/事業者/口座/方向/金額/取引日/摘要/元明細欠落、科目/補助科目、確度/分類元、確認状態、分類理由、処理区分 |
| `reviewed_undecided` | 同じ明細の基本値、確認状態、処理区分、請求書要否、保留の理由・質問 |
| `category_spread` | 指摘IDに含む事業者・方向・正規化摘要と、対象明細のID/科目/補助科目の集合。金額・並び順・更新日時だけでは変わらない |
| `transfer_half`（相手なし） | 明細基本値、元明細ID/状態、処理区分、口座ID/会社/事業者/名称/金融機関名/口座種別、保留/分割有無、資金移動・請求書照合のリンクID |
| `transfer_half`（リンク不整合） | 両側の上記根拠、リンクID/会社/両側ID、保存された両側照合根拠、送金手数料額 |
| `payment_mismatch` | 対象の支払対象可否/状態/請求額、アクティブな支払のID/種類/書類ID/金額/支払日/削除有無/旧ステータス記録の判別 |
| `mail_processing_mismatch` | 支払対象可否/請求額と支払根拠、受領請求書の手動処理状態、生存する同会社の連携郵便IDと手動処理状態。独立した「参考」のまま維持 |
| `paid_without_bank` | 支払不整合と同じ根拠、銀行照合済み額/未照合額、該当する各照合リンクの下記根拠 |
| `reconciliation_conflict` | リンクID/明細ID/書類種別・ID/支払ID/配賦額/手数料額・負担者/保存照合根拠、現在の明細と口座・元明細状態・処理区分、書類の案件ID・会社・削除有無/状態/合計、支払根拠、資金移動リンクID、照合判定・維持不可理由 |
| `reconciled_income_not_sales` | 明細基本値・選択科目・処理区分、売上候補として認められる科目ID集合、生存する発行請求書と照合リンクのID |
| `mail_link`（参照切れ） | 郵便の会社/削除有無/連携先ID、参照先の存在/削除有無/案件ID・会社・削除有無。支払状態の変更は含めない |
| `mail_link`（原本欠落） | 原本URLと欠落判定、郵便の会社/削除有無、受領請求書の場合は案件スコープ |

指紋が異なると既知を外して表示するが、記録そのものを自動変更・削除しない。指摘が解消した場合は既知件数にも含めない。最新登録の根拠と完全に同じ値に戻れば再び既知に一致する。取り消した登録は値が戻っても一致させない。

## 件数と読み取りAPI

- `integrityReport` / `summarizeIntegrity` の `total`・`counts`・`severity`・種類別countは既知を除く。`knownTotal`・`knownCounts`・種類別knownCountを別に返す。`totalIncludingKnown` は両者の合計。
- 既知と未対応それぞれ種類ごとに500件まで返す（件数は全件）。`truncated` / `knownTruncated` を分離し、既知が多くても未対応の表示枠を消費しない。500件超は表示分を登録後、残りを再確認する。
- `/api/banking/integrity?company=JAPAN` と `/api/agent/v1/integrity` は既定で既知を除く。`includeKnown=1` で既知も含め、各該当項目に `known`（記録ID・理由・日時・実施者ID/名・updatedAt・batchId）を付ける。`0` は既定と同じ、不正値は400。全指摘に `fingerprint` を付ける。
- エージェントは引き続き `integrity:read` 必須。既存のtotalはフィルター後の返却候補件数（limit/cursor前）を維持し、全種類の未対応件数は `unresolvedTotal` で返す。種類別件数・既知件数は全種類の値。`includeKnown` で同じページング・kind絞り込みを利用できる。既知登録APIは追加しない。
- 呼び出し元を調査: 口座画面は件数なしの導線のみ、ダッシュボードに整合性件数はない。照合画面の確認事項 `bank-review`、郵便物の構造検査は別の業務集計であり、整合性の既知登録で隠さない。これらを変更して既知の効果を広げない。

## UPSIDERの判定と影響範囲

共通の `knownBankCardSettlement` はアプラスの口座振替だけを認識していた。一方、同関数は同期・ルールプレビュー・AI分類・一括変更・保護判定・照合ダイアログにも使用される。広げると保存済みの未確認AUTO/HISTORY分類に対する提案や同期が変わるため、今回は `integrityBankCardSettlement` を追加し、整合性の相手なし振替だけに使用する。

- アプラスは既存判定へ委譲。UPSIDERは日本の正の出金、同会社・同事業者のBANK口座、元明細欠落/連携元対象外でないことが前提。
- NFKC・空白除去・小文字化で `振込 ｶ)ｱｯﾌﾟｻｲﾀﾞｰ`、`UPSIDER`、`アップサイダー`、`振込 ＵＰＳＩＤＥＲ` を認識する。任意の「振込/振込み/フリコミ/口座振替」と法人表記だけを許す完全一致。摘要末尾の任意文字・番号・年月等は推定で許さない。
- 入金、返金/返還/返戻/取消/取り消/組戻/払戻/払い戻/手数料/refund/reversal/fee、別会社・別事業者・カード/その他/不明の口座、類似名の別企業は対象外。
- 認識した振替は指摘ではなく、画面とJSONに「アプラスカード精算 N件」「UPSIDERカード精算 N件」として除外件数を表示する。カード利用期間・明細との照合が済んだという意味ではない。実際に存在する資金移動リンクの不整合は免除しない。
- 他画面のアプラス文言・分類保護・照合制約は既存のまま。UPSIDERがそれらでアプラスと表示される経路はない。現在の分類・確度・確認状態・照合は書き換えない。一括変更やAI等の既存の明示操作に新たな権限・自動更新を追加しない。
- 本番の摘要は未確認。上記に一致しない振替は通常の指摘または理由付き既知登録で扱う。

## 合成データと確認

`tests/prepare-integrity-known-preview.ts` は標準の合成ユーザーを含み、本番を読まず一時ディレクトリを作る。初期は推測3件・科目分散1件・相手なし振替4件の計8件、既知0件。アプラス1件・UPSIDER4件は除外表示。

`--stage=known` は推測1件を既知にした比較用データ（7件/既知1件）、`--stage=timestamp` はその更新日時だけを変更（7/1）、`--stage=changed` は金額を1000→1100円に変更（8/0）。各実行は独立した合成コピーで、現在のデータを書き換えない。画面で対象明細の根拠変更による再表示を比較できる。

HTTP確認は `tests/check-integrity-known.ts`。隔離buildの中で明示した合成DATA_DIRのコピーだけを使用し、Server Action・認証・権限/競合・既知登録/取消・API既定/includeKnown・根拠変更後のHTML/JSONを確認する。トークンやパスワードは出力しない。元プレビューは保持し、起動したサーバーのみ終了する。

実クリック・成功/失敗通知・PC1280/タブレット820/スマホ375×ライト/ダークはClaude担当。自動検証の結果と変更ファイル一覧は完了時に追記する。

## 検証結果（Codex）

- 全651テスト成功（P0-4の629件から22件追加）、失敗・スキップ0。全lint警告0。隔離コピーのtsc --noEmit、production buildとpostbuild、standalone起動に成功。
- 作業コピー直下のtscは既存の未追跡tmp/内にある古い別ビルドのソース・不足依存も取り込むため失敗した。tmp/を変更せず、指定の隔離コピーで現行ソースの型検査を完了した。既存のos.userInfo ENOMEM回避用preloadを検証プロセスで使用。
- standalone（空きポート3070）で初期8件/既知0件、指摘単位7/1、種類単位5/3、更新日時のみ5/3、金額変更6/2、新規追加7/2、取り消し8/1をHTML/JSONで確認。最後に分散と振替の各1件を既知登録して6/3。監査5件、権限・会社・理由なし・競合・二重送信の拒否、元会計データ不変を確認。
- エージェントのintegrity:readと通常JSONの既定/includeKnown、ページの既知一覧（理由・日時・実施者）、静的アセット200を確認。検証スクリプトが起動したプロセスだけを終了した。
- 初期プレビュー: `%TEMP%/triangle-integrity-known-preview-qBDEWo`。標準合成ユーザー admin@example.invalid と共通の合成パスワードを含む。HTTP成果物: `%TEMP%/triangle-integrity-known-check-c0NJgr`（各段階HTML、integrity.json、result.json）。
- 比較用プレビュー（件数も確認済み）: 既知 `%TEMP%/triangle-integrity-known-preview-Mo4aLC`（7/1）、更新日時のみ `%TEMP%/triangle-integrity-known-preview-Fvd44H`（7/1）、金額変更 `%TEMP%/triangle-integrity-known-preview-LEFmoT`（8/0）。いずれもUPLOAD_DIRは配下のuploads。
- 未確認: 実クリック・理由入力保持/通知の見え方・PC/タブレット/スマホ×ライト/ダークはClaude担当。本番のUPSIDER摘要は参照していない。
- 本番data/uploads/.env、92件の明細、NAS、中国版には触れていない。移行スクリプト不要。Git書き込み・デプロイなし。P0完了として停止し、P1には進まない。

## 変更・追加ファイル（24）

- [src/lib/types.ts](../src/lib/types.ts)
- [src/lib/store.ts](../src/lib/store.ts)
- [src/lib/japan-storage.ts](../src/lib/japan-storage.ts)
- [src/lib/integrity.ts](../src/lib/integrity.ts)
- [src/lib/integrity-types.ts](../src/lib/integrity-types.ts)
- [src/lib/integrity-fingerprint.ts](../src/lib/integrity-fingerprint.ts)
- [src/lib/integrity-acknowledgements.ts](../src/lib/integrity-acknowledgements.ts)
- [src/lib/bank-card-settlement.ts](../src/lib/bank-card-settlement.ts)
- [src/lib/agent-api.ts](../src/lib/agent-api.ts)
- [src/app/banking/integrity/actions.ts](../src/app/banking/integrity/actions.ts)
- [src/app/banking/integrity/page.tsx](../src/app/banking/integrity/page.tsx)
- [src/app/api/banking/integrity/route.ts](../src/app/api/banking/integrity/route.ts)
- [src/components/app/bank-integrity-workspace.tsx](../src/components/app/bank-integrity-workspace.tsx)
- [src/components/app/integrity-known-dialog.tsx](../src/components/app/integrity-known-dialog.tsx)
- [tests/integrity-known-fixture.ts](../tests/integrity-known-fixture.ts)
- [tests/integrity-known.test.ts](../tests/integrity-known.test.ts)
- [tests/integrity-known-store.test.ts](../tests/integrity-known-store.test.ts)
- [tests/integrity-known-api.test.ts](../tests/integrity-known-api.test.ts)
- [tests/integrity-upsider.test.ts](../tests/integrity-upsider.test.ts)
- [tests/prepare-integrity-known-preview.ts](../tests/prepare-integrity-known-preview.ts)
- [tests/check-integrity-known.ts](../tests/check-integrity-known.ts)
- [docs/integrity-known-2026-11-01.md](../docs/integrity-known-2026-11-01.md)
- [docs/integrity-report-2026-10-31.md](../docs/integrity-report-2026-10-31.md)
- [docs/agent-api-2026-10-31.md](../docs/agent-api-2026-10-31.md)

提案コミット: `feat(integrity): track known findings and recognize UPSIDER settlements without reclassification`

## P0-6b 追補: UPSIDERの銀行カナ表記

対象: `codex/p0-6b-upsider-bank-kana`（基点7fb984e）。以下の本番情報はClaudeからの読み取り報告による。Codexは本番を参照していない。

| 本番で残った摘要（content） | 件数 |
|---|---:|
| `振込 カ)アツプサイダ-` | 7 |
| `振込1 カ)アツプサイダ-` | 5 |

原因は、NFKC後も大きい「ツ」やASCIIのハイフンは「ッ」「ー」にならず、従来の完全一致に当たらなかったこと。接頭辞の数字も許していなかった。修正前の合成テストで認識失敗を再現した。

- `integrityBankCardSettlement` の正規表現だけを拡張。カナの名前は `ア[ッツ]プサイダ` と末尾の長音0〜1文字、英字は従来どおり `upsider`。長音はNFKC後の `ー`、`-`、`‐`、`‒`、`–`、`—`、`―`、`−` に限定する。入力の `‑` は `‐`、`－` は `-`、`ｰ` は `ー` にNFKC変換される。
- `振込`・`振込み`・`フリコミ` の直後だけ数字0〜2桁を許可。全角数字は既存のNFKCで半角化する。`口座振替` は数字なし。名前の後の数字、数字3桁、長音2文字、別会社名の接尾辞は許可しない。
- 接頭辞・既存の法人表記を除いた名前の完全一致を維持。返金・取消・手数料等の除外語、日本の正の出金、同会社・同事業者の銀行口座、sourceMissing・連携元excludedの除外条件は維持する。
- 共通の `knownBankCardSettlement`・`settlementAccountKind` と同期・一括変更・AI分類・照合のガードは変更しない。追加の銀行カナ表記でも、既存の表示/保護・同期が分類・確度・確認状態を変えないことをテストする。
- 本番で残る `振込 カ)アプラス` 2件は、従来の共通判定（口座振替APアプラス）の範囲を広げる根拠がないため今回の対象外。`振込 カ)トライアングルドツトジエ-ピ-` 系23件も会社間の資金移動であり、カード精算にする根拠がないため対象外のまま。
- 本番相当の合成37件では、UPSIDER12件だけが `cardSettlements` に加算され、`transfer_half` は25件になる。既存の資金移動照合も含め、レポート評価前後の全データ一致を検証する。
- `prepare-integrity-known-preview.ts` の `settlement-1` と `settlement-4` を本番と同じ2表記に変更。行数は増やさず、初期8件/既知0件、アプラス1件/UPSIDER4件の表示基準と標準合成ユーザーを維持する。

変更ファイルは `src/lib/bank-card-settlement.ts`、`tests/integrity-upsider.test.ts`、`tests/prepare-integrity-known-preview.ts`、本ドキュメントの4件。郵便フラグの移行スクリプトと既存データには触れない。Git操作・production build・standalone・画面確認・デプロイはClaude担当。

P0-6b検証結果: 全654テスト成功（3件追加、既存2件を銀行カナにも拡張）、失敗・スキップ0。全lint・隔離コピーのtsc --noEmit成功。既存の検証用os.userInfo回避preloadを使用。画面確認用DATA_DIRは `%TEMP%/triangle-integrity-known-preview-pWxy0t`（UPLOAD_DIRは配下のuploads）。銀行カナ2行を含め、初期8件/既知0件/UPSIDER4件をJSONで確認した。production build・standalone・画面確認はCodexでは未実施（Claude担当）。

提案コミット: `fix(integrity): recognize UPSIDER bank-kana transfer descriptions`

本番での確認（2026-11-01 14:40 JST、`aad2675` デプロイ後、Claudeが読み取りのみで確認）: 除外されたのは出金の `振込 カ)アツプサイダ-` 7件で、UPSIDERカード精算は7件と表示された。`振込1 カ)アツプサイダ-` 5件は入金（+712円〜+199,871円、2024-08〜2025-08）だった。上の合成テストの「12件除外」は依頼時の前提（12件すべて出金）に基づくもので、本番の入金5件は従来どおり除外の対象外のため指摘に残る（入金側を広げない方針どおり）。`transfer_half` は37件から30件になった。
