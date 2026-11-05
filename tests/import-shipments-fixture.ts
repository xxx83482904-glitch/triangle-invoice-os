import { fixture, timestamp } from "./document-fixture";
import type { AppData, ImportShipment, MailDocument, ReceivedInvoice } from "../src/lib/types";

// Synthetic import paperwork only: every name, number and amount here is made up.
export function importShipmentsFixture(): AppData {
  const data = fixture(); data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = []; data.attachments = []; data.payments = [];
  const base = { createdAt: timestamp, updatedAt: timestamp };
  data.vendors = [
    { ...base, id: "broker", companyName: "合成通関サービス", company: "JAPAN" },
    { ...base, id: "overseas", companyName: "合成海外家具廠", company: "JAPAN" },
    { ...base, id: "gas", companyName: "合成東京ガス", company: "JAPAN" },
  ];
  const invoice = (id: string, vendorId: string, total: number, extra: Partial<ReceivedInvoice> = {}): ReceivedInvoice => ({
    ...base, id, vendorId, projectId: "japan", receivedDate: "2026-10-10", issueDate: "2026-10-10", dueDate: "2026-11-10", subtotal: total, taxTotal: 0, total,
    status: "REVIEWING", uploadedById: "admin", originalFileName: `${id}.pdf`, fileUrl: `/api/files/${id}.pdf`, mimeType: "application/pdf", ...extra,
  });
  data.receivedInvoices = [
    invoice("broker-1", "broker", 88000, { importShipmentId: "ship-1", importDocumentKind: "BROKER_INVOICE", ocrText: "合成通関サービス 請求書 通関料 関税 立替 輸入消費税 輸入許可番号 合成-0001" }),
    invoice("supplier-1", "overseas", 500000, { importShipmentId: "ship-1", importDocumentKind: "SUPPLIER_INVOICE", ocrText: "COMMERCIAL INVOICE FOB SHENZHEN" }),
    invoice("broker-2", "broker", 30000, { importShipmentId: "ship-2", issueDate: "2026-10-22", ocrText: "合成通関サービス 請求書 通関手数料 関税立替" }),
    invoice("broker-3", "broker", 45000, { issueDate: "2026-10-28", ocrText: "合成通関サービス 請求書 通関料 輸入消費税 立替" }),
    invoice("gas-1", "gas", 1200, { ocrText: "合成東京ガス 請求書 消費税" }),
  ];
  const mail = (id: string, title: string, extra: Partial<MailDocument> = {}): MailDocument => ({
    ...base, id, company: "JAPAN", category: "CUSTOMS", title, senderName: "合成通関サービス", fileUrl: `/api/files/${id}.pdf`, originalFileName: `${id}.pdf`,
    mimeType: "application/pdf", uploadedById: "admin", folderMonth: "2026-10", ...extra,
  });
  data.mailDocuments = [
    mail("permit-1", "輸入許可通知書 第1便", { importShipmentId: "ship-1", importDocumentKind: "IMPORT_PERMIT", ocrText: "輸入許可通知書 輸入許可番号 合成-0001 関税額 15,000円 消費税額 40,000円 地方消費税額 11,000円" }),
    mail("packing-1", "パッキングリスト 第1便", { importShipmentId: "ship-1", ocrText: "PACKING LIST carton 12" }),
    mail("awb-1", "AWB 第1便", { importShipmentId: "ship-1", ocrText: "AIR WAYBILL 合成-AWB-001" }),
    mail("permit-3", "輸入許可通知書 未割当", { ocrText: "輸入許可通知書 輸入許可番号 SYN-0003 関税額 3,000円" }),
    mail("packing-x", "梱包明細", { category: "OTHER", ocrText: "PACKING LIST 3 cartons" }),
    mail("receipt-1", "合成領収書", { category: "RECEIPT", senderName: "合成東京ガス", ocrText: "領収書 消費税" }),
    mail("linked-1", "通関請求書（郵便）", { category: "INVOICE", relatedReceivedInvoiceId: "broker-3", ocrText: "通関料 関税 立替 請求書" }),
    mail("china-permit", "中国の許可書", { company: "CHINA", ocrText: "輸入許可通知書" }),
  ];
  const shipment = (id: string, title: string, extra: Partial<ImportShipment> = {}): ImportShipment => ({ ...base, id, company: "JAPAN", title, status: "OPEN", createdById: "admin", ...extra });
  data.importShipments = [
    shipment("ship-1", "合成照明器具 第1便", { projectId: "japan", supplierName: "合成海外家具廠", brokerVendorId: "broker", permitNumber: "合成-0001", permitDate: "2026-10-05", goodsValue: 500000, dutyAmount: 15000, importTaxNational: 40000, importTaxLocal: 11000, brokerFee: 22000, status: "CLEARED", memo: "合成データ。実在の取引ではありません。" }),
    shipment("ship-2", "合成什器 第2便", { projectId: "japan", brokerVendorId: "broker", permitDate: "2026-10-20", dutyAmount: 5000, importTaxNational: 9000, importTaxLocal: 2500 }),
    shipment("ship-old", "合成旧便（9月）", { folderMonth: "2026-09", status: "CLOSED", dutyAmount: 1000 }),
    shipment("ship-deleted", "削除済み", { deletedAt: timestamp }),
  ];
  return data;
}

export function importGroupingFixture(): AppData {
  const data = importShipmentsFixture();
  const mail = (id: string, title: string, ocrText: string): MailDocument => ({
    ...data.mailDocuments[0], id, title, originalFileName: `${id}-saved.pdf`, fileUrl: `/api/files/${id}.pdf`,
    importShipmentId: undefined, importDocumentKind: undefined, ocrText,
  });
  const invoice = (id: string, vendorId: string, ocrText: string): ReceivedInvoice => ({
    ...data.receivedInvoices[0], id, vendorId, originalFileName: `${id}-saved.pdf`, fileUrl: `/api/files/${id}.pdf`,
    importShipmentId: undefined, importDocumentKind: undefined, ocrText,
  });
  data.mailDocuments.push(
    mail("bl-9", "合成B/L 保存書類", "合成B-L原本.pdf\nHOUSE BILL OF LADING\nB/L No. SYN1BL260001\nShipper: 合成海外家具廠"),
    mail("packing-9", "合成梱包明細 保存書類", "合成梱包明細原本.pdf\nPACKING LIST\nInvoice No. SYN-INV-0091\nShipper: 合成海外家具廠"),
    mail("packing-10", "合成別便 梱包明細", "合成別便原本.pdf\nPACKING LIST\nInvoice No. SYN-INV-0101\nShipper: 合成別便製作所"),
  );
  data.receivedInvoices.push(
    invoice("broker-9", "broker", "合成通関原本.pdf\n請求書 通関料 3,000円\nB/L No. SYN1BL260001"),
    invoice("supplier-9", "overseas", "合成仕入原本.pdf\nCOMMERCIAL INVOICE\nInvoice No. SYN-INV-0091\nSeller: 合成海外家具廠\nFOB"),
  );
  return data;
}
