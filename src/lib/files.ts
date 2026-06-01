import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

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

type UploadFileRow = {
  data: Buffer;
  mimeType: string;
};

let uploadFilePool: Pool | null = null;

function isLocalDatabaseUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1") || url.includes("@db:");
}

function shouldUseDatabaseFileStore() {
  const url = process.env.DATABASE_URL;
  return Boolean(
    url &&
      !isLocalDatabaseUrl(url) &&
      (process.env.VERCEL === "1" || process.env.FILE_STORAGE_DRIVER === "database"),
  );
}

function databasePoolConfig() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required for durable file storage.");

  const url = new URL(rawUrl);
  const sslMode = url.searchParams.get("sslmode");
  const needsSsl = sslMode === "require" || sslMode === "prefer" || sslMode === "verify-full";
  if (needsSsl) url.searchParams.delete("sslmode");

  return {
    connectionString: url.toString(),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

async function ensureUploadFileStore() {
  if (!uploadFilePool) uploadFilePool = new Pool(databasePoolConfig());
  await uploadFilePool.query(`
    CREATE TABLE IF NOT EXISTS "UploadFile" (
      "fileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "data" BYTEA NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UploadFile_pkey" PRIMARY KEY ("fileName")
    )
  `);
  return uploadFilePool;
}

function mimeTypeFromName(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

export async function saveReceivedInvoiceFile(fileName: string, buffer: Buffer, mimeType = mimeTypeFromName(fileName)) {
  const safeName = path.basename(fileName);
  if (shouldUseDatabaseFileStore()) {
    const pool = await ensureUploadFileStore();
    await pool.query(
      `INSERT INTO "UploadFile" ("fileName", "mimeType", "data", "createdAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT ("fileName")
       DO UPDATE SET "mimeType" = EXCLUDED."mimeType", "data" = EXCLUDED."data"`,
      [safeName, mimeType, buffer],
    );
    return;
  }

  await mkdir(uploadRoot, { recursive: true });
  await writeFile(path.join(uploadRoot, safeName), buffer);
}

export function receivedInvoiceFileUrl(fileName: string) {
  return process.env.VERCEL === "1" ? `/api/files/${fileName}` : `/uploads/received-invoices/${fileName}`;
}

export async function saveContractFile(fileName: string, buffer: Buffer, mimeType = mimeTypeFromName(fileName)) {
  await saveReceivedInvoiceFile(fileName, buffer, mimeType);
}

export function contractFileUrl(fileName: string) {
  return receivedInvoiceFileUrl(fileName);
}

export async function readReceivedInvoiceFile(fileName: string) {
  const file = await readUploadedFile(fileName);
  return file?.data ?? null;
}

export async function readUploadedFile(fileName: string) {
  const safeName = path.basename(fileName);
  if (shouldUseDatabaseFileStore()) {
    const pool = await ensureUploadFileStore();
    const { rows } = await pool.query<UploadFileRow>(
      `SELECT "data", "mimeType" FROM "UploadFile" WHERE "fileName" = $1 LIMIT 1`,
      [safeName],
    );
    return rows[0] ?? null;
  }

  const filePath = path.join(uploadRoot, safeName);
  if (!existsSync(filePath)) return null;
  return {
    data: await readFile(filePath),
    mimeType: mimeTypeFromName(safeName),
  };
}
