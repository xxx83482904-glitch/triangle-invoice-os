# 整合性チェック（2026-10-31）

対象: `/banking/integrity`（画面）、`GET /api/banking/integrity`（JSON）、`src/lib/integrity.ts`（純関数）。

## 目的

保存済みデータのうち、人が見直すべき状態をルールで拾い、修正先の画面へのリンクと推奨操作を添えて一覧にする。点検は読み取り専用で、データは変更しない。該当は誤りの確定ではない（現金払い・前受金・カード精算など正当な場合がある）。

## 種類（`integrityKinds`）

| 種類 | 重要度 | 判定 |
|---|---|---|
| `reconciliation_conflict` 要再確認の照合 | 要対応 | `bankReconciliationOverview` の照合リンクに `issue` がある。維持可能なら「内容が正しければ照合を維持できます」を添える |
| `payment_mismatch` 支払記録と請求額・状態の不整合 | 超過は要対応、状態不一致は確認 | 照合対象の書類で `overpaid > 0` または `stateMismatch`（請求書の支払状態と支払記録の完了状態の不一致） |
| `mail_processing_mismatch` 郵便処理と支払状況の差 | 参考 | 受領請求書または連携郵便物の処理状態と、支払記録の完了状態が異なる。支払不整合とは別集計 |
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

## 2026-11-01 P0-1: 支払状態と郵便処理の判定を分離

- 原因: `bankReconciliationOverview` の `stateMismatch` が、請求書の支払状態に加えて受領請求書・連携郵便物の `mailProcessed` と支払完了の一致まで要求していた。
- `stateMismatch` は請求書の支払状態だけを判定し、郵便処理との差は `mailProcessingMismatch` として分離した。整合性チェックでは `mail_processing_mismatch` / `INFO`（参考）で表示・集計・絞り込みでき、JSONとエージェントの整合性読取にも同じ種類が返る。
- 支払済み 698,530円 / 支払記録 698,530円 / 郵便未処理と、支払予定 27,400円 / 記録0円 / 郵便処理済みを合成データで再現。両方とも支払不整合に出ず、郵便処理との差だけを参考として表示する。科目・確度・確認状態を含む元データは変更しない。
- 実際の状態不一致、過払い、発行請求書の判定、対象外書類の除外は維持。照合画面の支払不整合表示にも郵便物を混ぜない。
- 郵便物の処理済みは手動の書類整理状態であり、支払状況と一致させる必要はない。参考の案内で支払記録の修正や状態の強制一致を促さない。
- 今回は判定・表示の分離だけ。照合・支払記録・再連携等で郵便処理状態を上書きする既存動作は、次のP0-2で独立化する。本番データの移行は不要。
- 回帰テスト: `tests/payment-state-mismatch.test.ts`（6件）、既存の照合・整合性テストも新しい判定に更新。`tests/prepare-payment-state-preview.ts` は実在名を含まない一時的な合成データのみを作成し、認証情報は表示しない。

### P0-1 検証結果

- 修正前: 追加6テスト中5件失敗。支払済み・支払予定の2例で stateMismatch: true になることを再現。修正後: 関連61件、全506件成功。lint成功。隔離コピーで tsc --noEmit と production build（postbuildの静的資産コピーを含む）成功。
- このWindowsサンドボックスではtsxが使う os.userInfo() が uv_os_get_passwd / ENOMEM で失敗したため、検証プロセス限定のpreloadで当該エラー時の一時ディレクトリ用ユーザー名を補完した。依存パッケージ・アプリの実行コードは変更していない。補助ファイルは指定scratchpadの node-userinfo-fallback.cjs、検証時は NODE_OPTIONS=--require <scratchpad>/node-userinfo-fallback.cjs を設定。補助なしのテスト起動はこの環境では失敗する。
- standalone: 合成データを指定して127.0.0.1:3070で起動。全件・支払不整合・郵便処理との差の各HTML/JSONが200。支払不整合0件、郵便処理との差2件・参考を確認。未認証画面307、未認証API401、不正な種類400、静的資産200。請求書・支払記録・郵便物・銀行明細が読取前後で不変。起動した検証プロセスだけを停止済み。
- 画面確認の制約: Computer Useのブラウザー接続が The browser access host is unavailable。HTTPで返るHTMLの内容確認まで実施。PC・タブレット・スマホ × ライト・ダークの実描画・操作・横はみ出しは未確認。
- Gitのブランチ作成・commit・push・PRはClaude担当。main、本番データ、既存の3041/3057サーバーには変更なし。

## 2026-11-01 P0-6: 既知管理

理由付きの指摘単位/種類単位の既知登録と取り消し、根拠の指紋による再表示、既知を除いた件数、APIの includeKnown=1 を追加。UPSIDERは整合性専用の読み取り判定で相手なし振替から除外する。既存の業務データは変更しない。種類別の指紋と操作・件数の仕様、検証結果は [整合性の既知管理](integrity-known-2026-11-01.md) を参照。
