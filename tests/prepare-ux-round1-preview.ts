import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { timestamp } from "./document-fixture";
import { uxRound1Fixture } from "./ux-round1-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-ux-round1-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = uxRound1Fixture();
  data.users = [{ id: "admin", name: "合成UX管理者", email: "admin@example.invalid", role: "ADMIN", passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }];
  assertJapanData(data);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log("/banking?company=JAPAN: 合成12明細。01のメモ編集→02を確認済み→03を選択すると各保存対象を確認できます。");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
