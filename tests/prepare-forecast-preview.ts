import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import { bankToday, mergeBankMasters, mergeBankTransactions, monthRanges, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { recordBankCoverage, shiftForecastMonth } from "../src/lib/bank-forecast";
import type { BankSyncState } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-forecast-preview-"));
  const data = fixture(), office = "0000-0001", today = bankToday(), month = today.slice(0, 7);
  data.users = (["ADMIN", "ACCOUNTING", "BILLING_EDITOR", "MAIL_EDITOR"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "テスト銀行", serviceName: "三菱UFJ銀行", isManual: false },
    { id: "bank", subId: "branch", name: "テスト銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false },
    { id: "bank", subId: "empty", name: "テスト銀行 / 履歴なし", serviceName: "三菱UFJ銀行", isManual: false },
    { id: "card", name: "テスト法人カード", serviceName: "テスト法人カード", isManual: false },
  ], []);
  const bankId = sourceKey("JAPAN", office, "account", "bank", "branch"), cardId = sourceKey("JAPAN", office, "account", "card");
  const items: ImportedTransaction[] = [];
  for (let offset = -6; offset <= 0; offset++) {
    const key = shiftForecastMonth(month, offset);
    for (const [day, side, amount, content, card] of [
      [20, "INCOME", 500000 + offset * 4000, "設計料 定期入金", false],
      [25, "EXPENSE", 100000, "事務所 家賃", false],
      [5, "EXPENSE", 150000, "法人カード精算", false],
      [28, "EXPENSE", 300000 - offset * 2000, "外注費 月次精算", false],
      [3, "EXPENSE", 30000, "カード 定期利用", true],
    ] as const) {
      const date = `${key}-${String(day).padStart(2, "0")}`;
      if (date <= today) items.push({ id: `${date}-${content}`, date, value: amount, side, content, journalizing_status: "none", connected_account_id: card ? "card" : "bank", connected_sub_account_id: card ? null : "branch" });
    }
  }
  mergeBankTransactions(data, "JAPAN", office, items, { start: `${shiftForecastMonth(month, -6)}-01`, end: today });
  data.bankTransactions.filter((row) => row.content === "法人カード精算").forEach((row) => { row.treatment = "TRANSFER"; });
  const state: BankSyncState = { id: "preview-sync", company: "JAPAN", officeCode: office, officeName: "架空の検証事業者", autoSync: false, status: "SUCCESS", lastSuccessAt: new Date().toISOString(), imported: items.length, updated: 0, createdAt: timestamp, updatedAt: timestamp };
  for (const range of monthRanges(`${shiftForecastMonth(month, -6)}-01`, today)) recordBankCoverage(state, range.start, range.end, [bankId, cardId]);
  data.bankSyncStates.push(state);
  data.bankAccounts.find((row) => row.id === bankId)!.forecastSettings = { accountKind: "BANK", balanceMonth: month, openingBalance: 200000, minimumBalance: 50000, incomePercent: 0, expensePercent: 0 };
  data.bankAccounts.find((row) => row.id === cardId)!.forecastSettings = { accountKind: "CARD", balanceMonth: month, minimumBalance: 0, incomePercent: 0, expensePercent: 0 };
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
void main();
