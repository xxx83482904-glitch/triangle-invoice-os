import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { bankToday } from "../src/lib/banking";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { timestamp } from "./document-fixture";
import { uxRound1Fixture } from "./ux-round1-fixture";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-ux-round1-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = uxRound1Fixture(bankToday());
  const pdf = new PDFDocument({ size: "A4" });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => { pdf.on("end", resolve); pdf.on("error", reject); });
  pdf.fontSize(20).text("SYNTHETIC UX PREVIEW").fontSize(12).text("This is synthetic data only. Original document available.");
  pdf.end();
  await finished;
  await writeFile(path.join(root, "uploads", "ux-original.pdf"), Buffer.concat(chunks));
  data.users = [{ id: "admin", name: "合成UX管理者", email: "admin@example.invalid", role: "ADMIN", passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }];
  assertJapanData(data);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log("/projects?company=JAPAN: 合成04・05・06・09・10だけ要対応。01は参考、02は金額未設定、03は0円。原本はux-original.pdfのみ存在します。");
  console.log("/dashboard?company=JAPAN: 次にやること全9行。書類の開くで同じ件数に絞り込み、口座明細・照合へも確認できます。");
  console.log("/banking?company=JAPAN: 合成12明細。01のメモ編集→02を確認済み→03を選択すると各保存対象を確認できます。");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
