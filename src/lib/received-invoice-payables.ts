import { isPayableReceivedInvoice } from "@/lib/debt-groups";
import { receivedPaymentSummary } from "@/lib/payment-records";
import type { AppData, ReceivedInvoice } from "@/lib/types";

// Scope (visible, live projects in the selected company) is applied by each caller.
// Status alone never settles a debt: the balance comes from active payment records.
export function receivedPayableSummary(data: AppData, invoice: ReceivedInvoice) {
  const payment = receivedPaymentSummary(data, invoice);
  const unpaidExclusion = invoice.deletedAt ? "削除済み"
    : invoice.status === "ARCHIVED" ? "アーカイブ"
    : invoice.status === "REJECTED" ? "却下"
    : !isPayableReceivedInvoice(data, invoice) ? "債務グループの支払対象外" : undefined;
  return { ...payment, unpaidExclusion, unpaidAmount: unpaidExclusion ? 0 : payment.outstanding };
}
