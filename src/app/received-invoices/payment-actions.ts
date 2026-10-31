"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { adjustPayment, cancelPayment, recordPayment, type AdjustPaymentInput, type CancelPaymentInput, type RecordPaymentInput } from "@/lib/payment-records";
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
  for (const path of ["/received-invoices", "/issued-invoices", "/payments", "/dashboard", "/documents", "/mail-sorter", "/projects", "/reports", "/banking/reconcile"]) revalidatePath(path);
  revalidatePath("/projects/[id]", "page");
}
function message(error: unknown, fallback: string) {
  if (error instanceof ZodError) return error.issues[0]?.message || "入力内容を確認してください";
  return error instanceof Error ? error.message : fallback;
}

export async function recordPaymentAction(company: CompanyScope, input: RecordPaymentInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "PAYMENT_RECORD", input.kind === "issued" ? "IssuedInvoice" : "ReceivedInvoice", input.invoiceId, (data) => ({ ...recordPayment(data, liveActor(data, user.id), company, input), reason: input.reason || "" }));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "支払記録を登録できませんでした") }; }
}

export async function cancelPaymentAction(company: CompanyScope, input: CancelPaymentInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "PAYMENT_CANCEL", "Payment", input.paymentId, (data) => ({ ...cancelPayment(data, liveActor(data, user.id), company, input), reason: input.reason }));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "支払記録を取り消せませんでした") }; }
}

export async function adjustPaymentAction(company: CompanyScope, input: AdjustPaymentInput) {
  const user = await requireUser();
  try {
    const result = await mutateData(user.id, "PAYMENT_ADJUST", "Payment", input.paymentId, (data) => ({ ...adjustPayment(data, liveActor(data, user.id), company, input), reason: input.reason }));
    refresh(); return { success: true as const, ...result };
  } catch (error) { return { success: false as const, error: message(error, "支払記録を修正できませんでした") }; }
}
