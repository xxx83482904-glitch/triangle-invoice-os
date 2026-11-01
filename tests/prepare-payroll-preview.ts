import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { payrollFixture } from "./payroll-fixture";
import { timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-payroll-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = payrollFixture(), passwordHash = hashSync("local-banking-test-only", 10);
  data.users = ([
    ["admin", "admin", "合成検証管理者", "ADMIN"], ["accounting", "accounting", "合成経理", "ACCOUNTING"],
    ["mail-editor", "mail_editor", "合成郵便担当者", "MAIL_EDITOR"], ["manager", "chief", "合成主任", "CHIEF_DESIGNER"],
  ] as const).map(([id, email, name, role]) => ({ id, name, email: `${email}@example.invalid`, passwordHash, role, createdAt: timestamp, updatedAt: timestamp }));
  assertJapanData(data);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2)); console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
