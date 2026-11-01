import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { unlinkedMailFixture } from "./unlinked-mail-fixture";
import { timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-unlinked-mail-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = unlinkedMailFixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company !== "CHINA");
  data.mailDocuments = data.mailDocuments.filter((row) => row.company !== "CHINA");
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "mail-editor", name: "合成郵便担当者", email: "mail_editor@example.invalid", passwordHash, role: "MAIL_EDITOR", createdAt: timestamp, updatedAt: timestamp },
    { id: "manager", name: "合成主任", email: "chief@example.invalid", passwordHash, role: "CHIEF_DESIGNER", createdAt: timestamp, updatedAt: timestamp },
  ];
  assertJapanData(data);
  for (const mail of data.mailDocuments) {
    if (!mail.fileUrl || ["missing-file", "processed-6"].includes(mail.id)) continue;
    await writeFile(path.join(root, "uploads", path.basename(mail.fileUrl)), "%PDF-1.4\n% synthetic placeholder\n");
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
