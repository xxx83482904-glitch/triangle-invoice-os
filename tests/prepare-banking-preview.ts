import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp, admin } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, saveBankRule, sourceKey } from "../src/lib/banking";
import type { UserRole } from "../src/lib/types";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-banking-preview-"));
  const data = fixture(), office = "0000-0001";
  data.users = (["ADMIN", "ACCOUNTING", "BILLING_EDITOR", "MAIL_EDITOR"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "テスト銀行", serviceName: "テスト銀行", isManual: false },
    { id: "bank", subId: "branch", name: "テスト銀行 / 普通預金", serviceName: "テスト銀行", isManual: false },
    { id: "card", name: "テスト法人カード", serviceName: "テスト法人カード", isManual: false },
  ], [
    { id: "sales", name: "売上高", group: "INCOME", available: true },
    { id: "design", parentSourceId: "sales", name: "設計料", group: "INCOME", available: true },
    { id: "travel", name: "旅費交通費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "utility", name: "水道光熱費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  saveBankRule(data, admin, "JAPAN", { name: "電車代を交通費へ", keyword: "電車", match: "CONTAINS", side: "EXPENSE", categoryId: sourceKey("JAPAN", office, "category", "travel"), treatment: "NORMAL", priority: 100, enabled: true });
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const items = Array.from({ length: month === "2026-09" ? 55 : 5 }, (_, i) => ({ id: `${month}-${i}`, date: `${month}-${String(i % 7 + 1).padStart(2, "0")}`, value: (i + 1) * 1250, side: i % 3 ? "EXPENSE" as const : "INCOME" as const, content: i % 3 ? `電車 テスト交通費 ${i}` : `設計料 テスト入金 ${i}`, memo: null, journalizing_status: "none", connected_account_id: i % 3 ? "card" : "bank", connected_sub_account_id: i % 3 ? null : "branch" }));
    mergeBankTransactions(data, "JAPAN", office, items, { start: `${month}-01`, end: `${month}-28` });
  }
  const first = data.bankTransactions[0];
  saveBankEdits(data, admin, "JAPAN", [{ id: first.id, updatedAt: first.updatedAt, categoryId: sourceKey("JAPAN", office, "category", "sales"), subCategoryId: sourceKey("JAPAN", office, "category", "design", "sales"), treatment: "NORMAL", reviewed: true, memo: "保存済みのテスト明細" }]);
  data.bankTransactions[1].treatment = "TRANSFER";
  data.bankTransactions[2].sourceMissing = true;
  const example = data.bankTransactions.find((row) => row.side === "EXPENSE")!;
  data.bankTransactions.push(
    { ...example, id: "auto-preview", sourceId: "auto-preview", transactionDate: "2026-10-08", content: "東京電力 電気料金", amount: 12500, categoryId: undefined, ruleId: undefined, classificationReason: undefined, classificationSource: "UNASSIGNED", treatment: "NORMAL", reviewed: false, memo: "" },
    { ...example, id: "unknown-preview", sourceId: "unknown-preview", transactionDate: "2026-10-08", content: "AMAZON テスト購入", amount: 3300, categoryId: undefined, ruleId: undefined, classificationReason: undefined, classificationSource: "UNASSIGNED", treatment: "NORMAL", reviewed: false, memo: "" },
  );
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
void main();
