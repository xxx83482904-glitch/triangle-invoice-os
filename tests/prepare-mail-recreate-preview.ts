import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { mailRecreateFixture } from "./mail-recreate-fixture";
import { timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-recreate-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = mailRecreateFixture();
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [{ id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "mail-editor", name: "合成郵便担当者", email: "mail_editor@example.invalid", passwordHash, role: "MAIL_EDITOR", createdAt: timestamp, updatedAt: timestamp }];
  for (const mail of data.mailDocuments) {
    await writeFile(path.join(root, "uploads", mail.originalFileName), "%PDF-1.4\n% synthetic placeholder\n");
    mail.fileUrl = `/uploads/received-invoices/${mail.originalFileName}`;
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
