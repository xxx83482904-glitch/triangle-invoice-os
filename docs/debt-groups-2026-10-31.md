# 債務グループ（2026-10-31）

対象: 受領請求書の詳細「債務グループ」、`src/lib/debt-groups.ts`、照合・支払記録・ダッシュボード・集計の支払対象判定。

## 目的

同じ債務について届く 請求書 → 再請求 → 督促 → 領収書（および合計請求書）を1つの束として扱い、支払・照合・未払いの集計では **最新の1枚だけ** を支払対象にする。これまで同じ支払いが書類の枚数ぶん未払いに見えていた。

## データ

- `ReceivedInvoice.debtGroupId`（同じ束の書類で共通）、`debtRole`: `INVOICE` 請求書 / `REISSUE` 再請求 / `REMINDER` 督促 / `STATEMENT` 合計請求書 / `RECEIPT` 領収書。
- `STATEMENT` には `statementCurrentAmount`（今回御買上額）と `statementCarriedOver`（繰越）を記録する。差引支払額（`total`）は今回御買上額に合わせる運用で、違っていれば画面が注意を出す（自動では直さない）。
- 支払対象 = 役割が領収書以外の書類のうち、発行日（同日なら登録日）が最新の1枚（`payableDebtDocument`）。`isPayableReceivedInvoice` が各所の判定に使われる。

## 効き方

- 銀行・請求書照合: 支払対象外の書類は `eligible: false`（候補・配賦に出ない）。直接の照合要求は「債務グループの支払対象外の書類です…」で拒否。
- 支払記録: `recordPayment` は支払対象外の書類を拒否。既に支払記録がある書類を支払対象外にする役割変更・束ね方は拒否（先に記録を移すか取り消す）。
- ダッシュボード・集計（`/reports`）: 支払対象外の書類は未払い・支払予定の集計から除く。受領請求書一覧の「未払い」列は「対象外」と表示し、未払い絞り込みにも出ない。
- 書類自体は削除も状態変更もしない。郵便物の連携、原本、OCR 結果はそのまま。

## 画面

- 受領請求書の詳細（支払記録の下）に「債務グループ」。未グループなら候補（同じ支払先・半年以内で、同じ金額か再請求・督促・領収・合計の語を含む書類）をチェックして役割を選び「選んだ書類と束ねる」。グループ内では各書類の役割・金額・支払対象の印、「この書類の役割」の変更と保存、合計請求書の今回御買上額・繰越、「グループから外す」（1枚だけ残る場合はその書類も単独に戻る）。
- 権限は受領請求書の管理（`manage:receivedInvoices`）。
- エージェント API: `debt.group`（`payload.invoiceIds`, `roles`, `groupId?`）と `debt.unlink`（`target.id`）。スコープ `received:write`。

## 既存データの束ね候補（提案のみ）

`node scripts/migrations/debt-group-candidates.mjs --data <app-data.json> [--company JAPAN] [--out report.json]` が、未グループの受領請求書から同じ支払先・半年以内・同額または再請求等の語を含む組を列挙し、提案文を付けて出力する。データは変更しない。束ねる操作は画面か API で行う。

## 検証

```powershell
node --conditions=react-server --import tsx --test tests/debt-groups.test.ts
node --conditions=react-server --import tsx --test tests/*.test.ts
npx eslint src tests scripts
npx tsc --noEmit
```
