import { fixture, timestamp } from "./document-fixture";

export function mailRecreateFixture() {
  const data = fixture(); data.appEdition = "JAPAN";
  data.projects = [
    { ...data.projects[0], id: "wrong-project", name: "合成先頭案件（選ばない）", contractFileUrl: undefined },
    { ...data.projects[0], id: "project-a", name: "合成案件A", contractFileUrl: undefined },
    { ...data.projects[0], id: "project-b", name: "合成案件B", contractFileUrl: undefined },
  ];
  data.vendors = [
    { ...data.vendors[0], id: "wrong-vendor", companyName: "合成先頭支払先（選ばない）" },
    { ...data.vendors[0], id: "vendor-a", companyName: "合成制作A" },
    { ...data.vendors[0], id: "vendor-b", companyName: "合成設備B" },
  ];
  const source = data.mailDocuments[0], invoice = data.receivedInvoices[0];
  const details = [
    { id: "mail-a", senderName: "合成制作A", originalFileName: "合成制作A_書類A.pdf", ocrText: "請求元: 合成制作A\n案件: 合成案件A\n請求日: 2026-09-10\n支払期限: 2026-10-10\n請求金額: 12,300円" },
    { id: "mail-b", senderName: "合成設備B", originalFileName: "合成設備B_書類B.pdf", ocrText: "差出人: 合成設備B\n案件名: 合成案件B\n発行日: 2026-10-05\n支払期日: 2026-11-20\n合計: 45,600円" },
    { id: "mail-c", senderName: "合成未登録C", originalFileName: "2026-11-01_合成未登録C_1234abcd.pdf", ocrText: undefined },
    { id: "mail-d", senderName: undefined, originalFileName: "合成設備B_合成案件B_請求日2026-08-12_請求金額7800円.pdf", ocrText: undefined },
  ];
  data.mailDocuments = details.map((row, index) => ({ ...source, ...row, category: "INVOICE", title: row.originalFileName, folderMonth: "2026-10", memo: undefined,
    relatedReceivedInvoiceId: `deleted-${row.id}`, mailProcessed: index === 1, createdAt: `2026-11-01T00:00:0${4 - index}.000Z`, updatedAt: timestamp }));
  data.receivedInvoices = data.mailDocuments.map((mail) => ({ ...invoice, id: mail.relatedReceivedInvoiceId!, vendorId: "wrong-vendor", projectId: "wrong-project", deletedAt: timestamp, total: 999999, originalFileName: "合成旧データ（使わない）.pdf" }));
  data.issuedInvoices = []; data.attachments = []; data.payments = [];
  return data;
}
