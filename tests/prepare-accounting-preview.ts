import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-accounting-preview-"));
  const data = fixture();
  data.users = [
    { id: "test-admin", name: "検証用管理者", email: "admin@example.invalid", role: "ADMIN" as const },
    { id: "test-pending", name: "承認待ちの担当者", email: "pending@example.invalid", role: "MAIL_EDITOR" as const, accessStatus: "PENDING" as const },
    { id: "test-accounting", name: "検証用経理", email: "accounting@example.invalid", role: "ACCOUNTING" as const },
  ].map((user) => ({ ...user, passwordHash: hashSync("local-accounting-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.projects = [{ ...data.projects[0], name: "検証案件", managerId: "test-admin" }];
  data.issuedInvoices = [
    { ...data.issuedInvoices[0], issueDate: "2026-09-01", status: "ISSUED", total: 100000 },
    { ...data.issuedInvoices[0], id: "october", invoiceNumber: "INV-002", issueDate: "2026-10-01", status: "ISSUED", total: 100000 },
  ];
  data.payments = [{ id: "test-income", issuedInvoiceId: "issued-1", type: "INCOME", amount: 100000, paymentDate: "2026-10-02", createdById: "test-admin", createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}

void main();
