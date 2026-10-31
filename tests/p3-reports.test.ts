import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categoryReport } from "../scripts/migrations/category-dedupe-report.mjs";
import { proposedMapping, statusReport } from "../scripts/migrations/received-status-simplify.mjs";

type Loose = Record<string, unknown>;
const data = () => ({
  projects: [{ id: "p1", company: "JAPAN" }],
  receivedInvoices: [
    { id: "a", projectId: "p1", status: "OCR_PENDING", total: 1000, originalFileName: "a.pdf" }, { id: "b", projectId: "p1", status: "APPROVAL_PENDING", total: 2000, originalFileName: "b.pdf" },
    { id: "c", projectId: "p1", status: "PAID", total: 3000, originalFileName: "c.pdf" }, { id: "d", projectId: "p1", status: "SCHEDULED", total: 4000, originalFileName: "d.pdf" },
  ],
  payments: [{ id: "pay", type: "EXPENSE", receivedInvoiceId: "d", amount: 4000 }],
  accountingCategories: [
    { id: "c1", company: "JAPAN", name: "支払手数料", available: true }, { id: "c2", company: "JAPAN", name: "支払 手数料", available: true, sourceId: "mf" },
    { id: "c3", company: "JAPAN", name: "雑費", available: true }, { id: "c4", company: "JAPAN", name: "消耗品費", available: true },
  ],
  bankTransactions: [
    { id: "t1", company: "JAPAN", side: "EXPENSE", content: "テスト文具", categoryId: "c3", reviewed: true, treatment: "NORMAL", sourceMissing: false },
    { id: "t2", company: "JAPAN", side: "EXPENSE", content: "テスト文具", categoryId: "c4", reviewed: true, treatment: "NORMAL", sourceMissing: false },
    { id: "t3", company: "JAPAN", side: "EXPENSE", content: "テスト文具", categoryId: "c4", reviewed: false, treatment: "NORMAL", sourceMissing: false },
  ],
} as Loose);

test("the status report maps review states to one, keeps paid and scheduled, and lists payment mismatches", () => {
  const report = statusReport(data(), "JAPAN") as unknown as { documents: number; counts: Record<string, number>; mapped: Record<string, number>; changes: number; mismatches: Array<{ id: string }> };
  assert.equal(report.documents, 4);
  assert.deepEqual(report.mapped, { REVIEWING: 2, PAID: 1, SCHEDULED: 1 });
  assert.equal(report.changes, 2);
  assert.deepEqual(report.mismatches.map((row) => row.id).sort(), ["c", "d"]);
  assert.equal(proposedMapping.RECEIVED, "REVIEWING");
});

test("the category report finds colliding names and descriptions spread over categories, reviewed rows only", () => {
  const report = categoryReport(data(), "JAPAN") as unknown as { duplicates: Array<{ name: string; ids: string[]; proposal: string }>; mixed: Array<{ content: string; count: number; breakdown: Array<{ name: string; count: number }> }> };
  assert.deepEqual(report.duplicates.map((row) => row.ids), [["c1", "c2"]]);
  assert.match(report.duplicates[0].proposal, /連携科目へ寄せ/);
  assert.deepEqual(report.mixed.map((row) => [row.content, row.count, row.breakdown.map((item) => item.name)]), [["テスト文具", 2, ["雑費", "消耗品費"]]]);
});

test("both scripts print a dry-run report, write JSON on request and never change the data file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-p3-reports-"));
  try {
    const file = path.join(root, "app-data.json");
    await writeFile(file, JSON.stringify(data()));
    const before = await readFile(file, "utf8");
    for (const [script, pattern] of [["received-status-simplify.mjs", /Dry run only/], ["category-dedupe-report.mjs", /Dry run only/]] as const) {
      const output = execFileSync(process.execPath, [fileURLToPath(new URL(`../scripts/migrations/${script}`, import.meta.url)), "--data", file, "--out", path.join(root, `${script}.json`)], { encoding: "utf8" });
      assert.match(output, pattern);
      assert.ok(JSON.parse(await readFile(path.join(root, `${script}.json`), "utf8")).company === "JAPAN");
    }
    assert.equal(await readFile(file, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
