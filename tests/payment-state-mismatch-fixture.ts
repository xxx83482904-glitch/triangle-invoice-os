import { fixture, timestamp } from "./document-fixture";

// Synthetic reproductions of the reported amounts; no production records or names.
export function paymentStateMismatchFixture() {
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.id === "japan");
  data.issuedInvoices = [];
  data.attachments = [];
  const invoice = data.receivedInvoices[0], mail = data.mailDocuments[0];
  data.vendors = [
    { ...data.vendors[0], id: "synthetic-professional", companyName: "合成専門サービスA" },
    { ...data.vendors[0], id: "synthetic-office", companyName: "合成納付先B" },
  ];
  data.receivedInvoices = [
    { ...invoice, id: "paid-unprocessed", vendorId: "synthetic-professional", total: 698530, subtotal: 698530, status: "PAID", mailProcessed: false, originalFileName: "合成支払済書類A.pdf", fileUrl: undefined },
    { ...invoice, id: "scheduled-processed", vendorId: "synthetic-office", total: 27400, subtotal: 27400, status: "SCHEDULED", mailProcessed: true, originalFileName: "合成未払書類B.pdf", fileUrl: undefined },
  ];
  data.mailDocuments = data.receivedInvoices.map((row) => ({ ...mail, id: `mail-${row.id}`, title: row.originalFileName!, senderName: "合成差出人", originalFileName: row.originalFileName!, relatedReceivedInvoiceId: row.id, mailProcessed: row.mailProcessed }));
  data.payments = [{ id: "synthetic-payment", type: "EXPENSE", receivedInvoiceId: "paid-unprocessed", amount: 698530, paymentDate: "2026-10-31", source: "MANUAL", createdById: "admin", createdAt: timestamp, updatedAt: timestamp }];
  return data;
}
