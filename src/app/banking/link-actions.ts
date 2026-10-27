"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { assertBankAccess } from "@/lib/banking";
import { bankReconciliationOverview } from "@/lib/bank-reconciliation";
import { bankTransferDetail, confirmBankTransfer, removeBankTransfer, type TransferInput } from "@/lib/bank-transfers";
import { readData, mutateData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

function actor(data: AppData, id: string, company: CompanyScope) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限を確認してください");
  assertBankAccess(user, company); return user;
}
const message = (error: unknown) => error instanceof Error ? error.message : "照合情報を取得できませんでした";
function refresh() {
  for (const path of ["/banking", "/banking/accounts", "/banking/reconcile", "/banking/forecast", "/banking/insights"]) revalidatePath(path);
}

export async function loadBankLinksAction(company: CompanyScope, id: string) {
  const user = await requireUser();
  try {
    const data = await readData(); actor(data, user.id, company);
    const transfer = bankTransferDetail(data, company, id);
    const overview = bankReconciliationOverview(data, company);
    const bank = overview.banks.find((row) => row.id === id)!;
    const links = overview.links.filter((row) => row.transactionId === id);
    const invoices = overview.invoices.filter((row) => (bank.side === "INCOME" ? row.kind === "issued" : row.kind === "received") && (row.eligible || links.some((link) => link.invoiceKey === row.key)));
    return { success: true as const, bank, links, invoices, transfer };
  } catch (error) { return { success: false as const, error: message(error) }; }
}

export async function confirmBankTransferAction(company: CompanyScope, input: TransferInput) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_TRANSFER_CONFIRM", "BankTransfer", input.transactionId, (data) => confirmBankTransfer(data, actor(data, user.id, company), company, input));
    refresh(); return { success: true as const };
  } catch (error) { return { success: false as const, error: message(error) }; }
}

export async function removeBankTransferAction(company: CompanyScope, id: string, updatedAt: string) {
  const user = await requireUser();
  try {
    await mutateData(user.id, "BANK_TRANSFER_REMOVE", "BankTransfer", id, (data) => removeBankTransfer(data, actor(data, user.id, company), company, id, updatedAt));
    refresh(); return { success: true as const };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
