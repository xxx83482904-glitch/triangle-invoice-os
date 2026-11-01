import type { MailDocument, ReceivedInvoice } from "../src/lib/types";
import { fixture, timestamp } from "./document-fixture";

export const unlinkedMailToday = "2026-11-01";
export const requiredMailIds = ["open-invoice", "open-receipt", "legacy-undefined", "broken-missing", "broken-deleted-invoice", "broken-deleted-project", "missing-file", "no-file-url", "duplicate-a", "duplicate-b"];

export function unlinkedMailFixture() {
  const data = fixture();
  data.clients[0].companyName = "合成依頼元"; data.vendors[0].companyName = "合成支払先";
  data.projects[0].name = "合成案件A"; data.projects[1].name = "合成別担当案件"; data.projects[2].name = "合成会社外案件";
  data.projects.push({ ...data.projects[0], id: "deleted-project", name: "合成削除案件", deletedAt: timestamp },
    { ...data.projects[0], id: "archived-project", name: "合成保管案件", status: "ARCHIVED" });
  const baseInvoice = data.receivedInvoices[0];
  const invoice = (id: string, extra: Partial<ReceivedInvoice> = {}): ReceivedInvoice => ({ ...baseInvoice, id, status: "RECEIVED", mailProcessed: false,
    originalFileName: id + ".pdf", fileUrl: undefined, total: 1000, subtotal: 1000, ocrText: "合成請求書", ...extra });
  data.receivedInvoices = [invoice("live"), invoice("deleted-target", { deletedAt: timestamp }),
    invoice("deleted-project-target", { projectId: "deleted-project" }), invoice("archived-target", { status: "ARCHIVED" }),
    invoice("rejected-target", { status: "REJECTED" }), invoice("other-project-target", { projectId: "other" }),
    invoice("archived-project-target", { projectId: "archived-project" }),
    invoice("group-old", { debtGroupId: "synthetic-group", debtRole: "INVOICE", issueDate: "2026-09-01" }),
    invoice("group-current", { debtGroupId: "synthetic-group", debtRole: "REMINDER", issueDate: "2026-10-01" }),
    invoice("group-receipt", { debtGroupId: "synthetic-group", debtRole: "RECEIPT", issueDate: "2026-10-10" }),
    invoice("direct-ocr")];
  const baseMail = data.mailDocuments[0];
  const mail = (id: string, extra: Partial<MailDocument> = {}): MailDocument => ({ ...baseMail, id, title: "合成郵便 " + id,
    originalFileName: id + ".pdf", fileUrl: "/api/files/" + id + ".pdf", senderName: "合成差出人", folderMonth: "2026-10",
    category: "INVOICE", relatedReceivedInvoiceId: undefined, mailProcessed: false, ocrText: "合成書類の本文", ...extra });
  data.mailDocuments = [mail("open-invoice"), mail("open-receipt", { category: "RECEIPT" }),
    mail("legacy-undefined", { mailProcessed: undefined, company: undefined }),
    mail("broken-missing", { relatedReceivedInvoiceId: "missing-target" }),
    mail("broken-deleted-invoice", { relatedReceivedInvoiceId: "deleted-target" }),
    mail("broken-deleted-project", { relatedReceivedInvoiceId: "deleted-project-target" }),
    mail("missing-file"), mail("no-file-url", { fileUrl: "", ocrText: undefined }),
    mail("duplicate-a", { fileHash: "synthetic-identical-hash" }),
    mail("duplicate-b", { fileHash: "synthetic-identical-hash", duplicateOfMailDocumentId: "duplicate-a", duplicateReason: "同じファイル内容", duplicateScore: 100 }),
    ...Array.from({ length: 9 }, (_, i) => mail("processed-" + (i + 1), { category: i % 2 ? "RECEIPT" : "INVOICE", mailProcessed: true,
      relatedReceivedInvoiceId: i === 2 ? "missing-processed-target" : i === 3 ? "deleted-target" : i === 8 ? "deleted-project-target" : undefined,
      fileUrl: i === 4 ? "" : "/api/files/processed-" + (i + 1) + ".pdf" })),
    ...["live", "archived-target", "rejected-target", "other-project-target", "archived-project-target", "group-old", "group-receipt"].map((id) => mail("linked-" + id, { relatedReceivedInvoiceId: id })),
    ...(["NOTICE", "OTHER", "CONTRACT", "ESTIMATE", "DELIVERY_NOTE"] as const).map((category) => mail("category-" + category, { category })),
    mail("deleted-mail", { deletedAt: timestamp }), mail("foreign-mail", { company: "CHINA" }),
  ];
  data.issuedInvoices = []; data.payments = []; data.attachments = [];
  data.mailFolders = [{ id: "empty-folder", company: "JAPAN", month: "2026-01", createdAt: timestamp, updatedAt: timestamp }];
  return data;
}
