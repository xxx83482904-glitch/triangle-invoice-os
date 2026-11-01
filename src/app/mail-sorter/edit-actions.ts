"use server";

import { unstable_rethrow } from "next/navigation";
import { updateOcrDocumentInline } from "@/app/actions";
import { operationErrorMessage } from "@/lib/operation-feedback";

export async function saveOcrDocumentDetails(form: FormData) {
  try {
    await updateOcrDocumentInline(form);
    return { ok: true as const };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false as const, error: operationErrorMessage(error) };
  }
}
