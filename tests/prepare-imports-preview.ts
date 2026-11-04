import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { importShipmentsFixture } from "./import-shipments-fixture";
import { timestamp } from "./document-fixture";

// Writes a synthetic data folder for looking at the import board locally. Nothing in it is real.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-imports-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = importShipmentsFixture();
  data.mailDocuments = data.mailDocuments.filter((row) => row.company !== "CHINA");
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "manager", name: "合成主任", email: "chief@example.invalid", passwordHash, role: "CHIEF_DESIGNER", createdAt: timestamp, updatedAt: timestamp },
  ];
  assertJapanData(data);
  for (const row of [...data.mailDocuments, ...data.receivedInvoices]) {
    if (row.fileUrl) await writeFile(path.join(root, "uploads", path.basename(row.fileUrl)), "%PDF-1.4\n% synthetic placeholder\n");
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
