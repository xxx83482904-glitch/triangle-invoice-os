"use server";

import { updateReceivedInvoiceInline } from "@/app/actions";

export async function saveReceivedInvoice(formData: FormData) {
  try {
    await updateReceivedInvoiceInline(formData);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "保存に失敗しました。入力内容を保持しています。" };
  }
}
