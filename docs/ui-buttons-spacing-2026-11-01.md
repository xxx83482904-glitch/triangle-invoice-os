# UI改善 第1弾 — ボタン・余白・カード・グループ

対象ブランチ: `codex/ui-buttons-spacing` / 比較元: `b16145c`。

目的は「押せるもの」「情報のまとまり」を見分けやすくすること。変更はクラス、マークアップ、共通UI部品、CSSのみ。既存の業務文言・URL・権限条件・入力値・フォームの送信内容・イベント処理・保存処理は維持する。区切りを示す見出しだけを追加した。会社による新しい分岐はない。データ補正・移行・デプロイは行わない。

## 共通基準

### ボタン

| 用途 | variant | 基準 |
| --- | --- | --- |
| 保存・登録・確定 | `default` | 主操作。既存の保存・送信処理を使う |
| 移動・詳細・関連画面 | `soft` または `outline` | アイコン＋既存の文言。リンクは `Button asChild` とし、元のa/Linkを維持 |
| 削除などの危険操作 | `destructive` | 今後の統一基準。今回、既存の業務操作は組み替えない |
| 閉じる・選択解除など | `ghost` | 補助操作 |

- `soft`: `bg-primary/10 text-primary hover:bg-primary/15`。ダークは同じトークンで背景を15%/20%にする。
- `outline`: `border-input`、hover時の枠・背景、`shadow-xs`を付ける。
- PC（lg以上）: default 36px / sm 32px / xs 28px / lg 40px、icon 36px / icon-sm 32px / icon-xs 28px / icon-lg 40px。
- lg未満は最小44px。長い文言のリンクは折り返して高さを増やす。既存の明示的な44px指定は無理に縮めない。
- 新しい`link` variantの使用はない。互換性のためvariant定義は残す。
- 矢印だけのページ送りは既存のaria-label・titleを維持し、outlineで枠を示す。指標カード内の矢印は装飾であり、別のボタンを入れ子にしない。
- 表やリストの主項目名、説明文中のリンクは文字リンクのまま。`hover:text-primary hover:underline underline-offset-4`で区別する。

### ナビ・タブ

- DesktopAppNav: 36px、角丸、左右12px、13px文字、gap 4px。現在地はprimaryの背景・文字と太字。項目のURL・権限・順序は同じ。
- デスクトップヘッダー: 最小64px。1024〜1439pxではブランドの文字部分を視覚的に畳み、Tマークと全メニュー項目に幅を配分する。ブランドのアクセシブルな名前は残す。メニューは幅不足時に折り返す。
- WorkflowNav・Tabs・月ナビ・処理状態切替: mutedの角丸容器、間隔4px、現在地はbackground＋影＋太字。狭い画面では折り返す。Tabsの`line`指定も表示をセグメント型に統一し、Radixの選択・キーボード操作は変えない。
- モバイル下部メニューの項目・状態判定・構造は変更しない。既存のprimary背景と`aria-current`を維持する。実機での現在地の視認性はClaude側で確認する。

### 余白・カード・グループ

- workspace-main: PC左右32px、上下24px。固定保存バー・モバイル下部メニューのための余白は残す。
- PageHeader: `mb-6 py-4`、タイトル24px、操作の間8px。
- Card: `rounded-xl bg-card border shadow-sm`、上下・左右20px、要素間16px、本文13px。CardHeaderの見出し・説明・右側操作用グリッドは維持する。section variantの「枠を消す」CSS上書きを除いた。
- 主要セクション間24px、カード間16〜24px。表は表のままカードの中で横スクロールできる。
- 共通Tableと郵便・受領・発行の表: 見出し44px、通常セル上下10px・左右12px、hover背景。選択チェックの`p-0`セルは従来の44px領域を保持。
- `/banking`の表は別クラスで、既存のPC行高62px・セル上下6pxを維持。行内の照合ボタンはsoft、PC最小32px、lg未満44px。上部・絞り込みを主に広げる。
- Input・Selectおよび主要画面のnative selectはPC36px、lg未満44px。口座表内の既存34px入力は例外として維持する。
- 操作は用途別の`role="group"`と見出し、間隔24pxで区切る。折り返しを優先し、ButtonGroupの新部品は追加しない。
- 絞り込みは`workspace-filter-panel`、詳細は`workspace-detail-group`で枠・背景・内側余白を揃える。フォームを増やしたり、入力を別フォームへ移したりしない。

## 主要画面の変更

| 画面 | 変更 |
| --- | --- |
| ダッシュボード | 指標4つを独立カード化。カード全体の元のクリック・スクロール処理を維持。矢印は丸い装飾。対応する書類・口座残高・確認待ち／連携・月別を見出し付きカードにし、書類・口座の各行にも枠と余白を付けた |
| 口座明細 | 上部を「確認・出力」「設定・同期」、表上を「選択」「履歴」「分類」に分ける。月・検索・条件適用を「絞り込み」にまとめ、表・選択時の保存バーを囲む。保存ボタンの統合や保存範囲の変更はしない |
| 銀行・書類照合 | 絞り込み帯、銀行一覧／右側詳細をカード化。詳細は「基本情報・金額」、対応請求書、資金移動／精算先、照合済み記録、AI確認に区切る。元の並び順を維持 |
| 整合性 | 種類の絞り込みを背景付きのまとまりに。種類の一括操作・各指摘を独立カード化。指摘内の関連リンクをボタン化 |
| 郵便仕分け | 絞り込み・表示切替をまとめ、選択バー・表・詳細に余白。一覧・フォルダー両方の編集欄を「基本情報・連携」「金額・支払」に分ける。処理状態の保存や再連携処理は同じ |
| 受領請求書 | 集計カードの間隔・狭い画面の縦積み、絞り込み見出し、表のカード化。詳細は「基本情報」「金額・支払」「連携」「詳細編集」に分ける。集計基準・絞り込み条件は同じ |
| 発行請求書 | セクション24px、月ナビ、絞り込み帯、表・選択一括操作の囲み。詳細の編集は「基本情報」「金額・入金」で区切る。状態変更・入金確認のルールは同じ |

指定された追加箇所として、口座一覧の各口座と税金・保険の未払い各行も1件ずつカード化した。他画面は共通部品・移動リンク・主項目のhoverを中心に適用する。

## リンク・矢印の全件点検

比較元`b16145c`の`src/**/*.tsx`で、`text-primary…underline`・`hover:underline`・`ArrowRight|ChevronRight|ArrowUpRight`を全件点検した。30ファイル85行（import宣言19行、表示・部品定義66行）。同一行の複数用途は以下で併記する。行番号は比較元の番号であり、変更後の番号ではない。`ArrowRightLeft`も検索に含める。

| ファイル（src/以下）・比較元行 | 判断・理由 |
| --- | --- |
| app/banking/forecast/page.tsx:20、insights/page.tsx:20 | 口座へ戻るリンクをsoft＋アイコン化 |
| app/dashboard/dashboard-table.tsx:230 | 案件名は主項目のため文字リンク、hover強化 |
| app/dashboard/dashboard-workspace.tsx:45,51,57,63 | 指標は全体が操作対象のカード、矢印は装飾として丸い背景を追加 |
| 同:82,85 | 書類一覧・残高設定をsoft化 |
| 同:87,99,117,123 | 口座・書類・確認待ちの行全体をカード／背景付きの移動領域にする。矢印を別操作にしない |
| 同:142 | 前後の決算期は既存の名前・title付きiconボタン。outline化 |
| app/mail-sorter/ocr-documents-table.tsx:1115 | 月の開閉状態を示すChevron。見出し全体が既存ボタンなので保持 |
| app/mail-sorter/page.tsx:175 | すべての郵便物に戻るリンクをsoft＋アイコン化 |
| app/projects/projects-table.tsx:181 | 案件名は主項目のため文字リンク、hover強化 |
| app/received-invoices/received-invoices-workspace.tsx:260,281 | 月開閉のChevronは保持。案件名は主項目として文字リンク、hover強化 |
| components/app/bank-accounts-workspace.tsx:66,97,113,137,143,145 | 年度送りはoutline。口座名・月名は主項目として保持しhover強化。「明細・同期へ」「月の明細」はsoft。入出金方向の矢印は操作ではないため保持 |
| components/app/bank-ai-panel.tsx:57,59,62,71 | 請求書・郵便物タイトルは主項目、データ保持方針は説明文の参照なので文字リンク。「銀行の照合画面へ」はsoft |
| components/app/bank-category-picker.tsx:38,45 | 大分類のChevronは見出し内の開閉表示。補助科目は既存のaria-label・title付きiconボタンをoutline化 |
| components/app/bank-classification-ai-dialog.tsx:65 | 既にoutline・aria-label・title付きのページ送り。変更不要 |
| components/app/bank-insights-workspace.tsx:30,54,87,88 | 明細・未分類件数の操作はsoft。科目名は各行の主項目として文字リンク、hover強化 |
| components/app/bank-integrity-workspace.tsx:53,62 | ページ送りはoutline、各指摘の関連リンクはsoft |
| components/app/bank-ledger-controls.tsx:17 | 前後年度の既存iconボタンをoutline化。名前とtitle維持 |
| components/app/bank-links-dialog.tsx:66,87,96 | 関連カード口座・相手明細への移動はsoft。照合済み請求書の名称は文字リンク |
| components/app/bank-payroll-workspace.tsx:45 | 従業員／支払先名は行の主項目なので文字リンク、hover強化 |
| components/app/bank-reconciliation-allocation.tsx:105 | 書類・原本への各リンクをsoft化 |
| components/app/bank-reconciliation-desk.tsx:66,78,79,98 | ページ送りはoutline。資金移動先・精算口座・元明細のリンクはsoft |
| components/app/bank-reconciliation-workspace.tsx:89,106 | 郵便物の確認・書類リンクはsoft |
| components/app/bank-review-panel.tsx:30,35 | ページ送りはoutline、確認事項の関連リンクはsoft |
| components/app/bank-save-preview.tsx:38 | 前後の変更は既存iconボタンをoutline化。名前とtitle維持 |
| components/app/documents-workspace.tsx:339,343,362,365 | 月・取引先グループのChevronは見出しボタン内の開閉表示。書類名は主項目のため文字ボタン、hover強化 |
| components/app/estimates-list.tsx:137,192,200 | 変換アイコンは既存メニュー項目、Chevronはグループの開閉表示。見積番号は主項目で文字ボタン、hover強化 |
| components/app/estimates-workspace.tsx:105 | ArrowRightLeftは文言付きの既存変換submitボタン。送信機能を維持、変更不要 |
| components/app/obligations-workspace.tsx:65 | 受領請求書・郵便物フォルダーを開くリンクをsoft＋アイコン化 |
| components/app/section-export-dialog.tsx:89 | 書き出しプレビューの原本リンクをsoft化 |
| components/ui/badge.tsx:21、button.tsx:21 | link variantの定義。互換性のため残す、新規使用なし |
| components/ui/dropdown-menu.tsx:235 | サブメニューの向きの表示。既に名前付きのメニュー項目に含まれるため保持 |

検索語に一致しない独立操作も確認し、以下を追加でボタン化した。

- 郵便物・受領請求書・案件詳細の「表示」、案件一覧の「契約書」。
- 整合性・税金保険・給与・口座一覧の上部関連リンク、整合性JSON。
- 口座予測・出金傾向の戻る／関連リンク、共通BankReconciliationLink。
- 照合一覧の「銀行候補・照合記録」、ダッシュボードの「元明細なし」。

追加点検で文字リンクのまま残したもの:

- projects-workspaceの契約書ファイル名: 書類の主項目名。
- obligations-workspaceの「支払先の区分を設定」: 説明文中の参照。hoverを強化。
- DocumentContextMenu / DropdownMenu内のリンク: 既に名前・アイコン・広い選択領域を持つメニュー項目。
- ダッシュボードの「全期間 / 未完了」: 元からクリック処理のない集計範囲の説明。新しい操作にはしない。

## 検証・引き継ぎ

- 全テスト: **654成功、失敗0、skip 0**。表示のみの変更なので新しい挙動テストは追加していない。
- 全lint: `npx eslint src tests scripts` 成功、警告なし。
- 型検査: 既存の隔離コピーで`npx tsc --noEmit`成功。本番data/uploads/.envをコピーしていない。
- Tailwind/PostCSSのCSS単体コンパイル: 成功、警告なし。production buildの代わりではない。
- ソースのAST比較: 既存のURL・action・form・name・type・値・制約・disabled・イベント処理・JSX spreadは比較元と一致。見出し追加以外の既存テキスト・権限判定・業務関数を変更しない。
- CRLFを維持。ユーザーの未コミットファイル・郵便フラグ移行スクリプトは変更しない。
- Git書き込み・production build・standalone・画面確認・デプロイはCodexでは実施していない。次はClaudeによるbuild／standalone／画面確認。今回はmainへの取り込み・デプロイ指示はない。

画面確認（未実施、Claude担当）: 主要7画面＋口座一覧・税金保険を、1280・820・375px × ライト／ダークで比較する。特に、1280pxの全管理メニュー1行、モバイル下部メニューの現在地、長い関連リンクの折り返し、表の内部スクロール、月・種類タブの選択表示、詳細パネル／選択バー／固定保存バー、キーボードフォーカスを確認する。横はみ出しの有無は静的検査だけでは確定していない。

提案コミットメッセージ:

```text
style(ui): clarify navigation, actions, and workspace groups
```

## 変更ファイル一覧

以下は今回の変更のみ。ユーザーの既存未コミット差分は含めない。

- [src/app/banking/forecast/page.tsx](../src/app/banking/forecast/page.tsx)
- [src/app/banking/insights/page.tsx](../src/app/banking/insights/page.tsx)
- [src/app/banking/obligations/page.tsx](../src/app/banking/obligations/page.tsx)
- [src/app/dashboard/dashboard-table.tsx](../src/app/dashboard/dashboard-table.tsx)
- [src/app/dashboard/dashboard-workspace.tsx](../src/app/dashboard/dashboard-workspace.tsx)
- [src/app/globals.css](../src/app/globals.css)
- [src/app/issued-invoices/page.tsx](../src/app/issued-invoices/page.tsx)
- [src/app/mail-sorter/ocr-documents-table.tsx](../src/app/mail-sorter/ocr-documents-table.tsx)
- [src/app/mail-sorter/page.tsx](../src/app/mail-sorter/page.tsx)
- [src/app/projects/[id]/page.tsx](../src/app/projects/[id]/page.tsx)
- [src/app/projects/projects-table.tsx](../src/app/projects/projects-table.tsx)
- [src/app/projects/projects-workspace.tsx](../src/app/projects/projects-workspace.tsx)
- [src/app/received-invoices/received-invoices-workspace.tsx](../src/app/received-invoices/received-invoices-workspace.tsx)
- [src/components/app/bank-accounts-workspace.tsx](../src/components/app/bank-accounts-workspace.tsx)
- [src/components/app/bank-ai-panel.tsx](../src/components/app/bank-ai-panel.tsx)
- [src/components/app/bank-category-picker.tsx](../src/components/app/bank-category-picker.tsx)
- [src/components/app/bank-forecast-workspace.tsx](../src/components/app/bank-forecast-workspace.tsx)
- [src/components/app/bank-insights-workspace.tsx](../src/components/app/bank-insights-workspace.tsx)
- [src/components/app/bank-integrity-workspace.tsx](../src/components/app/bank-integrity-workspace.tsx)
- [src/components/app/bank-ledger-controls.tsx](../src/components/app/bank-ledger-controls.tsx)
- [src/components/app/bank-links-dialog.tsx](../src/components/app/bank-links-dialog.tsx)
- [src/components/app/bank-payroll-workspace.tsx](../src/components/app/bank-payroll-workspace.tsx)
- [src/components/app/bank-reconciliation-allocation.tsx](../src/components/app/bank-reconciliation-allocation.tsx)
- [src/components/app/bank-reconciliation-desk.tsx](../src/components/app/bank-reconciliation-desk.tsx)
- [src/components/app/bank-reconciliation-link.tsx](../src/components/app/bank-reconciliation-link.tsx)
- [src/components/app/bank-reconciliation-workspace.tsx](../src/components/app/bank-reconciliation-workspace.tsx)
- [src/components/app/bank-review-panel.tsx](../src/components/app/bank-review-panel.tsx)
- [src/components/app/bank-save-preview.tsx](../src/components/app/bank-save-preview.tsx)
- [src/components/app/banking-settings.tsx](../src/components/app/banking-settings.tsx)
- [src/components/app/banking-workspace.tsx](../src/components/app/banking-workspace.tsx)
- [src/components/app/company-switch.tsx](../src/components/app/company-switch.tsx)
- [src/components/app/documents-workspace.tsx](../src/components/app/documents-workspace.tsx)
- [src/components/app/estimates-list.tsx](../src/components/app/estimates-list.tsx)
- [src/components/app/list-selection.tsx](../src/components/app/list-selection.tsx)
- [src/components/app/obligations-workspace.tsx](../src/components/app/obligations-workspace.tsx)
- [src/components/app/record-list-controls.tsx](../src/components/app/record-list-controls.tsx)
- [src/components/app/section-export-dialog.tsx](../src/components/app/section-export-dialog.tsx)
- [src/components/app/shell.tsx](../src/components/app/shell.tsx)
- [src/components/ui/button.tsx](../src/components/ui/button.tsx)
- [src/components/ui/card.tsx](../src/components/ui/card.tsx)
- [src/components/ui/input.tsx](../src/components/ui/input.tsx)
- [src/components/ui/select.tsx](../src/components/ui/select.tsx)
- [src/components/ui/table.tsx](../src/components/ui/table.tsx)
- [src/components/ui/tabs.tsx](../src/components/ui/tabs.tsx)
- [docs/ui-buttons-spacing-2026-11-01.md](ui-buttons-spacing-2026-11-01.md)
