# 整合性チェック（2026-10-31）

対象: `/banking/integrity`（画面）、`GET /api/banking/integrity`（JSON）、`src/lib/integrity.ts`（純関数）。

## 目的

保存済みデータのうち、人が見直すべき状態をルールで拾い、修正先の画面へのリンクと推奨操作を添えて一覧にする。点検は読み取り専用で、データは変更しない。該当は誤りの確定ではない（現金払い・前受金・カード精算など正当な場合がある）。

## 種類（`integrityKinds`）

| 種類 | 重要度 | 判定 |
|---|---|---|
| `reconciliation_conflict` 要再確認の照合 | 要対応 | `bankReconciliationOverview` の照合リンクに `issue` がある。維持可能なら「内容が正しければ照合を維持できます」を添える |
| `payment_mismatch` 支払記録と請求額・状態の不整合 | 超過は要対応、状態不一致は確認 | 照合対象の書類で `overpaid > 0` または `stateMismatch`（書類の状態・郵便物の処理済みと支払記録の完了状態の不一致） |
| `mail_link` 郵便物の参照切れ・原本欠落 | 参照切れは要対応、原本欠落は確認 | `mailIntegrityReport`（PR-4）。原本の有無はローカル保存のときだけ判定 |
| `reviewed_guess` 推測のまま確認済み | 確認 | 確認済みで分類が推測（`isGuessClassification`）、かつ根拠に「推測候補を内容確認のうえ確定」（PR-5）がない |
| `reviewed_undecided` 確認済みだが記帳メモ未確定 | 保留ありは要対応、未確定は参考 | 確認済みの通常明細で `bookkeeping.hold` が残る、または `invoiceRequirement === "UNDECIDED"` が明示されている（記帳詳細を開いていない明細は対象外） |
| `reconciled_income_not_sales` 照合済み入金が売上系以外 | 参考 | `createBankSalesSuggester`（PR-5）が提案を返す入金 |
| `paid_without_bank` 支払・入金記録あり・銀行未照合 | 旧ステータス変更由来があれば確認、なければ参考 | `recordedUnmatched > 0`。旧ステータス変更由来（`isLegacyStatusPayment`）の件数を添える |
| `category_spread` 同じ摘要で科目が分散 | 参考 | 同じ事業者・方向・正規化した摘要（3文字以上、数字のみ・汎用語を除く）の確認済み通常明細で、科目／補助科目の組が2種類以上 |
| `transfer_half` 振替の片側のみ・資金移動の不整合 | 相手なしは参考、照合の不整合は確認 | 振替扱いで資金移動リンクがない（アプラス精算を除く）。または `bankTransferIssue` が返る資金移動リンク |

並び順は重要度（要対応→確認→参考）、種類、日付の新しい順。種類ごとに先頭500件まで返し、超えた種類は `truncated` に入る（件数 `counts` は全件）。

## 画面と API

- `/banking/integrity?company=JAPAN&kind=<種類>&page=<n>`: 件数付きの種類ボタン（スマホは選択リスト）、重要度バッジ、タイトル・詳細・推奨・リンク。口座・カード明細の見出し右の「整合性チェック」から入る。権限は `view:banking` と会社スコープ。
- `GET /api/banking/integrity?company=JAPAN[&kind=<種類>]`: 同じ内容の JSON（ログイン必須、`Cache-Control: no-store`）。不正な種類は 400 で種類一覧を返す。エージェント API（P1-7）の `integrity:read` はこの関数を再利用する。
- 既存の照合画面「確認事項」タブ（`bankDocumentReview`）は書類側の重複候補・郵便物未連携を扱う。この点検は明細・照合・支払記録まで横断する別物で、置き換えない。

## 変更しないこと

- 自動修正・一括更新はしない。既存データの補正は `scripts/migrations/*` と承認済みの作業で行う。
- `bankReconciliationOverview` を会社ごとに1回評価する。明細数が多い環境では数秒かかることがあるため、画面はページ送りで表示件数を抑える。

## 検証

```powershell
node --conditions=react-server --import tsx --test tests/integrity.test.ts
node --conditions=react-server --import tsx --test tests/*.test.ts
npx eslint src tests scripts
npx tsc --noEmit
```

画面確認用の合成データ: `node --conditions=react-server --import tsx tests/prepare-integrity-preview.ts`（全種類が1〜2件ずつ出る）。本番データ・アップロード・`.env` は使わない。
