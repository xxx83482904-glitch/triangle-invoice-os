import { z } from "zod";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import type { AppData, User } from "@/lib/types";

const date = z.string().refine((s) => s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s), "日付を確認してください");
const editSchema = z.object({
  id: z.string(), updatedAt: z.string(), invoiceNumber: z.string().trim().min(1).max(100),
  projectId: z.string().min(1), issueDate: date, dueDate: date, total: z.number().finite().nonnegative().max(1e12),
  status: z.enum(["DRAFT", "ISSUED", "SENT", "WAITING_PAYMENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELED", "REISSUED"]),
  needsReview: z.boolean(),
});
export type IssuedEdit = z.infer<typeof editSchema>;


export function applyIssuedInvoiceEdits(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: IssuedEdit[]) {
  const edits = z.array(editSchema).min(1).max(500).parse(input);
  const projects = new Map(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => [p.id, p]));
  const timestamp = new Date().toISOString();
  const seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.id)) throw new Error("同じ書類が重複しています");
    seen.add(edit.id);
    const invoice = data.issuedInvoices.find((i) => i.id === edit.id && !i.deletedAt && projects.has(i.projectId));
    const project = projects.get(edit.projectId);
    if (!invoice || !project) throw new Error("編集できない案件が含まれています");
    if (invoice.updatedAt !== edit.updatedAt) throw new Error("他の操作で更新されています。画面を再読込して確認してください");
    if (edit.status !== "DRAFT" && edit.status !== "CANCELED" && (!edit.issueDate || !edit.dueDate || !edit.total || edit.needsReview)) {
      throw new Error("原本確認・発行日・入金期限・金額を入力してから発行済みにしてください");
    }
    if (edit.issueDate && edit.dueDate && edit.dueDate < edit.issueDate) throw new Error("入金期限は発行日以降にしてください");
    if (edit.status === "PAID" && invoice.status !== "PAID") throw new Error("入金済みへの変更は「入金・支払い」で入金を登録してください");
    if (invoice.status === "PAID" && edit.status !== "PAID") throw new Error("入金済み書類の変更は入金記録を確認してください");
    if (!invoice.fileUrl && invoice.total !== edit.total) throw new Error("手作成の請求書は明細と金額が一致する必要があります");
    const paid = data.payments.filter((p) => !p.deletedAt && p.type === "INCOME" && p.issuedInvoiceId === invoice.id).reduce((s, p) => s + p.amount, 0);
    if (paid > edit.total || (paid > 0 && ["DRAFT", "CANCELED"].includes(edit.status))) throw new Error("入金済みの金額・状態と矛盾しています");
    if (paid > 0 && !["PARTIALLY_PAID", "PAID"].includes(edit.status)) throw new Error("入金記録があるため入金状態は変更できません");
    if (invoice.status === "PAID" && invoice.total !== edit.total) throw new Error("入金済みの請求金額は変更できません");
    if (edit.status === "PARTIALLY_PAID" && (paid <= 0 || paid >= edit.total)) throw new Error("一部入金への変更は入金記録を確認してください");
    invoice.invoiceNumber = edit.invoiceNumber;
    if (edit.projectId !== invoice.projectId || invoice.fileUrl) invoice.clientId = project.clientId;
    invoice.projectId = edit.projectId;
    invoice.issueDate = edit.issueDate;
    invoice.dueDate = edit.dueDate;
    invoice.transactionDate = invoice.transactionDate || edit.issueDate;
    if (invoice.fileUrl) { invoice.total = edit.total; invoice.subtotal = edit.total; invoice.taxTotal = 0; }
    invoice.status = edit.status;
    invoice.needsReview = edit.needsReview;
    invoice.updatedAt = timestamp;
  }
  const numbers = new Set<string>();
  for (const invoice of data.issuedInvoices.filter((i) => !i.deletedAt && data.projects.some((p) => p.id === i.projectId && companyFromParam(p.company) === company))) {
    if (numbers.has(invoice.invoiceNumber)) throw new Error("請求書番号が重複しています");
    numbers.add(invoice.invoiceNumber);
  }
  return { ids: [...seen] };
}
