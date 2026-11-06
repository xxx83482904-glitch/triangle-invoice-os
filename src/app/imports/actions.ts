"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { applyImportShipmentMutation, importRereadChanges, type ImportShipmentMutation } from "@/lib/import-shipment-views";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";
import { companyFromParam, type CompanyScope } from "@/lib/company";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
}
export async function previewImportRereadAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    const data = await readData(), actor = liveActor(data, user.id);
    assertCompanyAccess(actor, company); assertCan(actor, "manage:imports");
    const row = data.importShipments?.find((row) => row.id === id && !row.deletedAt && companyFromParam(row.company) === company);
    if (!row) throw new Error("輸入便が見つかりません");
    return { success: true as const, version: row.updatedAt, changes: importRereadChanges(data, company, row) };
  } catch (error) { return { success: false as const, error: message(error) }; }
}

export async function saveImportShipmentAction(company: CompanyScope, input: ImportShipmentMutation) {
  const user = await requireUser();
  try {
    const names = { create: "CREATE_IMPORT_SHIPMENT", update: "UPDATE_IMPORT_SHIPMENT", delete: "DELETE_IMPORT_SHIPMENT", assign: "ASSIGN_IMPORT_DOCUMENT", group: "GROUP_IMPORT_DOCUMENTS", reread: "REREAD_IMPORT_SHIPMENT" } as const;
    const targetType = input.action === "assign" ? (input.source === "mail" ? "MailDocument" : "ReceivedInvoice") : "ImportShipment";
    const targetId = input.action === "assign" ? input.documentId : input.action === "group" ? input.shipmentId ?? "new" : "id" in input ? input.id : "new";
    const result = await mutateData(user.id, names[input.action], targetType, targetId, (data) => applyImportShipmentMutation(data, liveActor(data, user.id), company, input));
    for (const path of ["/imports", "/mail-sorter", "/received-invoices", "/documents", "/reports"]) revalidatePath(path);
    revalidatePath("/imports/[id]", "page");
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
