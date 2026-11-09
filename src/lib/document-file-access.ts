import "server-only";

import { documentRows, visibleProjects } from "@/lib/documents";
import { canViewBankReceiptFile } from "@/lib/bank-receipts";
import { canViewCardReceiptFile } from "@/lib/card-receipts";
import { canViewExpenseFile } from "@/lib/expense-claim-edits";
import { uploadedFileNameFromUrl } from "@/lib/files";
import { canViewImportFile } from "@/lib/import-shipment-files";
import { can } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export function canViewDocumentFile(data: AppData, user: Pick<User, "id" | "role" | "featureAccess">, name: string) {
  if (!name || /[\\/\x00]/.test(name) || name === "." || name === "..") return false;
  const matches = (url?: string) => Boolean(url && uploadedFileNameFromUrl(url) === name);
  const rows = [...documentRows(data, user, "JAPAN"), ...documentRows(data, user, "CHINA")];
  const projects = new Set(visibleProjects(data, user).map((p) => p.id));
  const designerUpload = user.role === "DESIGNER" && can(user, "upload:receivedInvoices") && data.receivedInvoices.some((i) => !i.deletedAt && projects.has(i.projectId) && matches(i.fileUrl));
  const guestInvoice = user.role === "GUEST" && data.issuedInvoices.some((i) => !i.deletedAt && i.createdById === user.id && (matches(i.fileUrl) || matches(i.pdfUrl)));
  return rows.some((r) => matches(r.fileUrl)) || designerUpload || guestInvoice || canViewExpenseFile(data, user, name) || canViewBankReceiptFile(data, user, name) || canViewCardReceiptFile(data, user, name) || canViewImportFile(data, user, name);
}

