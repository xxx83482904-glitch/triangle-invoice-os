import { fixture, timestamp } from "./document-fixture";
import type { Vendor } from "../src/lib/types";

export function obligationsFixture() {
  const data = fixture(); data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = []; data.attachments = []; data.payments = [];
  const vendor = (id: string, companyName: string, obligationKind?: Vendor["obligationKind"]): Vendor => ({ id, companyName, company: "JAPAN", obligationKind, createdAt: timestamp, updatedAt: timestamp });
  data.vendors = [vendor("tax", "合成港税務署", "TAX"), vendor("pension", "合成年金事務所", "SOCIAL_INSURANCE"), vendor("gas", "合成東京ガス"), vendor("delivery", "合成佐川急便"), vendor("inferred", "合成県税事務所"), vendor("none", "合成税務保険サービス", "NONE"), vendor("explicit", "合成公的納付先", "TAX")];
  const base = { ...data.receivedInvoices[0], status: "SCHEDULED" as const, mailProcessed: false, dueDate: "2026-10-15", issueDate: "2026-10-01", subtotal: 10000, taxTotal: 0, total: 10000 };
  data.receivedInvoices = data.vendors.map((row) => ({ ...base, id: row.id, vendorId: row.id, originalFileName: `${row.companyName}_請求書.pdf`, fileUrl: `/api/files/${row.id}.pdf`, total: row.id === "gas" ? 1138 : row.id === "delivery" ? 3148 : 10000,
    ocrText: "普通の請求書にも消費税・納付書という語が含まれる", memo: "税務署への提出用。実在する取引ではありません" }));
  const mail = data.mailDocuments[0];
  data.mailDocuments = [
    { ...mail, id: "mail-tax", category: "NOTICE" as const, title: "合成納付通知", senderName: "合成港税務署", relatedReceivedInvoiceId: undefined, mailProcessed: false },
    { ...mail, id: "mail-gas", category: "INVOICE" as const, title: "消費税付きガス請求", senderName: "合成東京ガス", relatedReceivedInvoiceId: undefined, mailProcessed: false, ocrText: "消費税 納付書" },
  ];
  return data;
}
