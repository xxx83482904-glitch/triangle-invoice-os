import type { AppData, IssuedInvoice, IssuedInvoiceStatus } from "@/lib/types";

export const issuedStatusLabels: Record<IssuedInvoiceStatus, string> = {
  DRAFT: "下書き", ISSUED: "発行済み", SENT: "送付済み", WAITING_PAYMENT: "入金未完了", PARTIALLY_PAID: "一部入金",
  PAID: "入金完了", OVERDUE: "期限超過", CANCELED: "キャンセル", REISSUED: "再発行済み",
};

export function invoicePaymentSummary(data: Pick<AppData, "payments">, invoice: IssuedInvoice) {
  const payments = data.payments.filter((p) => !p.deletedAt && p.type === "INCOME" && p.issuedInvoiceId === invoice.id);
  const paid = Math.round(payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const statusPaid = Math.round(payments.filter((p) => p.source === "INVOICE_STATUS").reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const status: IssuedInvoiceStatus = paid > 0 && paid >= invoice.total ? "PAID" : paid > 0 ? "PARTIALLY_PAID"
    : ["PAID", "PARTIALLY_PAID"].includes(invoice.status) ? "WAITING_PAYMENT" : invoice.status;
  return { paid, statusPaid, status, paidAt: status === "PAID" ? payments.map((p) => p.paymentDate).sort().at(-1) : undefined };
}
