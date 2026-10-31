# P3 提案（項目18〜24）と移行案（2026-10-31）

この文書は提案と調査結果で、画面・データの変更は含まない。20・21 はドライラン専用のスクリプトまで用意した。実施はそれぞれ別の PR と承認で行う。

## 18. 保存ボタン3つの統合（口座・カード明細）

現状: 「選択を保存」「確認済みを保存」「編集を保存」の3ボタン。それぞれ保存対象（選択中の行＋自動候補／確認済みにした下書き／手動編集した下書き）が違い、件数も別々に出る。

提案:
- ボタンを「保存…」1つにし、押すと保存確認ダイアログ（既存 `BankSavePreviewDialog`）の先頭で対象を選ぶ（選択中 N件 / 確認済みの編集 N件 / 編集した明細 N件 / すべての編集）。既定は「すべての編集」。
- 自動候補の採用（選択中の未保存候補）は対象を「選択中」にしたときだけ含める、という今の意味は保つ。
- 変更範囲は `banking-workspace.tsx` のフッターと `bank-save-preview.tsx`。`bankSaveIds` / `bankSaveChanges` の scope はそのまま使える。モバイルのフッター高さが減る。

## 19. 確度ラベルと確認済みの整理

PR-5 で「推測のまま確認済みにする」操作に確認を求め、根拠に接頭辞を残すようにした。残る整理:
- ラベル体系を「根拠（推測・過去実績・推定・ルール）」と「状態（未確認・確認済み・保留）」の2軸に分け、バッジを2つにする（今は確認済みで根拠が隠れる）。
- 確認済み行の根拠は tooltip ではなく明細詳細に表示する。
- 既存データの移行は不要（`classificationConfidence` と `reviewed` が既にある）。

## 20. 科目重複・取引先名混在の補助科目化（移行案のみ）

スクリプト `scripts/migrations/category-dedupe-report.mjs --data <app-data.json>` が、(a) 正規化した名称が同じ科目（事業者違い・ローカル科目と連携科目）、(b) 確認済み明細で同じ摘要に複数の科目が使われている摘要、を列挙し、提案文（連携科目へ寄せる／親科目に補助科目「摘要名」を作って寄せる）を出す。

移行手順案（承認後）:
1. 報告の重複科目ごとに正本を決める（連携科目を優先）。
2. 一括変更（P2-13）で確認済み明細も含めて正本へ付け替える。
3. 補助科目は Money Forward 側で作ってから同期し、ローカルの補助科目は作らない（連携科目は削除できない制約があるため）。
4. ルール（`bankRules`）の科目参照を付け替える。

## 21. 受領請求書の状態の簡素化

スクリプト `scripts/migrations/received-status-simplify.mjs --data <app-data.json>` が現在の状態別件数、提案マッピング後の件数、状態と支払記録の不一致を出す。

提案マッピング: `RECEIVED` / `OCR_PENDING` / `REVIEWING` / `APPROVAL_PENDING` → **確認中**（`REVIEWING`）、`SCHEDULED` → 支払予定、`PAID` → 支払済み（支払記録から導出。PR-3 で既に導出に変更）、`ON_HOLD` / `REJECTED` / `ARCHIVED` は維持。

適用時の注意: 状態の enum を減らすとき、`statusOptions`・フィルター・ダッシュボードの timing・section export の状態ラベルを同時に更新する。古い値の読み込みは `normalizeData` で写像する（データの一括書き換えはしない）。

## 22. 案件作成の契約金額任意化と段階初期値廃止

現状: `createProject` は契約金額が空なら 0、段階が空なら「制作资料」（中国語表記）を入れる。

提案:
- 契約金額を任意（`contractAmount?: number`）にし、未設定は「—」と表示。集計（`projectMoney`）は未設定を 0 ではなく「未設定」として扱う。
- 段階の初期値は入れず、未設定を許す。段階の選択肢は `selectOptions`（`PROJECT_STAGE`）に従う。
- 既存データの 0 円・「制作资料」は移行しない（意味が確定できないため）。表示だけ「未設定」にそろえる。

## 23. 変更履歴の変更元表示

PR-7 で `AuditLog.origin { kind: user | agent | sync | ai, tokenId, reason }` を追加した。提案:
- 変更履歴（元に戻す）一覧に「人 / エージェント（トークン名）/ 同期 / AI」のバッジと理由を表示する。
- 既存ログは `origin` がないので「人」扱い。同期は `userId === "system-moneyforward"` でも判定できる。
- エージェント経由の変更は、取り消し（undo）前に理由を見られるようにする。

## 24. OCR の最小ガード

現状の OCR は受領請求書の取込時に必ず走り、失敗時も書類は保存される。提案（停止はユーザー確認が必要）:
- 1日の実行回数と1ファイルの大きさに上限を設け、超えたら OCR を飛ばして「OCR 未実行」で保存する。
- `OCR_DISABLED=true` で OCR を完全に止められるようにし、画面に「OCR 停止中（手入力）」と表示する。
- 停止・上限値の既定は変えない。切り替えはユーザーが判断する。

## 検証

```powershell
node --conditions=react-server --import tsx --test tests/p3-reports.test.ts
node scripts/migrations/received-status-simplify.mjs --data <app-data.json>
node scripts/migrations/category-dedupe-report.mjs --data <app-data.json>
```

どちらのスクリプトも読み取り専用で、`--out` で JSON を保存できる。本番データで実行する場合は NAS 上のファイルを読み取り専用で参照する（コピーを取り、`--apply` は存在しない）。
