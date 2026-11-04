"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { applyImportShipmentMutation, type ImportShipmentMutation } from "@/lib/import-shipment-views";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
}
export async function saveImportShipmentAction(company: CompanyScope, input: ImportShipmentMutation) {
  const user = await requireUser();
  try {
    const names = { create: "CREATE_IMPORT_SHIPMENT", update: "UPDATE_IMPORT_SHIPMENT", delete: "DELETE_IMPORT_SHIPMENT", assign: "ASSIGN_IMPORT_DOCUMENT" } as const;
    const targetType = input.action === "assign" ? (input.source === "mail" ? "MailDocument" : "ReceivedInvoice") : "ImportShipment";
    const targetId = input.action === "assign" ? input.documentId : "id" in input ? input.id : "new";
    const result = await mutateData(user.id, names[input.action], targetType, targetId, (data) => applyImportShipmentMutation(data, liveActor(data, user.id), company, input));
    for (const path of ["/imports", "/mail-sorter", "/received-invoices", "/documents", "/reports"]) revalidatePath(path);
    return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
