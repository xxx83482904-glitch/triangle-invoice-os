"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import type { EstimateInput } from "@/lib/estimate-values";
import { convertEstimate, deleteEstimate, saveEstimate, type EstimateConversion, type EstimateTarget } from "@/lib/estimates";
import { mutateData } from "@/lib/store";

function refresh() {
  for (const path of ["/estimates", "/documents", "/issued-invoices", "/projects", "/projects/[id]"]) revalidatePath(path, "page");
}
function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "操作に失敗しました";
}
export async function saveEstimateAction(company: CompanyScope, input: EstimateInput) {
  const user = await requireUser();
  try {
    const estimate = await mutateData(user.id, "SAVE_ESTIMATE", "Estimate", input.id || "new", (data) => saveEstimate(data, user, company, input));
    refresh(); return { estimate };
  } catch (error) { return { error: message(error) }; }
}
export async function convertEstimateAction(company: CompanyScope, input: EstimateConversion) {
  const user = await requireUser();
  try {
    const invoice = await mutateData(user.id, "CONVERT_ESTIMATE", "Estimate", input.id, (data) => convertEstimate(data, user, company, input));
    refresh(); return { invoiceId: invoice.id };
  } catch (error) { return { error: message(error) }; }
}
export async function deleteEstimateAction(company: CompanyScope, input: EstimateTarget) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "DELETE_ESTIMATE", "Estimate", input.id, (data) => deleteEstimate(data, user, company, input));
    refresh(); return { success: true };
  } catch (error) { return { error: message(error) }; }
}
