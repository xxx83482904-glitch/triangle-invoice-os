import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { hashSync } from "bcryptjs";
import { createCanvas } from "@napi-rs/canvas";
import { fixture, timestamp } from "./document-fixture";

async function pdf(text: string) {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text("TRIANGLE / LOCAL TEST").moveDown().fontSize(12).text(text);
    doc.end();
  });
}
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-documents-"));
  const upload = path.join(root, "uploads");
  await mkdir(upload);
  const data = fixture();
  data.users = ["ADMIN", "PROJECT_MANAGER", "MAIL_EDITOR"].map((role, n) => ({ id: ["admin", "manager", "mail"][n], name: `Test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role: role as "ADMIN" | "PROJECT_MANAGER" | "MAIL_EDITOR", passwordHash: hashSync("local-documents-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  for (const file of ["issued.pdf", "other.pdf", "china.pdf", "contract.pdf", "old.pdf", "received.pdf"]) await writeFile(path.join(upload, file), await pdf(file));
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  for (let i = 1; i <= 3; i++) await writeFile(path.join(root, `drop-${i}.pdf`), await pdf(`Invoice Number: DROP-00${i}\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nBill to: Test customer\nTotal amount: 12,000`));
  const canvas = createCanvas(1200, 1600);
  const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, 1200, 1600); context.fillStyle = "black"; context.font = "36px Arial";
  ["TRIANGLE INVOICE", "Invoice Number: IMAGE-001", "Invoice date: 2026-09-15", "Due date: 2026-10-15", "Total amount: 12000"].forEach((line, i) => context.fillText(line, 70, 130 + i * 90));
  await writeFile(path.join(root, "scan.png"), canvas.toBuffer("image/png"));
  console.log(root);
}
void main();
