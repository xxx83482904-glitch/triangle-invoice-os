"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertBankAccess } from "@/lib/banking";
import { bankReconciliationOverview } from "@/lib/bank-reconciliation";
import { bankReceiptViews, removeBankReceipt } from "@/lib/bank-receipts";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

function actor(data: AppData, id: string, company: CompanyScope) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限を確認してください");
  assertBankAccess(user, company); return user;
}
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

// What the bank row's detail pane shows without opening the reconciliation dialog: linked invoices and attached receipts.
export async function loadBankDetailDocumentsAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    const data = await readData(); actor(data, user.id, company);
    if (!data.bankTransactions.some((row) => row.id === id && row.company === company)) throw new Error("口座明細が見つかりません。画面を更新してください");
    const linked = data.bankReconciliations.some((row) => !row.deletedAt && row.transactionId === id);
    const overview = linked ? bankReconciliationOverview(data, company) : undefined;
    const invoices = new Map((overview?.invoices || []).map((row) => [row.key, row]));
    const links = (overview?.links || []).filter((row) => row.transactionId === id).map((row) => {
      const invoice = invoices.get(row.invoiceKey);
      return { id: row.id, amount: row.amount, fee: row.fee, issue: row.issue, invoice: invoice ? {
        key: invoice.key, kind: invoice.kind, party: invoice.party, title: invoice.title, project: invoice.project, total: invoice.total, date: invoice.date,
        href: invoice.href, originalHref: invoice.originalHref, originalName: invoice.originalName, originalMimeType: invoice.originalMimeType, originalSource: invoice.originalSource,
      } : undefined };
    });
    return { success: true as const, links, receipts: bankReceiptViews(data, company, id) };
  } catch (error) { return { success: false as const, error: message(error, "書類を取得できませんでした") }; }
}

export async function removeBankReceiptAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    const before = (await readData()).attachments.find((row) => row.id === id);
    await mutateData(user.id, "BANK_RECEIPT_REMOVE", "Attachment", id, (data) => removeBankReceipt(data, actor(data, user.id, company), company, id), before);
    revalidatePath("/banking");
    return { success: true as const };
  } catch (error) { return { success: false as const, error: message(error, "添付を削除できませんでした") }; }
}
