import "server-only";

import { ZodError, z } from "zod";
import { companyFromParam } from "@/lib/company";
import { applyImportShipmentMutation, findImportShipmentByReferences } from "@/lib/import-shipment-views";
import { detectImportDocument, extractImportShipmentFields, importDocumentKinds, importFillKeysByKind, importFillLabels, readImportReferences, type ImportFillKey, type ImportShipmentFields } from "@/lib/import-shipments";
import { intakeMailDocument, type MailIntakeInput, type MailIntakeResult } from "@/lib/mail-intake";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { mutateData } from "@/lib/store";
import type { ImportDocumentKind } from "@/lib/types";
import { isActiveUser } from "@/lib/user-access";

export type ImportIntakeInput = Omit<MailIntakeInput, "importShipmentId" | "importDocumentKind"> & { shipmentId?: string; kind?: ImportDocumentKind };
export type ImportIntakeResult = MailIntakeResult & {
  displayName: string; kind: ImportDocumentKind; shipmentId?: string; shipmentTitle?: string; shipmentCreated?: boolean; filled: string[];
};

export async function intakeImportDocument(input: ImportIntakeInput): Promise<ImportIntakeResult> {
  const { user, company, extracted, fileName } = input;
  assertCompanyAccess(user, company); assertCan(user, "manage:imports");
  const kind = z.enum(importDocumentKinds).parse(input.kind ?? detectImportDocument(extracted.text, fileName)?.kind ?? "OTHER");
  // Reference matching is independent of which fields this kind of paper may fill.
  const references = readImportReferences(extracted.text, fileName);
  const candidates = kind === "OTHER" ? {} : extractImportShipmentFields(extracted.text, fileName, kind);
  const fields: ImportShipmentFields = Object.fromEntries(Object.entries(candidates).filter(([key]) => importFillKeysByKind[kind].includes(key as ImportFillKey)));
  // Customs papers name the shipper, which reads better on the board than a line the sender heuristic picks from the permit.
  const senderName = ["IMPORT_PERMIT", "PACKING_LIST", "WAYBILL"].includes(kind) ? candidates.supplierName : undefined;
  const saved = await intakeMailDocument({ ...input, senderName, importShipmentId: undefined, importDocumentKind: kind });
  const result: ImportIntakeResult = { ...saved, displayName: fileName, kind, filled: [] };
  const source = saved.receivedInvoiceId ? "received" : "mail";
  const documentId = saved.receivedInvoiceId ?? saved.mailDocumentId!;
  try {
    const linked = await mutateData(user.id, "INTAKE_IMPORT_DOCUMENT", source === "received" ? "ReceivedInvoice" : "MailDocument", documentId, (data) => {
      const actor = data.users.find((row) => row.id === user.id && isActiveUser(row));
      if (!actor) throw new Error("利用者の権限が変わっています");
      assertCompanyAccess(actor, company); assertCan(actor, "manage:imports");
      let shipment = input.shipmentId
        ? data.importShipments?.find((row) => row.id === input.shipmentId && !row.deletedAt && companyFromParam(row.company) === company)
        : findImportShipmentByReferences(data, company, references);
      if (input.shipmentId && !shipment) throw new Error("輸入便が見つかりません");
      let shipmentCreated: true | undefined;
      const filled = new Set<ImportFillKey>();
      if (!shipment && kind === "IMPORT_PERMIT") {
        const title = `${fields.supplierName || "輸入便"} ${fields.permitDate || new Date().toISOString().slice(0, 10)}`;
        const created = applyImportShipmentMutation(data, actor, company, { action: "create", title, ...fields });
        shipment = data.importShipments!.find((row) => row.id === created.id)!;
        shipmentCreated = true;
        for (const key of Object.keys(fields) as ImportFillKey[]) filled.add(key);
      }
      if (!shipment) return { filled: [] };
      const assigned = applyImportShipmentMutation(data, actor, company, { action: "assign", shipmentId: shipment.id, source, documentId, kind });
      for (const key of assigned.filled ?? []) filled.add(key);
      return { shipmentId: shipment.id, shipmentTitle: shipment.title, ...(shipmentCreated ? { shipmentCreated } : {}),
        filled: (Object.keys(importFillLabels) as ImportFillKey[]).filter((key) => filled.has(key)).map((key) => importFillLabels[key]) };
    });
    return { ...result, ...linked };
  } catch (error) {
    // The original is already stored; keep its receipt visible when linking fails.
    return { ...result, error: error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください"
      : error instanceof Error ? error.message : "輸入書類を紐付けできませんでした" };
  }
}
