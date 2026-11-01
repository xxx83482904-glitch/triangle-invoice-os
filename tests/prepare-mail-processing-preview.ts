import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { paymentStateMismatchFixture } from "./payment-state-mismatch-fixture";
import { timestamp } from "./document-fixture";

// Disposable invented records only, with the same synthetic login as other preview scripts.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-processing-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = paymentStateMismatchFixture();
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", role: "ADMIN", passwordHash, createdAt: timestamp, updatedAt: timestamp },
    { id: "mail-editor", name: "合成郵便担当者", email: "mail_editor@example.invalid", role: "MAIL_EDITOR", passwordHash, createdAt: timestamp, updatedAt: timestamp },
    { id: "guest", name: "合成権限確認用", email: "guest@example.invalid", role: "GUEST", passwordHash, createdAt: timestamp, updatedAt: timestamp },
  ];
  data.projects[0].name = "合成整理確認案件";
  data.projects[0].contractFileUrl = undefined;
  const mail = data.mailDocuments[0], invoice = data.receivedInvoices[0];
  data.mailDocuments.push({ ...mail, id: "unlinked-notice", category: "NOTICE", title: "合成未連携通知C", senderName: "合成通知元C", originalFileName: "合成通知C.pdf", relatedReceivedInvoiceId: undefined, mailProcessed: false });
  data.receivedInvoices.push({ ...invoice, id: "standalone-invoice", status: "SCHEDULED", total: 1000, subtotal: 1000, mailProcessed: false, originalFileName: "合成直接登録D.pdf", ocrText: "合成直接登録D 支払先: 合成専門サービスA 合計1,000円" });
  for (const row of [...data.mailDocuments, data.receivedInvoices.at(-1)!]) {
    const name = row.originalFileName!;
    await writeFile(path.join(root, "uploads", name), "%PDF-1.4\n% synthetic placeholder\n");
    row.fileUrl = `/uploads/received-invoices/${name}`;
  }
  for (const row of data.receivedInvoices) {
    const source = data.mailDocuments.find((item) => item.relatedReceivedInvoiceId === row.id);
    if (source) row.fileUrl = source.fileUrl;
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
