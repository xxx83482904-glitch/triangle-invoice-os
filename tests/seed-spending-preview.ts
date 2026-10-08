import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bankToday } from "../src/lib/banking";
import { shiftForecastMonth } from "../src/lib/bank-forecast";
import type { AppData } from "../src/lib/types";

async function main() {
  const root = path.resolve(process.argv[2]);
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const file = path.join(root, "app-data.json"), data = JSON.parse(await readFile(file, "utf8")) as AppData;
  assert.ok(data.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(data.bankAccounts.every((row) => row.name.startsWith("テスト")));
  const account = data.bankAccounts.find((row) => row.sourceSubId === "branch")!;
  assert.ok(account);
  await copyFile(file, path.join(root, `before-spending-${Date.now()}.json`));
  const month = bankToday().slice(0, 7), timestamp = new Date().toISOString();
  data.bankTransactions = data.bankTransactions.filter((row) => !row.id.startsWith("spending-preview-"));
  data.accountingCategories = data.accountingCategories.filter((row) => !row.id.startsWith("spending-preview-"));
  for (const [id, name] of [["rent", "地代家賃"], ["outsource", "外注費"]]) data.accountingCategories.push({ id: `spending-preview-${id}`, company: "JAPAN", name, group: "経費", available: true, createdAt: timestamp, updatedAt: timestamp });
  for (let offset = -6; offset <= 0; offset++) {
    const key = shiftForecastMonth(month, offset);
    for (const [index, [amount, content]] of ([
      [offset ? 100000 : 130000, "テスト 事務所賃料"],
      [offset ? 20000 : 80000, "テスト 制作委託費"],
      [offset ? 20000 : 22000, "テスト 制作委託費"],
      [offset ? 30000 : 45000, "テスト 備品購入"],
      [offset ? 5000 : 45000, "テスト 備品購入"],
    ] as const).entries()) {
      const id = `spending-preview-${key}-${index}`;
      data.bankTransactions.push({ id, company: "JAPAN", officeCode: account.officeCode, sourceId: id, bankAccountId: account.id, transactionDate: `${key}-01`, amount, side: "EXPENSE", content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, categoryId: index === 0 ? "spending-preview-rent" : index < 3 ? "spending-preview-outsource" : undefined, treatment: "NORMAL", classificationSource: index < 3 ? "MANUAL" : "UNASSIGNED", reviewed: index < 3, memo: "", createdAt: timestamp, updatedAt: timestamp });
    }
  }
  await writeFile(file, JSON.stringify(data, null, 2));
  console.log("Synthetic spending examples seeded; original disposable preview backed up.");
}
void main();
