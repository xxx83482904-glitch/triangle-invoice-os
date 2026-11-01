"use server";

import { unstable_rethrow } from "next/navigation";
import { createIssuedInvoice } from "@/app/actions";
import { operationErrorMessage } from "@/lib/operation-feedback";

export async function createIssuedInvoiceFeedback(form: FormData) {
  try {
    await createIssuedInvoice(form);
    return { ok: true as const };
  } catch (error) {
    // Keep the original success/authentication redirect and its URL intact.
    unstable_rethrow(error);
    return { ok: false as const, error: operationErrorMessage(error) };
  }
}
