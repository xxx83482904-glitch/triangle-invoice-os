import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { integrityKnownFixture } from "./integrity-known-fixture";
import { integrityReport } from "../src/lib/integrity";
import { acknowledgeIntegrity } from "../src/lib/integrity-acknowledgements";
import { timestamp } from "./document-fixture";

async function main() {
  const stage = process.argv[2] || "--stage=base";
  if (process.argv.length > 3 || !["--stage=base", "--stage=known", "--stage=timestamp", "--stage=changed"].includes(stage)) throw new Error("Use --stage=base|known|timestamp|changed");
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-integrity-known-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = integrityKnownFixture(), passwordHash = hashSync("local-banking-test-only", 10);
  // Exercise the two bank-kana descriptions without changing the preview's row counts or login accounts.
  for (const [id, content] of [["settlement-1", "振込 カ)アツプサイダ-"], ["settlement-4", "振込1 カ)アツプサイダ-"]]) {
    const row = data.bankTransactions.find((item) => item.id === id);
    if (!row) throw new Error("Synthetic settlement row is missing");
    row.content = content;
  }
  data.users = ([
    ["admin", "admin", "合成検証管理者", "ADMIN"], ["accounting", "accounting", "合成経理", "ACCOUNTING"],
    ["mail-editor", "mail_editor", "合成郵便担当者", "MAIL_EDITOR"], ["manager", "chief", "合成主任", "CHIEF_DESIGNER"],
  ] as const).map(([id, email, name, role]) => ({ id, name, email: `${email}@example.invalid`, passwordHash, role, createdAt: timestamp, updatedAt: timestamp }));
  if (stage !== "--stage=base") {
    const issue = integrityReport(data, "JAPAN").issues.find((row) => row.id === "reviewed_guess:guess-1")!;
    acknowledgeIntegrity(data, data.users[0], "JAPAN", { mode: "ISSUE", kind: issue.kind, reason: "合成: 推測のままでよいと確認", targets: [{ id: issue.id, fingerprint: issue.fingerprint }] });
    if (stage === "--stage=timestamp") data.bankTransactions[0].updatedAt = "2099-01-01T00:00:00.000Z";
    if (stage === "--stage=changed") data.bankTransactions[0].amount = 1100;
  }
  assertJapanData(data);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2)); console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
