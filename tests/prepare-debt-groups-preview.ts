import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { admin, fixture, timestamp } from "./document-fixture";
import { assignDebtGroup } from "../src/lib/debt-groups";
import type { UserRole } from "../src/lib/types";

// Synthetic data for the debt-group panel on /received-invoices: one bundled debt and one with open candidates.
// Start the server with DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-debt-groups-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.vendors[0].companyName = "株式会社テスト制作";
  data.vendors.push({ ...data.vendors[0], id: "vendor-power", companyName: "株式会社テスト電気" });
  data.projects[0].name = "青山ショールーム / 設計";
  const base = data.receivedInvoices[0];
  Object.assign(base, { status: "SCHEDULED", mailProcessed: false, issueDate: "2026-08-01", dueDate: "2026-08-31", total: 88000, subtotal: 80000, taxTotal: 8000, originalFileName: "制作費_8月_請求書.pdf", ocrText: "合成データ" });
  data.mailDocuments[0].mailProcessed = false;
  data.receivedInvoices.push(
    { ...base, id: "bundled-reissue", issueDate: "2026-09-05", dueDate: "2026-09-30", originalFileName: "制作費_8月_再発行.pdf", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" },
    { ...base, id: "bundled-reminder", issueDate: "2026-09-25", dueDate: "2026-10-10", originalFileName: "制作費_8月_督促状.pdf", createdAt: "2026-09-25T00:00:00.000Z", updatedAt: "2026-09-25T00:00:00.000Z" },
    { ...base, id: "open-invoice", vendorId: "vendor-power", issueDate: "2026-09-10", dueDate: "2026-09-30", total: 12100, subtotal: 11000, taxTotal: 1100, originalFileName: "電気料金_9月.pdf", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" },
    { ...base, id: "open-reminder", vendorId: "vendor-power", issueDate: "2026-10-05", dueDate: "2026-10-20", total: 12100, subtotal: 11000, taxTotal: 1100, originalFileName: "電気料金_9月_督促.pdf", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" },
  );
  data.attachments = [];
  assignDebtGroup(data, admin, "JAPAN", { invoiceIds: [base.id, "bundled-reissue", "bundled-reminder"], roles: { "bundled-reissue": "REISSUE", "bundled-reminder": "REMINDER" } });
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${path.join(root, "uploads")}`);
  console.log("bundled: 請求書 → 再発行 → 督促（支払対象は督促 88,000）/ open: 電気料金 9月 + 督促（候補として提案、未グループ）");
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
