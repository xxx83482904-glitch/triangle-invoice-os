# P0-4 給与一覧の対象科目・年度選択（2026-11-01）

ブランチ `codex/p0-4-payroll-targets`（P0-3 `a2212f5` の上）。Git書き込み・取り込み・実画面確認はClaude担当。P0-4だけで停止する。

## 原因と再現

旧 `payrollCategoryPattern` が単独の「報酬」と源泉所得税・住民税・社会保険料・法定福利を含んでいた。合成支払報酬55,000円、科目分割内の外部報酬20,000円、税金・保険料を含む回帰テストを追加し、旧コードが対象に含めることを確認して修正した。

## 対象科目と設定

- 初期対象は名称に給与・給料・賞与・役員報酬・退職金・通勤手当を含む科目。NFKCと空白を正規化する。「報酬」単独は使わない。支払報酬・源泉所得税・住民税・社会保険料・法定福利・税金を含む複合名は安全側で初期対象から外す。
- `/banking/payroll` の「対象科目の設定」で会社ごとにチェックして保存。`AppData.payrollSettings` に `mode: DEFAULT | CUSTOM` と科目IDを持つ。未設定はDEFAULT扱いで、読み取りだけでは保存・移行しない。
- CUSTOMは選んだIDだけが対象。**空配列は「対象0科目」**で、初期対象に戻さない。支払報酬なども明示的に選んだ場合だけ集計できる。「初期対象に戻す」はDEFAULTへ保存し、今後追加される給与科目にも名前の規則を使う。
- 同会社・未削除の主科目を選べる。補助科目は親科目の対象設定に従う。使用停止の主科目は過去明細の集計のため残し、画面で説明する。同名でも事業者・IDが違えば別の選択肢。削除等で使えなくなった保存済みIDは集計に含めず警告し、次の明示保存で外す。
- 管理者・経理（`manage:banking`）だけ保存可能。保存ロック内で現在の利用者・会社・科目・更新版を検証する。競合・権限不足・不正入力は変更せず返す。成功/失敗を画面に表示し、失敗時にはチェックを保持する。
- 監査 `SAVE_PAYROLL_SETTINGS` に会社・変更した科目ID/名称・実施者・更新日時を記録。初回保存からUndo対応。銀行明細・科目マスター・科目の割当・確度・確認状態・支払記録は変更しない。
- 集計は既存 `bankCategoryAllocations` を通し、科目分割は対象部分だけを加算する。入金・資金移動・対象外・元明細なし・連携元で対象外・不正日付・非正数は含めない。

## 年度の優先順位と記憶

1. 有効なURLの `year`（1901〜2200）。
2. このブラウザで同じ利用者・会社が前回選んだ年度。
3. 選択中の科目に該当する明細がある最新の決算年度。
4. 対象明細がなければ、有効な口座明細の最新年度。
5. 明細自体がなければ現在年度。

決算年度は9月〜翌8月。自動選択には同会社・本日以前の実在日付の明細を使い、元明細なし・連携元で対象外の明細を除く。3では出金・通常扱い・正の対象配賦額も条件にする。外部報酬しかない新しい年度で給与一覧が空になることを防ぐ。URL/前回の選択は空の年度でも尊重し、選択肢にも残す。

保存先は利用者ID・会社別の **HttpOnly Cookie**（`triangle-payroll-year-<encoded-user-id>-<company>`）。年度プルダウンの操作時だけServer Actionで保存する。Pathは `/banking/payroll`、期限1年、SameSite=Lax、Secureは既存セッションCookieと同条件。本番値・トークン・会計データは入れない。

選択年度は閲覧上の好みなのでアプリデータや監査ログへの書き込みを避け、サーバー描画時に読むことで年度の表示が後から切り替わるちらつきを防ぐ。利用者別キーなので共有PCの別ログインに前の人の年度を引き継がない。他のブラウザとは共有しない。Cookieを削除/拒否した場合は自動選択に戻る。

URLを直接開くだけでは記憶を書き換えない（URL指定中だけ優先）。プルダウンで選んだ年度を記憶する。記憶用通信に失敗した場合は理由を表示し、URLによる年度切替は行う。ページGET・事前読み込みでデータを保存しない。

## 検証と画面確認用データ

- 追加19テスト: 初期6系統、単独報酬・外部報酬・税金・保険の除外、名前正規化、設定保存/初期化/0科目、事業者別同名科目、過去の使用停止科目、削除・別会社・補助科目、競合/権限/不正入力、科目分割、年度優先と境界、利用者別Cookieキー、読み取り不変、初回監査・Undo。
- `tests/prepare-payroll-preview.ts` は標準合成利用者 `admin@example.invalid`、`accounting@example.invalid`、`mail_editor@example.invalid`、`chief@example.invalid` を含む。共通合成パスワードはスクリプト参照。
- 2024/2025/2026年度の給与と、2027年度の外部報酬のみの明細を用意。初期表示は **2026年度（2025.09〜2026.08）・6科目・1,290,000円**。役員報酬だけ選ぶと400,000円、支払報酬だけを明示選択すると2026年度75,000円（自動年度は2027年度60,000円）。2025年度の給与は200,000円、2024年度は190,000円。
- 実画面で科目チェック→保存通知→再読込、初期対象へ復元、0科目、年度変更→年指定なしのURLへ戻る、別利用者での年度分離を確認する。PC1280px・タブレット820px・スマホ375px×ライト・ダークはClaude担当。横長の月次表は既存の表内横スクロールを維持する。
- 既存データ補正・移行スクリプトは不要。エージェントAPIの変更もない。



## 検証結果

- 全 **629テスト成功（19追加、失敗・スキップ0）**。全lint 0件。隔離コピーで `npx tsc --noEmit`、production build、postbuildの静的ファイル配置に成功。
- standaloneを空き3070で起動し、初期2026年度・6科目・1,290,000円、表示されたチェックと集計対象IDの一致を確認。役員報酬は対象、外部報酬・税金・保険料は初期対象外。
- 実Server Actionで役員報酬のみ保存（400,000円）→対象0科目（0円）→支払報酬を明示選択（2026年度75,000円、自動選択2027年度60,000円）→初期対象へ復元（2026年度1,290,000円）を確認。
- 科目設定の監査4件とUndoパッチを確認。古い設定版・重複ID・不明科目・権限なし・中国スコープは拒否。元の明細・科目マスター・書類・支払記録・利用者等は不変。
- 年度記憶は管理者2025年度、経理2024年度で分離。URL指定が記憶に優先し、URLから戻ると元の記憶に戻る。無効なURL/Cookieは安全にフォールバック。CookieのPath/HttpOnly/SameSiteを確認。年度の記憶操作ではアプリデータ・監査ログを書き換えない。
- 未認証・郵便担当は給与一覧に入れず、静的アセットと整合性JSONは200。HTTP/HTML/JSONまでを確認。実クリック・保存通知・PC/タブレット/スマホ×ライト/ダークはClaude担当として未実施。自分で起動したstandaloneのみ停止済み。
- 実画面確認用データ（初期状態を保持）: `%TEMP%/triangle-payroll-preview-f7bq7T`。UPLOAD_DIRは同じ場所の `uploads`。生成スクリプトは `tests/prepare-payroll-preview.ts`。
- HTTP確認用コピー・HTML・JSON: `%TEMP%/triangle-payroll-check-c3zQMN`。
- scratchpadの `p0-4-tests.log` / `p0-4-lint.log` / `p0-4-tsc.log` / `p0-4-build.log` / `p0-4-standalone.log` に結果。既存の検証専用userinfo preloadを使用し、アプリには導入していない。
- 既存の他者差分は保持。変更ファイルはCRLFを維持。既存データの補正は不要で、移行スクリプトなし。Git書き込み・デプロイなし。追加のユーザー判断は不要。

## 変更ファイル（アプリ15ファイル）

- `src/lib/types.ts`
- `src/lib/payroll-settings.ts`
- `src/lib/payroll-summary.ts`
- `src/lib/store.ts`
- `src/lib/japan-storage.ts`
- `src/app/banking/payroll/actions.ts`
- `src/app/banking/payroll/page.tsx`
- `src/components/app/payroll-target-settings.tsx`
- `src/components/app/bank-payroll-workspace.tsx`
- `tests/payroll-fixture.ts`
- `tests/payroll-targets.test.ts`
- `tests/payroll-settings-store.test.ts`
- `tests/prepare-payroll-preview.ts`
- `tests/check-payroll.ts`
- `docs/payroll-targets-2026-11-01.md`

別途、指定の `codex-progress.md` とVault改善計画ノートに完了記録を追記。

提案コミット:

```text
fix(payroll): configure payroll categories and remember fiscal year per user
```
