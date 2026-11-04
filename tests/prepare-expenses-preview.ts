import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { expensesFixture } from "./expense-claims-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-expenses-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = expensesFixture(), passwordHash = hashSync("local-banking-test-only", 10);
  for (const user of data.users) if (user.id === "admin" || user.id === "des") user.passwordHash = passwordHash;
  assertJapanData(data);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64");
  for (const row of data.expenseClaims || []) {
    if (!row.fileUrl) continue;
    await writeFile(path.join(root, "uploads", path.basename(decodeURIComponent(row.fileUrl))), row.mimeType === "application/pdf" ? "%PDF-1.4\n% synthetic receipt placeholder\n" : png);
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
