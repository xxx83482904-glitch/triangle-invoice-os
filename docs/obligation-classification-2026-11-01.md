# P0-3 税金・社会保険の区分と未納の管理（2026-11-01）

作業ブランチ: `codex/p0-3-obligation-classification`。P0-7 (`3c352c2`) の上。Git 書き込み・公開・本番操作は行わず、取り込みと実画面確認は Claude が担当する。

## 原因と再現

旧 `taxObligations` は支払先名だけでなく、ファイル名・メモ・OCR先頭400文字にも正規表現を適用していた。「ガス」「急便」は判定語に含まれていない。普通の請求書の「消費税」や「納付書」、メモの「税務署への提出用」で税金として拾われる。

合成東京ガス 1,138円・合成佐川急便 3,148円に上記の本文を付けた回帰テストを作成し、旧コードで誤検知することを確認してから修正した。本番の原本・OCR・メモは調べていない。

## 判定と表示

- `Vendor.obligationKind`: `TAX`（税金）/ `SOCIAL_INSURANCE`（社会保険）/ `NONE`（対象外）。未設定も選べる。既存支払先への自動書き込みはしない。
- 受領請求書は有効な同会社の支払先区分を優先。`NONE` は名称に税金の語があっても対象外。未設定の場合だけ**支払先名**で補助判定し、「名前による推定」と表示する。ファイル名・メモ・OCRからは判定しない。
- 郵便物は差出人名を全角半角・空白を正規化して支払先名と完全一致させる。一致した支払先の区分を優先し、一致なしは差出人名を補助判定。同名支払先が複数あり区分が異なる場合は推定しない（先頭の支払先を採用しない）。差出人が空欄なら本文から補わない。
- アーカイブ・却下・削除・別会社・無効案件・債務グループの支払対象外の書類は除く。支払額は既存の `receivedPaymentSummary` を使用し、有効な支払記録の残額で集計する。完済は別欄（直近20件）。保存状態が PAID でも記録不足なら未払いの残額を表示する。
- 郵便物は請求書・通知・その他のうち未処理かつ有効な受領請求書と未連携のものを候補とする。参照切れは有効な連携とみなさない。P0-7 の「連携が必要」判定とは目的が異なり、税金の通知も確認対象に残す。郵便物の処理フラグや連携は変更しない。
- `/partners?company=JAPAN&tab=vendors` の各支払先で区分を保存できる。新規追加にも同じ選択欄。管理者・経理のみ変更可能（`manage:vendors`）。区分保存失敗時は入力を保持し、理由を表示する。

## 対象外の記録

- 未払い一覧の行から理由必須で対象外にできる。`obligationExclusions` に対象ID、表示名・納付先・金額の控え、理由・日時・実施者を保存。元の書類、支払先、支払記録には書き込まない。
- 既定の未払い一覧・件数・金額には含めず、「対象外 N件」を開いて確認・復元する。復元も理由・日時・実施者を残す。再度対象外にした場合も過去の判断を残す。
- 元の書類が削除・支払済み・区分変更などで候補から外れても、対象外の記録は控えとともに残る。復元後に未払い候補の条件を満たさなければ一覧には再表示されないことを画面で説明する。
- 対象外の記録は対象ID単位で継続する。データ変更による自動解除はしない（P0-6 の整合性指摘の既知扱いとは別機能）。対象外登録前には、表示内容・支払額・元書類や支払先の更新情報を再検証する。

## 書類のない手入力未納

- `manualObligations` に名称・納付先・正の整数円の金額・期限・メモを保存。名称・納付先・金額は必須、期限不明は空欄で保存できる。日付があれば実在日付を検証する。
- 未払い → 支払済み（支払日・理由必須、今日以前）→ 支払済み取消で未払いに戻せる。別に、未払いの登録取消・その復元も理由付きで行える。支払済みの登録を取り消すときは先に支払済みを取り消す。
- 登録・状態変更の履歴（理由・日時・実施者・支払日）を保持する。支払済み・取消済みは別欄に表示する。対象外にした手入力行は、対象外を復元してから状態変更する。
- この補助台帳の支払済みは、請求書の `Payment` や銀行照合を生成しない。口座残高・ダッシュボードの請求書未払い・書き出しにも混ぜない。画面にもその意味を表示する。後日原本・請求書を登録した場合は、手入力分を理由付きで取り消して二重管理を避ける。
- 編集は管理者・経理（`manage:banking`）のみ。Server Action は保存ロック内で現在の利用者権限・日本スコープ・更新版・状態遷移を検証し、失敗時には保存・監査追記しない。成功時だけフォームを消し、失敗時は入力と理由を残す。
- 既存の `mutateData` 監査・Undoに両コレクションを含めた。新しい配列がない旧データも読み取りだけでは補完しない。最初の明示操作から復元用パッチを作る。

## エージェント・整合性・移行

- エージェントの既存 `GET /api/agent/v1/vendors`（`bank:read`）は保存した `obligationKind` を返す。新しい書き込みAPIは追加しない。手入力台帳・対象外のAPI操作はP1以降の範囲。
- `integrity` は元の書類・支払記録・参照関係を検査する。税金一覧からの除外で整合性指摘を消さない。P0-1 の郵便処理参考指摘も維持する。
- 既存値の自動移行は不要。未設定の支払先に区分を登録する判断材料として `scripts/migrations/vendor-obligation-kind-report.mjs` を用意した。**候補表示専用・未実行**。`--data <path>` を必須とし、ID・提案値・根拠・updatedAtを一覧にする。`--json` は標準出力。ファイル書き込み機能はなく、`--apply` / `--restore` / `--out` を拒否する。
- 候補は未設定・未削除・明示JAPANの支払先のみ。中国版の入力は拒否。候補生成・引数検証のテストはメモリ内の合成データで行い、CLIは実行しない。実データでの調査・適用は承認後に別作業。

## 検証と手動確認手順

- 追加20テスト: 誤検知の再現、区分優先/未設定、郵便物・同名支払先、支払対象外、部分払い/完済、除外/復元、元資料消失、手入力の全遷移、理由・日付・金額・権限・会社・競合、元データ不変、監査永続化・初回Undo、エージェント読み取り、候補スクリプトの純粋関数。
- 既存 `p2-operations` の判定テストは、ファイル名だけに依存していた例を、合成税務署の支払先を持つ例に更新した。
- 合成データ生成: `node --conditions=react-server --import tsx tests/prepare-obligations-preview.ts`。標準の合成利用者 `admin@example.invalid` / `accounting@example.invalid` / `mail_editor@example.invalid` / `chief@example.invalid` を含む（共通合成パスワードはスクリプト参照）。
- 初期画面: 未払い6件・33,400円・金額未登録2件・手入力1件、対象外1件。手入力の支払済み・取消済み2件。ガス・急便・NONEの支払先は一覧に出ない。名前推定の合成通知は表示される。
- `/partners?company=JAPAN&tab=vendors` で区分を変更して保存 → 税金一覧に反映。対象外・復元、未納追加、支払済み・その取消、登録取消・復元を実クリックし、成功・失敗表示と再読込後の保持を確認する。
- PC 1280px・タブレット820px・スマホ375px × ライト・ダークの確認はClaude担当。今回CodexはHTML/JSON確認まで。



### 検証結果

- 全テスト **610件成功（20件追加、失敗・スキップ0）**。全 lint 0件。隔離コピーで `npx tsc --noEmit`、production build と postbuild の静的ファイル配置に成功。
- 型検査で合成 Payment の必須 `createdById` 不足を検出して修正し、全テスト・型検査を再実行した。アプリの本番データは参照していない。
- standalone を空きポート3070で起動。初期一覧6件・33,400円・対象外1件、表示とHTML内の対象ID一致、ガス・急便・NONE除外、推定ラベル、支払先の新規区分/区分更新を確認。
- 実 Server Action で、対象外→5件/23,400円→復元→6件/33,400円、3,400円の手入力追加→7件/36,800円、支払済み→6件→支払済み取消→7件→登録取消→6件→復元→7件、郵便物の対象外操作を確認。
- 空欄・不正金額・理由なし・古い版・重複送信・権限なし・中国スコープを拒否。管理者と経理で保存成功。監査ログ10件と両コレクションのUndoパッチ、手入力履歴を確認。書類・郵便物・支払記録・銀行明細・照合・案件のデータは不変。
- `/api/banking/integrity` JSON と静的アセット200、未認証/郵便担当のアクセス拒否を確認。HTML/JSONの確認までで、実ブラウザのクリック・通知・6レイアウトは未確認（Claude担当）。起動したサーバーのみ停止済み。
- 実画面確認用（初期状態を保持）: `%TEMP%/triangle-obligations-preview-YmB7lp`。同じ場所の `uploads` をUPLOAD_DIRに指定する。
- HTTP確認のコピー・HTML・JSON: `%TEMP%/triangle-obligations-check-9t92Qe`。
- scratchpad の `p0-3-tests.log` / `p0-3-lint.log` / `p0-3-tsc.log` / `p0-3-build.log` / `p0-3-standalone.log`。既存server-userinfo制約への検証専用preloadを使用。アプリ本体には追加していない。
- 全変更ファイルでCRLFを維持。既存の他者差分は保持。補正スクリプトCLI未実行、Git書き込み・デプロイなし。追加のユーザー判断は不要。

### 変更ファイル（アプリ20ファイル）

- `src/lib/types.ts`
- `src/lib/obligation-classification.ts`
- `src/lib/tax-obligations.ts`
- `src/lib/obligation-edits.ts`
- `src/lib/store.ts`
- `src/lib/japan-storage.ts`
- `src/app/actions.ts`
- `src/app/partners/page.tsx`
- `src/app/banking/obligations/actions.ts`
- `src/app/banking/obligations/page.tsx`
- `src/components/app/vendor-obligation-editor.tsx`
- `src/components/app/obligations-workspace.tsx`
- `scripts/migrations/vendor-obligation-kind-report.mjs`
- `tests/obligations-fixture.ts`
- `tests/obligations.test.ts`
- `tests/obligations-store.test.ts`
- `tests/prepare-obligations-preview.ts`
- `tests/check-obligations.ts`
- `tests/p2-operations.test.ts`
- `docs/obligation-classification-2026-11-01.md`

別途、指定の `codex-progress.md` とVault改善計画ノートに完了記録を追記する。

提案コミット:

```text
fix(obligations): prioritize vendor classification and track manual obligations
```
