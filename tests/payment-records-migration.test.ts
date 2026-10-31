import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyCleanup, selectCandidates } from "../scripts/migrations/payment-records-cleanup.mjs";

type Row = { paymentId: string; proposal: string; overpaid: number; invoiceStatus: string };
type Loose = { id: string; status?: string; deletedAt?: string; history?: Array<{ kind: string; reason: string }>; [key: string]: unknown };
const script = fileURLToPath(new URL("../scripts/migrations/payment-records-cleanup.mjs", import.meta.url));
const at = "2026-10-20T00:00:00.000Z";
const payment = (id: string, receivedInvoiceId: string, extra: Record<string, unknown> = {}): Loose => ({ id, type: "EXPENSE", receivedInvoiceId, amount: 1000, paymentDate: "2026-10-20", method: "ステータス変更", memo: "ステータス変更で支払済みにしました", createdById: "admin", createdAt: at, updatedAt: at, ...extra });
const invoice = (id: string, extra: Record<string, unknown> = {}): Loose => ({ id, vendorId: "v1", projectId: "p1", receivedDate: "2026-10-01", issueDate: "2026-10-01", dueDate: "2026-10-31", subtotal: 1000, taxTotal: 0, total: 1000, status: "PAID", uploadedById: "admin", createdAt: at, updatedAt: at, ...extra });
const data = () => ({ appEdition: "JAPAN", users: [], auditLogs: [] as Array<{ action: string }>, vendors: [{ id: "v1", companyName: "テスト支払先" }],
  receivedInvoices: [invoice("inv-evidence-free"), invoice("inv-duplicate", { total: 1000 }), invoice("inv-archived", { status: "ARCHIVED" }), invoice("inv-linked"), invoice("inv-manual", { status: "SCHEDULED" })],
  payments: [
    payment("pay-evidence-free", "inv-evidence-free"),
    payment("pay-duplicate", "inv-duplicate"), payment("pay-bank", "inv-duplicate", { source: "BANK_RECONCILIATION", method: "銀行明細照合", memo: "" }),
    payment("pay-archived", "inv-archived"),
    payment("pay-linked", "inv-linked"),
    payment("pay-manual", "inv-manual", { method: "銀行振込", memo: "手入力" }),
    payment("pay-canceled", "inv-evidence-free", { deletedAt: at }),
  ],
  bankReconciliations: [{ id: "link-bank", paymentId: "pay-bank", amount: 1000, company: "JAPAN" }, { id: "link-legacy", paymentId: "pay-linked", amount: 1000, company: "JAPAN" }] });

test("candidates are legacy status payments without a bank reconciliation, with a proposal per situation", () => {
  const rows = selectCandidates(data()) as Row[];
  assert.deepEqual(rows.map((row) => row.paymentId).sort(), ["pay-archived", "pay-duplicate", "pay-evidence-free"]);
  assert.match(rows.find((row) => row.paymentId === "pay-duplicate")!.proposal, /銀行照合で全額確認済み/);
  assert.equal(rows.find((row) => row.paymentId === "pay-duplicate")!.overpaid, 1000);
  assert.match(rows.find((row) => row.paymentId === "pay-archived")!.proposal, /アーカイブ/);
  assert.match(rows.find((row) => row.paymentId === "pay-evidence-free")!.proposal, /支払の証拠なし/);
});

test("apply cancels with a reason, returns uncovered documents to scheduled and leaves bank-linked rows alone", () => {
  const current = data();
  const result = applyCleanup(current, ["pay-evidence-free", "pay-duplicate", "pay-linked", "unknown"]);
  assert.deepEqual(result, { canceled: 3, invoicesUpdated: 2 });
  const byId = new Map(current.payments.map((row) => [row.id, row]));
  assert.ok(byId.get("pay-evidence-free")!.deletedAt); assert.equal(byId.get("pay-evidence-free")!.history?.at(-1)?.kind, "CANCELED");
  assert.equal(current.receivedInvoices.find((row) => row.id === "inv-evidence-free")!.status, "SCHEDULED");
  assert.equal(current.receivedInvoices.find((row) => row.id === "inv-duplicate")!.status, "PAID");
  assert.equal(current.receivedInvoices.find((row) => row.id === "inv-linked")!.status, "SCHEDULED");
  assert.equal(current.auditLogs[0].action, "PAYMENT_CANCEL_MIGRATION");
  assert.deepEqual(applyCleanup(current, ["pay-evidence-free"]), { canceled: 0, invoicesUpdated: 0 });
});

test("cli dry run writes nothing; apply honours --only, backs up and can be restored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-payment-cleanup-test-"));
  try {
    const file = path.join(root, "app-data.json");
    await writeFile(file, JSON.stringify(data()));
    const before = await readFile(file, "utf8");
    const dry = execFileSync(process.execPath, [script, "--data", file, "--out", path.join(root, "report.json")], { encoding: "utf8" });
    assert.match(dry, /候補 3件/); assert.match(dry, /Dry run/);
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal(JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).candidates.length, 3);
    assert.throws(() => execFileSync(process.execPath, [script, "--apply"], { encoding: "utf8", stdio: "pipe" }));
    const applied = execFileSync(process.execPath, [script, "--data", file, "--apply", "--only", "pay-evidence-free,pay-archived", "--exclude", "pay-archived"], { encoding: "utf8" });
    assert.match(applied, /Applied: 1 payment records canceled, 1 documents/);
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(after.payments.filter((row: { deletedAt?: string }) => row.deletedAt).map((row: { id: string }) => row.id).sort(), ["pay-canceled", "pay-evidence-free"]);
    const backups = await readdir(path.join(root, "backups"));
    assert.equal(backups.length, 1);
    execFileSync(process.execPath, [script, "--data", file, "--restore", path.join(root, "backups", backups[0])], { encoding: "utf8" });
    assert.equal(await readFile(file, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
