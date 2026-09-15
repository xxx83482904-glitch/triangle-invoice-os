import type { AppData, IssuedInvoice, User } from "../src/lib/types";

export const timestamp = "2026-09-15T00:00:00.000Z";
export const admin: Pick<User, "id" | "role"> = { id: "admin", role: "ADMIN" };
export const manager: Pick<User, "id" | "role"> = { id: "manager", role: "PROJECT_MANAGER" };

export function fixture(): AppData {
  const base = { createdAt: timestamp, updatedAt: timestamp };
  const issued: IssuedInvoice = { ...base, id: "issued-1", invoiceNumber: "INV-001", projectId: "japan", clientId: "client", issueDate: "2026-09-15", dueDate: "2026-10-15", transactionDate: "2026-09-15", subtotal: 12000, taxTotal: 0, total: 12000, status: "DRAFT", needsReview: true, fileUrl: "/api/files/issued.pdf", originalFileName: "issued.pdf", mimeType: "application/pdf", createdById: "admin" };
  return { seedVersion: 4, users: [], clients: [{ ...base, id: "client", companyName: "Test customer", company: "JAPAN" }], vendors: [{ ...base, id: "vendor", companyName: "Test supplier", company: "JAPAN" }], selectOptions: [],
    projects: [
      { ...base, id: "japan", name: "Japan project", clientId: "client", managerId: "manager", memberIds: [], company: "JAPAN", status: "IN_PROGRESS", contractAmount: 100000, contractFileUrl: "/api/files/contract.pdf" },
      { ...base, id: "other", name: "Other project", clientId: "client", managerId: "other", memberIds: [], company: "JAPAN", status: "IN_PROGRESS", contractAmount: 100000 },
      { ...base, id: "china", name: "China project", clientId: "client", managerId: "manager", memberIds: [], company: "CHINA", status: "IN_PROGRESS", contractAmount: 100000 },
    ], issuedInvoices: [issued, { ...issued, id: "issued-2", invoiceNumber: "INV-002", projectId: "other", fileUrl: "/api/files/other.pdf" }, { ...issued, id: "issued-cn", invoiceNumber: "INV-CN", projectId: "china", fileUrl: "/api/files/china.pdf" }], issuedInvoiceItems: [],
    receivedInvoices: [{ ...base, id: "received-1", vendorId: "vendor", projectId: "japan", receivedDate: "2026-09-15", issueDate: "2026-09-15", dueDate: "2026-10-15", folderMonth: "2026-08", total: 8000, subtotal: 8000, taxTotal: 0, status: "PAID", mailProcessed: true, fileUrl: "/api/files/received.pdf", uploadedById: "admin" }],
    mailFolders: [], mailDocuments: [{ ...base, id: "mail-1", company: "JAPAN", category: "RECEIPT", title: "Receipt", senderName: "Test supplier", fileUrl: "/api/files/received.pdf", originalFileName: "received.pdf", mimeType: "application/pdf", relatedReceivedInvoiceId: "received-1", mailProcessed: true, uploadedById: "admin" }],
    attachments: [{ id: "attachment-1", relatedType: "MailDocument", relatedId: "mail-1", fileName: "received.pdf", fileUrl: "/api/files/received.pdf", mimeType: "application/pdf", uploadedById: "admin", createdAt: timestamp },
      { id: "old-contract", relatedType: "ProjectContract", relatedId: "japan", fileName: "old.pdf", fileUrl: "/api/files/old.pdf", mimeType: "application/pdf", uploadedById: "admin", createdAt: timestamp }],
    payments: [], auditLogs: [], invoiceNumberSettings: [] };
}
