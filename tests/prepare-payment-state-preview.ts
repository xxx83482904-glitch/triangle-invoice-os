import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { paymentStateMismatchFixture } from "./payment-state-mismatch-fixture";
import { timestamp } from "./document-fixture";

// Disposable synthetic data only. No credentials are printed or copied from an installation.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-payment-state-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = paymentStateMismatchFixture();
  data.users = [{ id: "admin", name: "合成検証管理者", email: "p0-check@example.invalid", role: "ADMIN", passwordHash: hashSync(randomBytes(32).toString("hex"), 10), createdAt: timestamp, updatedAt: timestamp }];
  // Synthetic originals prevent unrelated missing-file warnings in this focused preview.
  for (const mail of data.mailDocuments) {
    await writeFile(path.join(root, "uploads", mail.originalFileName), "%PDF-1.4\n% synthetic placeholder\n");
    mail.fileUrl = `/uploads/received-invoices/${mail.originalFileName}`;
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
