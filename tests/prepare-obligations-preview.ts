import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { applyObligationMutation } from "../src/lib/obligation-edits";
import { taxObligations } from "../src/lib/tax-obligations";
import { obligationsFixture } from "./obligations-fixture";
import { admin, timestamp } from "./document-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-obligations-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = obligationsFixture(), passwordHash = hashSync("local-banking-test-only", 10);
  data.users = ([
    ["admin", "admin", "合成検証管理者", "ADMIN"], ["accounting", "accounting", "合成経理", "ACCOUNTING"],
    ["mail-editor", "mail_editor", "合成郵便担当者", "MAIL_EDITOR"], ["manager", "chief", "合成主任", "CHIEF_DESIGNER"],
  ] as const).map(([id, email, name, role]) => ({ id, name, email: `${email}@example.invalid`, passwordHash, role, createdAt: timestamp, updatedAt: timestamp }));
  const today = "2026-11-01";
  for (const [title, amount, action] of [["合成港都税の加算金", 3400, "open"], ["合成社会保険の追納", 7800, "pay"], ["合成登録取消の見本", 900, "cancel"]] as const) {
    const created = applyObligationMutation(data, admin, "JAPAN", { action: "create", title, party: "合成港都税事務所", amount, dueDate: "2026-11-12", memo: "合成データ。書類のない未納の確認用" }, today);
    if (action !== "open") applyObligationMutation(data, admin, "JAPAN", { action, id: created.id, version: created.updatedAt, reason: action === "pay" ? "合成納付を確認" : "重複して入力したため", ...(action === "pay" ? { paymentDate: "2026-10-30" } : {}) }, today);
  }
  const target = taxObligations(data, "JAPAN", today).items.find((row) => row.id === "received:inferred")!;
  applyObligationMutation(data, admin, "JAPAN", { action: "exclude", id: target.id, version: target.version, reason: "合成対象外の操作確認。理由を付けて元に戻せます" }, today);
  // Keep another inferred party visible while one excluded row demonstrates the reversible workflow.
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-inferred", senderName: "合成南税務署", title: "合成名前推定の通知", fileUrl: "/api/files/mail-inferred.pdf" });
  assertJapanData(data);
  for (const row of [...data.receivedInvoices, ...data.mailDocuments]) if (row.fileUrl) await writeFile(path.join(root, "uploads", path.basename(row.fileUrl)), "%PDF-1.4\n% synthetic placeholder\n");
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
