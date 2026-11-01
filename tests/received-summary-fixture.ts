import type { Payment, ReceivedInvoice } from "../src/lib/types";
import { fixture, timestamp } from "./document-fixture";

export const summaryToday = "2026-11-01";

export function receivedSummaryFixture() {
  const data = fixture();
  data.clients[0].companyName = "合成依頼元";
  data.vendors[0].companyName = "合成支払先A";
  data.vendors.push({ ...data.vendors[0], id: "vendor-b", companyName: "合成支払先B" });
  data.projects[0].name = "合成案件A";
  data.projects[1].name = "合成案件B";
  data.projects[2].name = "合成対象外案件";
  data.projects.push({ ...data.projects[0], id: "deleted-project", name: "合成削除案件", deletedAt: timestamp });
  data.issuedInvoices = []; data.mailDocuments = []; data.attachments = [];
  const base = data.receivedInvoices[0];
  const invoice = (id: string, total: number, extra: Partial<ReceivedInvoice> = {}): ReceivedInvoice => ({
    ...base, id, total, subtotal: total, status: "SCHEDULED", mailProcessed: false,
    issueDate: "2026-10-05", dueDate: "2026-11-05", folderMonth: undefined,
    fileUrl: undefined, originalFileName: id + ".pdf", mimeType: "application/pdf", ...extra,
  });
  data.receivedInvoices = [
    invoice("open", 10000, { memo: "合成検索目印", ocrText: "請求元: 合成支払先A" }),
    invoice("partial", 20000, { vendorId: "vendor-b", projectId: "other", issueDate: "2026-09-10", dueDate: "2026-10-10" }),
    invoice("paid", 30000, { status: "PAID" }),
    invoice("paid-without-record", 4000, { status: "PAID", dueDate: "2026-10-20" }),
    invoice("overpaid", 5000, { status: "PAID" }),
    invoice("archived", 90000, { status: "ARCHIVED" }),
    invoice("rejected", 80000, { status: "REJECTED" }),
    invoice("group-old", 7000, { debtGroupId: "synthetic-debt", debtRole: "INVOICE", issueDate: "2026-09-01" }),
    invoice("group-current", 7000, { debtGroupId: "synthetic-debt", debtRole: "REMINDER", issueDate: "2026-10-01" }),
    invoice("group-receipt", 7000, { debtGroupId: "synthetic-debt", debtRole: "RECEIPT", issueDate: "2026-10-10" }),
    invoice("zero", 0, { status: "REVIEWING" }),
    invoice("undated", 2500, { status: "RECEIVED", issueDate: "", dueDate: "" }),
    invoice("previous-year", 6000, { issueDate: "2025-12-10", dueDate: "2026-01-10" }),
    invoice("deleted", 500000, { deletedAt: timestamp }),
    invoice("deleted-project-invoice", 500000, { projectId: "deleted-project" }),
    invoice("missing-project-invoice", 500000, { projectId: "missing-project" }),
    invoice("foreign", 500000, { projectId: "china" }),
  ];
  const payment = (id: string, receivedInvoiceId: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
    id, receivedInvoiceId, amount, type: "EXPENSE", source: "MANUAL", paymentDate: "2026-10-25",
    createdById: "admin", createdAt: timestamp, updatedAt: timestamp, ...extra,
  });
  data.payments = [payment("partial-payment", "partial", 5000, { source: "BANK_RECONCILIATION" }),
    payment("paid-payment", "paid", 30000), payment("overpayment", "overpaid", 7000),
    payment("group-payment", "group-current", 2000), payment("canceled-payment", "open", 8000, { deletedAt: timestamp }),
    payment("wrong-direction", "open", 9999, { type: "INCOME" })];
  return data;
}
