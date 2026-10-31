"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { linkMailDocumentToReceivedInvoice, unlinkMailDocument, type LinkMailDocumentInput, type UnlinkMailDocumentInput } from "@/lib/mail-links";
import { mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { CompanyScope } from "@/lib/company";
import type { AppData } from "@/lib/types";

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}
function refresh() {
  for (const path of ["/mail-sorter", "/received-invoices", "/documents", "/dashboard", "/payments", "/banking/reconcile"]) revalidatePath(path);
}
function message(error: unknown, fallback: string) {
  if (error instanceof ZodError) return error.issues[0]?.message || "入力内容を確認してください";
  return error instanceof Error ? error.message : fallback;
}

export async function linkMailDocumentAction(company: CompanyScope, input: LinkMailDocumentInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "LINK_MAIL_DOCUMENT", "MailDocument", input.mailDocumentId, (data) => linkMailDocumentToReceivedInvoice(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "再連携できませんでした") }; }
}

export async function unlinkMailDocumentAction(company: CompanyScope, input: UnlinkMailDocumentInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "UNLINK_MAIL_DOCUMENT", "MailDocument", input.mailDocumentId, (data) => unlinkMailDocument(data, liveActor(data, user.id), company, input));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "連携を解除できませんでした") }; }
}
