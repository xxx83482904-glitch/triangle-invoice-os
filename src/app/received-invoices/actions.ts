"use server";

import { updateReceivedInvoiceInline, updateReceivedInvoiceStatus } from "@/app/actions";
import { unstable_rethrow } from "next/navigation";
import { operationErrorMessage } from "@/lib/operation-feedback";

export async function saveReceivedInvoiceStatus(formData: FormData) {
  try {
    await updateReceivedInvoiceStatus(formData);
    return { ok: true as const };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false as const, error: operationErrorMessage(error) };
  }
}

export async function saveReceivedInvoice(formData: FormData) {
  try {
    await updateReceivedInvoiceInline(formData);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "保存に失敗しました。入力内容を保持しています。" };
  }
}
