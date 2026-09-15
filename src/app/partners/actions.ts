"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import type { CompanyScope } from "@/lib/company";
import { deleteClient, updateProjectBasics, type ClientDeleteInput, type ProjectBasicInput } from "@/lib/partner-project-edits";
import { mutateData } from "@/lib/store";

function refresh() {
  for (const path of ["/partners", "/projects", "/projects/[id]", "/issued-invoices", "/estimates", "/documents", "/dashboard"]) revalidatePath(path, "page");
}
function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存に失敗しました";
}
export async function saveProjectBasicsAction(company: CompanyScope, input: ProjectBasicInput) {
  const user = await requireUser();
  try {
    const project = await mutateData(user.id, "UPDATE_PROJECT_BASICS", "Project", input.id, (data) => updateProjectBasics(data, user, company, input));
    refresh(); return { project };
  } catch (error) { return { error: message(error) }; }
}
export async function deleteClientAction(company: CompanyScope, input: ClientDeleteInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "DELETE_CLIENT", "Client", input.id, (data) => deleteClient(data, user, company, input));
    refresh(); return { success: true };
  } catch (error) { return { error: message(error) }; }
}
