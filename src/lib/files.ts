import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const uploadRoot =
  process.env.VERCEL === "1"
    ? path.join(os.tmpdir(), "triangle-invoice-os", "uploads", "received-invoices")
    : path.join(process.cwd(), "public", "uploads", "received-invoices");

export const allowedUploadTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

export const maxUploadSize = 10 * 1024 * 1024;

export async function saveReceivedInvoiceFile(fileName: string, buffer: Buffer) {
  await mkdir(uploadRoot, { recursive: true });
  await writeFile(path.join(uploadRoot, fileName), buffer);
}

export function receivedInvoiceFileUrl(fileName: string) {
  return process.env.VERCEL === "1" ? `/api/files/${fileName}` : `/uploads/received-invoices/${fileName}`;
}

export async function readReceivedInvoiceFile(fileName: string) {
  const safeName = path.basename(fileName);
  const filePath = path.join(uploadRoot, safeName);
  if (!existsSync(filePath)) return null;
  return readFile(filePath);
}
