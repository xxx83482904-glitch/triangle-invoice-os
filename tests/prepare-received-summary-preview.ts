import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { receivedSummaryFixture } from "./received-summary-fixture";
import { assertJapanData } from "../src/lib/japan-storage";
import { timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-received-summary-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = receivedSummaryFixture();
  // Foreign/missing projects are unit-test cases; the running Japan app correctly rejects such storage.
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company !== "CHINA");
  const projectIds = new Set(data.projects.map((row) => row.id));
  data.receivedInvoices = data.receivedInvoices.filter((row) => projectIds.has(row.projectId));
  assertJapanData(data);
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "accounting", name: "合成経理", email: "accounting@example.invalid", passwordHash, role: "ACCOUNTING", createdAt: timestamp, updatedAt: timestamp },
    { id: "manager", name: "合成主任", email: "chief@example.invalid", passwordHash, role: "CHIEF_DESIGNER", createdAt: timestamp, updatedAt: timestamp },
  ];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
