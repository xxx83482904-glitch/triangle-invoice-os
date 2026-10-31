import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppData, ApiTokenScope, AgentRequest, Payment, Project, ReceivedInvoice, IssuedInvoice, Vendor } from "@/lib/types";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { bankToday, saveBankEdits } from "@/lib/banking";
import type { BankTransaction } from "@/lib/banking-types";
import { bankClassificationLabel } from "@/lib/bank-classification";
import { saveBankBookkeeping, type BankBookkeepingInput } from "@/lib/bank-bookkeeping";
import { confirmBankReconciliation, confirmBankReconciliationBatch, reaffirmBankReconciliation, reconciliationIssue, removeBankReconciliation, type ReconcileInput } from "@/lib/bank-reconciliation";
import { linkMailDocumentToReceivedInvoice, unlinkMailDocument } from "@/lib/mail-links";
import { adjustPayment, cancelPayment, recordPayment } from "@/lib/payment-records";
import { applyReceivedInvoiceFields } from "@/lib/received-invoice-edits";
import { bankSyncRunViews } from "@/lib/bank-sync-runs";
import { integrityReport } from "@/lib/integrity";
import { can, canAccessCompany } from "@/lib/rbac";
import { visibleProjects } from "@/lib/documents";
import { agentCan, type AgentAuth } from "@/lib/agent-tokens";

export class AgentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const normalize = (value?: string) => (value || "").normalize("NFKC").trim().toLocaleLowerCase("ja");

// ---- Reads -------------------------------------------------------------------------------------

export const agentResources = {
  "bank-transactions": "bank:read", "received-invoices": "bank:read", "issued-invoices": "bank:read", payments: "bank:read", reconciliations: "bank:read",
  "mail-documents": "bank:read", vendors: "bank:read", projects: "bank:read", categories: "bank:read", "sync-runs": "bank:read", integrity: "integrity:read",
} as const satisfies Record<string, ApiTokenScope>;
export type AgentResource = keyof typeof agentResources;
export const isAgentResource = (value: string): value is AgentResource => Object.hasOwn(agentResources, value);

const listSchema = z.object({
  company: z.string().optional(), start: z.string().optional(), end: z.string().optional(), updatedSince: z.string().optional(),
  account: z.string().optional(), status: z.string().optional(), side: z.enum(["INCOME", "EXPENSE"]).optional(), reviewed: z.enum(["true", "false"]).optional(),
  q: z.string().max(200).optional(), kind: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.coerce.number().int().min(0).default(0),
});
export type AgentListParams = z.input<typeof listSchema>;

function invoiceCompany(data: AppData, projectId: string) {
  const project = data.projects.find((row) => row.id === projectId && !row.deletedAt);
  return project ? companyFromParam(project.company) : undefined;
}

export function listAgentResource(data: AppData, auth: AgentAuth, resource: AgentResource, params: AgentListParams, options: { today?: string; fileExists?: (fileUrl?: string) => boolean | undefined } = {}) {
  const value = listSchema.parse(params), company = companyFromParam(value.company), today = options.today || bankToday();
  if (!canAccessCompany(auth.user, company)) throw new AgentError(403, "会社スコープ外です");
  if (!agentCan(auth, agentResources[resource])) throw new AgentError(403, `スコープ ${agentResources[resource]} が必要です`);
  const inRange = (date?: string) => (!value.start || (date || "") >= value.start) && (!value.end || (date || "") <= value.end);
  const since = (row: { updatedAt: string }) => !value.updatedSince || row.updatedAt > value.updatedSince;
  const text = normalize(value.q);
  const matches = (...fields: Array<string | undefined>) => !text || fields.some((field) => normalize(field).includes(text));
  const projects = new Set(visibleProjects(data, auth.user).filter((row) => companyFromParam(row.company) === company && !row.deletedAt).map((row) => row.id));
  let rows: unknown[] = [], extra: Record<string, unknown> = {};
  switch (resource) {
    case "bank-transactions":
      rows = data.bankTransactions.filter((row) => row.company === company && inRange(row.transactionDate) && since(row) && (!value.account || row.bankAccountId === value.account) && (!value.side || row.side === value.side)
        && (!value.reviewed || String(row.reviewed) === value.reviewed) && (!value.status || row.treatment === value.status) && matches(row.content, row.memo, row.sourceMemo))
        .map((row) => ({ ...row, classification: bankClassificationLabel(row) }));
      break;
    case "received-invoices":
      rows = data.receivedInvoices.filter((row) => !row.deletedAt && projects.has(row.projectId) && inRange(row.issueDate) && since(row) && (!value.status || row.status === value.status) && matches(row.originalFileName, row.memo));
      break;
    case "issued-invoices":
      rows = data.issuedInvoices.filter((row) => !row.deletedAt && projects.has(row.projectId) && inRange(row.issueDate) && since(row) && (!value.status || row.status === value.status) && matches(row.invoiceNumber, row.notes));
      break;
    case "payments":
      rows = data.payments.filter((row) => !row.deletedAt && inRange(row.paymentDate) && since(row) && (!value.side || (row.type === "INCOME" ? "INCOME" : "EXPENSE") === value.side) && paymentInScope(data, row, projects));
      break;
    case "reconciliations":
      rows = data.bankReconciliations.filter((row) => !row.deletedAt && row.company === company && since(row)).map((row) => ({ ...row, issue: reconciliationIssue(data, row, today) || "" }))
        .filter((row) => !value.status || (value.status === "conflict" ? Boolean(row.issue) : value.status === "valid" ? !row.issue : true));
      break;
    case "mail-documents":
      rows = data.mailDocuments.filter((row) => !row.deletedAt && companyFromParam(row.company) === company && inRange(row.folderMonth || row.createdAt.slice(0, 7)) && since(row) && (!value.status || row.category === value.status) && matches(row.title, row.senderName, row.originalFileName));
      break;
    case "vendors":
      rows = data.vendors.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company) && since(row) && matches(row.companyName, row.accountHolder));
      break;
    case "projects":
      rows = data.projects.filter((row) => projects.has(row.id) && since(row) && (!value.status || row.status === value.status) && matches(row.name));
      break;
    case "categories":
      rows = data.accountingCategories.filter((row) => row.company === company && row.available && !row.deletedAt && since(row) && matches(row.name, row.group));
      break;
    case "sync-runs":
      rows = bankSyncRunViews(data, auth.user, company);
      break;
    case "integrity": {
      const report = integrityReport(data, company, { today, fileExists: options.fileExists });
      rows = value.kind ? report.issues.filter((issue) => issue.kind === value.kind) : report.issues;
      extra = { counts: report.counts, severity: report.severity, truncated: report.truncated, generatedAt: report.generatedAt };
      break;
    }
  }
  const items = rows.slice(value.cursor, value.cursor + value.limit);
  return { resource, company, total: rows.length, limit: value.limit, cursor: value.cursor, nextCursor: value.cursor + value.limit < rows.length ? String(value.cursor + value.limit) : undefined, items, ...extra };
}

function paymentInScope(data: AppData, payment: Payment, projects: Set<string>) {
  const invoice = payment.issuedInvoiceId ? data.issuedInvoices.find((row) => row.id === payment.issuedInvoiceId) : payment.receivedInvoiceId ? data.receivedInvoices.find((row) => row.id === payment.receivedInvoiceId) : undefined;
  return Boolean(invoice && projects.has(invoice.projectId));
}

// ---- Writes ------------------------------------------------------------------------------------

export const agentOperations = {
  "bank.classify": "bank:write", "bank.bookkeeping": "bank:write",
  "reconcile.confirm": "reconcile:write", "reconcile.batch": "reconcile:write", "reconcile.remove": "reconcile:write", "reconcile.reaffirm": "reconcile:write",
  "mail.link": "mail:write", "mail.unlink": "mail:write",
  "payment.record": "payments:write", "payment.cancel": "payments:write", "payment.adjust": "payments:write",
  "received.update": "received:write", "vendor.create": "partners:write", "project.create": "partners:write",
} as const satisfies Record<string, ApiTokenScope>;
export type AgentOperation = keyof typeof agentOperations;
const operationNames = Object.keys(agentOperations) as [AgentOperation, ...AgentOperation[]];

export const agentBatchSchema = z.object({
  company: z.string().optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  dryRun: z.boolean().default(false),
  atomicity: z.enum(["batch", "row"]).default("batch"),
  reason: z.string().trim().max(1000).optional(),
  operations: z.array(z.object({
    op: z.enum(operationNames),
    target: z.object({ id: z.string().min(1).max(1000).optional() }).default({}),
    expect: z.object({ updatedAt: z.string().optional(), transactionDate: z.string().optional(), amount: z.number().optional(), content: z.string().optional() }).default({}),
    payload: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().trim().max(1000).optional(),
  })).min(1).max(200),
});
export type AgentBatchRequest = z.infer<typeof agentBatchSchema>;
export type AgentBatchInput = z.input<typeof agentBatchSchema>;
type Operation = AgentBatchRequest["operations"][number];
export type AgentChange = { collection: string; id: string; before: unknown; after: unknown };
export type AgentOperationResult = { index: number; op: AgentOperation; status: "succeeded" | "failed" | "skipped"; targetId?: string; result?: unknown; error?: string; changes?: AgentChange[] };
export type AgentBatchOutcome = { company: CompanyScope; dryRun: boolean; atomicity: "batch" | "row"; results: AgentOperationResult[]; succeeded: number; failed: number; skipped: number };

const trackedCollections = ["bankTransactions", "bankReconciliations", "bankTransfers", "payments", "receivedInvoices", "issuedInvoices", "mailDocuments", "vendors", "projects"] as const;
type Tracked = (typeof trackedCollections)[number];
type Row = { id: string; updatedAt: string; deletedAt?: string | null };
const rowsOf = (data: AppData, collection: Tracked) => ((data[collection] || []) as Row[]);
const stampIndex = (data: AppData) => new Map(trackedCollections.map((collection) => [collection, new Map(rowsOf(data, collection).map((row) => [row.id, `${row.updatedAt}|${row.deletedAt || ""}`]))]));
function diffChanges(baseline: AppData, before: ReturnType<typeof stampIndex>, data: AppData): AgentChange[] {
  const changes: AgentChange[] = [];
  for (const collection of trackedCollections) {
    const previous = before.get(collection)!, original = new Map(rowsOf(baseline, collection).map((row) => [row.id, row]));
    for (const row of rowsOf(data, collection)) {
      const key = `${row.updatedAt}|${row.deletedAt || ""}`;
      if (previous.get(row.id) !== key) changes.push({ collection, id: row.id, before: original.get(row.id) ?? null, after: row });
    }
  }
  return changes;
}

const reference = z.string().min(1).max(1000);
const nullableReference = reference.nullable().optional();
const treatment = z.enum(["NORMAL", "TRANSFER", "EXCLUDED"]);
const classifySchema = z.object({ categoryId: nullableReference, subCategoryId: nullableReference, treatment: treatment.optional(), reviewed: z.boolean().optional(), memo: z.string().max(2000).optional(),
  classificationConfidence: z.enum(["GUESS", "HISTORY", "INFERRED"]).optional(), classificationReason: z.string().max(1000).optional(), acknowledgeGuess: z.boolean().optional() });
const bookkeepingSchema = z.object({ categoryId: nullableReference, subCategoryId: nullableReference, splits: z.array(z.unknown()).optional(), hold: z.unknown().optional(), invoiceRequirement: z.enum(["UNDECIDED", "REQUIRED", "NOT_REQUIRED"]).optional(), memo: z.string().max(2000).optional(), reviewed: z.boolean().optional() });
const allocationSchema = z.object({ invoiceKind: z.enum(["issued", "received"]), invoiceId: reference, amount: z.number(), mode: z.enum(["existing", "new"]).default("new"), paymentId: reference.optional(), note: z.string().trim().max(1000).optional(), duplicateAcknowledged: z.boolean().optional() });
const batchAllocationsSchema = z.object({ allocations: z.array(allocationSchema).min(1).max(50) });
const mailLinkSchema = z.object({ receivedInvoiceId: reference });
const paymentRecordSchema = z.object({ kind: z.enum(["issued", "received"]), invoiceId: reference, amount: z.number(), paymentDate: z.string(), method: z.string().trim().max(100).optional(), memo: z.string().trim().max(1000).optional() });
const paymentAdjustSchema = z.object({ amount: z.number().optional(), paymentDate: z.string().optional() });
const receivedUpdateSchema = z.object({ projectId: reference.optional(), vendorId: reference.optional(), issueDate: z.string().optional(), dueDate: z.string().optional(), memo: z.string().max(2000).nullable().optional(),
  subtotal: z.number().optional(), taxTotal: z.number().optional(), total: z.number().optional(), grossAmount: z.number().optional(), withholdingAmount: z.number().optional() });
const vendorSchema = z.object({ companyName: z.string().trim().min(1).max(200), contactName: z.string().trim().max(200).optional(), email: z.string().trim().max(200).optional(), phone: z.string().trim().max(50).optional(), address: z.string().trim().max(500).optional(),
  invoiceRegistrationNumber: z.string().trim().max(50).optional(), bankName: z.string().trim().max(100).optional(), branchName: z.string().trim().max(100).optional(), accountType: z.string().trim().max(50).optional(), accountNumber: z.string().trim().max(50).optional(), accountHolder: z.string().trim().max(200).optional(), memo: z.string().trim().max(2000).optional() });
const projectSchema = z.object({ name: z.string().trim().min(1).max(200), clientId: reference.optional(), managerId: reference.optional(), memberIds: z.array(reference).max(50).optional(), status: z.enum(["PLANNING", "IN_PROGRESS", "WAITING", "COMPLETED", "ARCHIVED"]).default("IN_PROGRESS"),
  stage: z.string().trim().max(100).optional(), contractAmount: z.number().min(0).default(0), billingCount: z.number().int().min(1).max(12).optional(), startDate: z.string().optional(), endDate: z.string().optional(), memo: z.string().trim().max(2000).optional() });

function expectUpdatedAt(record: { updatedAt: string }, operation: Operation, label: string) {
  if (operation.expect.updatedAt && operation.expect.updatedAt !== record.updatedAt) throw new AgentError(409, `${label}が更新されています（expect.updatedAt が一致しません）`);
}
function bankRow(data: AppData, company: CompanyScope, operation: Operation) {
  const rows = data.bankTransactions.filter((row) => row.company === company);
  let row: BankTransaction | undefined;
  if (operation.target.id) row = rows.find((item) => item.id === operation.target.id);
  else {
    const { transactionDate, amount, content } = operation.expect;
    if (!transactionDate || amount === undefined || content === undefined) throw new AgentError(400, "target.id か expect（transactionDate・amount・content）で明細を指定してください");
    const found = rows.filter((item) => item.transactionDate === transactionDate && Math.round(item.amount * 100) === Math.round(amount * 100) && normalize(item.content) === normalize(content));
    if (found.length > 1) throw new AgentError(409, "expect に一致する明細が複数あります。target.id を指定してください");
    row = found[0];
  }
  if (!row) throw new AgentError(404, "明細が見つかりません");
  expectUpdatedAt(row, operation, "明細");
  return row;
}
function find<T extends Row>(rows: T[], id: string | undefined, label: string, operation: Operation, extra: (row: T) => boolean = () => true) {
  const row = id ? rows.find((item) => item.id === id && !item.deletedAt && extra(item)) : undefined;
  if (!row) throw new AgentError(404, `${label}が見つかりません`);
  expectUpdatedAt(row, operation, label);
  return row;
}
function allocation(data: AppData, company: CompanyScope, bank: BankTransaction, input: z.infer<typeof allocationSchema>): ReconcileInput {
  const invoice = (input.invoiceKind === "issued" ? data.issuedInvoices : data.receivedInvoices).find((row) => row.id === input.invoiceId && !row.deletedAt && invoiceCompany(data, row.projectId) === company);
  if (!invoice) throw new AgentError(404, "請求書が見つかりません");
  const payment = input.mode === "existing" ? data.payments.find((row) => row.id === input.paymentId && !row.deletedAt) : undefined;
  if (input.mode === "existing" && !payment) throw new AgentError(404, "支払・入金記録が見つかりません");
  return { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: input.invoiceKind, invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: input.amount, mode: input.mode,
    paymentId: payment?.id, paymentUpdatedAt: payment?.updatedAt, acknowledged: true, note: input.note || "", duplicateAcknowledged: input.duplicateAcknowledged };
}
const nextSortOrder = (rows: Array<{ company?: string | null; deletedAt?: string | null; sortOrder?: number }>, company: CompanyScope) => Math.max(0, ...rows.filter((row) => !row.deletedAt && companyFromParam(row.company) === company).map((row) => row.sortOrder || 0)) + 1;

function applyOperation(data: AppData, auth: AgentAuth, company: CompanyScope, operation: Operation, today: string): { targetId?: string; result: unknown } {
  const scope = agentOperations[operation.op];
  if (!agentCan(auth, scope)) throw new AgentError(403, `スコープ ${scope} が必要です`);
  const actor = auth.user, reason = operation.reason || "";
  switch (operation.op) {
    case "bank.classify": {
      const row = bankRow(data, company, operation), payload = classifySchema.parse(operation.payload);
      const result = saveBankEdits(data, actor, company, [{ id: row.id, updatedAt: row.updatedAt, categoryId: payload.categoryId === null ? undefined : payload.categoryId ?? row.categoryId, subCategoryId: payload.subCategoryId === null ? undefined : payload.subCategoryId ?? row.subCategoryId,
        treatment: payload.treatment ?? row.treatment, reviewed: payload.reviewed ?? row.reviewed, memo: payload.memo ?? row.memo, classificationConfidence: payload.classificationConfidence, classificationReason: payload.classificationReason, acknowledgeGuess: payload.acknowledgeGuess }]);
      return { targetId: row.id, result };
    }
    case "bank.bookkeeping": {
      const row = bankRow(data, company, operation), payload = bookkeepingSchema.parse(operation.payload);
      const input = { id: row.id, updatedAt: row.updatedAt, categoryId: payload.categoryId === null ? undefined : payload.categoryId ?? row.categoryId, subCategoryId: payload.subCategoryId === null ? undefined : payload.subCategoryId ?? row.subCategoryId,
        splits: payload.splits ?? row.bookkeeping?.splits ?? [], hold: payload.hold === undefined ? row.bookkeeping?.hold ?? null : payload.hold, invoiceRequirement: payload.invoiceRequirement ?? row.bookkeeping?.invoiceRequirement ?? "UNDECIDED", memo: payload.memo ?? row.memo, reviewed: payload.reviewed ?? row.reviewed } as BankBookkeepingInput;
      return { targetId: row.id, result: saveBankBookkeeping(data, actor, company, input) };
    }
    case "reconcile.confirm": {
      const row = bankRow(data, company, operation), payload = allocationSchema.parse(operation.payload);
      return { targetId: row.id, result: confirmBankReconciliation(data, actor, company, allocation(data, company, row, payload), today) };
    }
    case "reconcile.batch": {
      const row = bankRow(data, company, operation), payload = batchAllocationsSchema.parse(operation.payload);
      return { targetId: row.id, result: confirmBankReconciliationBatch(data, actor, company, { transactionId: row.id, transactionUpdatedAt: row.updatedAt, acknowledged: true, allocations: payload.allocations.map((item) => allocation(data, company, row, item)) }, today) };
    }
    case "reconcile.remove": {
      const link = find(data.bankReconciliations, operation.target.id, "照合記録", operation, (item) => item.company === company);
      return { targetId: link.id, result: removeBankReconciliation(data, actor, company, link.id, link.updatedAt) };
    }
    case "reconcile.reaffirm": {
      const link = find(data.bankReconciliations, operation.target.id, "照合記録", operation, (item) => item.company === company);
      return { targetId: link.id, result: reaffirmBankReconciliation(data, actor, company, link.id, link.updatedAt, today) };
    }
    case "mail.link": {
      const mail = find(data.mailDocuments, operation.target.id, "郵便物", operation, (item) => companyFromParam(item.company) === company), payload = mailLinkSchema.parse(operation.payload);
      return { targetId: mail.id, result: linkMailDocumentToReceivedInvoice(data, actor, company, { mailDocumentId: mail.id, receivedInvoiceId: payload.receivedInvoiceId, mailUpdatedAt: mail.updatedAt }) };
    }
    case "mail.unlink": {
      const mail = find(data.mailDocuments, operation.target.id, "郵便物", operation, (item) => companyFromParam(item.company) === company);
      return { targetId: mail.id, result: unlinkMailDocument(data, actor, company, { mailDocumentId: mail.id, mailUpdatedAt: mail.updatedAt }) };
    }
    case "payment.record": {
      const payload = paymentRecordSchema.parse(operation.payload);
      const invoice = (payload.kind === "issued" ? data.issuedInvoices : data.receivedInvoices).find((row) => row.id === payload.invoiceId && !row.deletedAt);
      if (!invoice) throw new AgentError(404, "請求書が見つかりません");
      expectUpdatedAt(invoice, operation, "請求書");
      return { targetId: invoice.id, result: recordPayment(data, actor, company, { ...payload, method: payload.method || "", memo: payload.memo || "", reason }, today) };
    }
    case "payment.cancel": {
      const payment = find(data.payments, operation.target.id, "支払記録", operation);
      return { targetId: payment.id, result: cancelPayment(data, actor, company, { paymentId: payment.id, updatedAt: payment.updatedAt, reason }) };
    }
    case "payment.adjust": {
      const payment = find(data.payments, operation.target.id, "支払記録", operation), payload = paymentAdjustSchema.parse(operation.payload);
      return { targetId: payment.id, result: adjustPayment(data, actor, company, { paymentId: payment.id, updatedAt: payment.updatedAt, amount: payload.amount ?? payment.amount, paymentDate: payload.paymentDate ?? payment.paymentDate, reason }, today) };
    }
    case "received.update": {
      const invoice = find(data.receivedInvoices, operation.target.id, "受領請求書", operation), payload = receivedUpdateSchema.parse(operation.payload);
      const form = new FormData();
      form.set("expectedUpdatedAt", invoice.updatedAt); form.set("projectId", payload.projectId ?? invoice.projectId); form.set("vendorId", payload.vendorId ?? invoice.vendorId);
      form.set("issueDate", payload.issueDate ?? invoice.issueDate); form.set("dueDate", payload.dueDate ?? invoice.dueDate); form.set("memo", payload.memo === null ? "" : payload.memo ?? invoice.memo ?? "");
      for (const key of ["subtotal", "taxTotal", "total", "grossAmount", "withholdingAmount"] as const) if (payload[key] !== undefined) form.set(key, String(payload[key]));
      const updated: ReceivedInvoice = applyReceivedInvoiceFields(data, actor, company, invoice.id, form);
      updated.updatedAt = stamp(updated.updatedAt);
      return { targetId: invoice.id, result: { id: invoice.id, total: updated.total, status: updated.status } };
    }
    case "vendor.create": {
      if (!can(actor, "manage:vendors")) throw new AgentError(403, "支払先を作成する権限がありません");
      const payload = vendorSchema.parse(operation.payload);
      if (data.vendors.some((row) => !row.deletedAt && partnerMatchesCompany(row, company) && normalize(row.companyName) === normalize(payload.companyName))) throw new AgentError(409, "同名の支払先がすでにあります");
      const timestamp = new Date().toISOString();
      const vendor: Vendor = { id: randomUUID(), company, ...payload, sortOrder: nextSortOrder(data.vendors, company), createdAt: timestamp, updatedAt: timestamp };
      data.vendors.unshift(vendor);
      return { targetId: vendor.id, result: { id: vendor.id, companyName: vendor.companyName } };
    }
    case "project.create": {
      if (!can(actor, "manage:projects")) throw new AgentError(403, "案件を作成する権限がありません");
      const payload = projectSchema.parse(operation.payload);
      const client = payload.clientId ? data.clients.find((row) => row.id === payload.clientId && !row.deletedAt && partnerMatchesCompany(row, company)) : data.clients.find((row) => !row.deletedAt && partnerMatchesCompany(row, company));
      if (!client) throw new AgentError(404, "クライアントが見つかりません");
      const managerId = payload.managerId || actor.id;
      if (!data.users.some((row) => row.id === managerId && !row.deletedAt)) throw new AgentError(404, "担当者が見つかりません");
      const timestamp = new Date().toISOString();
      const project: Project = { id: randomUUID(), name: payload.name, clientId: client.id, company, managerId, memberIds: [...new Set([managerId, ...(payload.memberIds || [])])], status: payload.status, stage: payload.stage || "制作资料",
        contractAmount: payload.contractAmount, billingCount: payload.billingCount || 1, startDate: payload.startDate, endDate: payload.endDate, memo: payload.memo, sortOrder: nextSortOrder(data.projects, company), createdAt: timestamp, updatedAt: timestamp };
      data.projects.unshift(project);
      return { targetId: project.id, result: { id: project.id, name: project.name } };
    }
  }
}

// Runs every operation against `data` in order. The caller decides whether `data` is a throwaway copy (dry run)
// or the live store inside the mutation lock. With stopOnFailure the first failure skips the rest.
export function runAgentOperations(data: AppData, auth: AgentAuth, request: AgentBatchRequest, options: { today?: string; stopOnFailure?: boolean } = {}): AgentBatchOutcome {
  const company = companyFromParam(request.company), today = options.today || bankToday();
  if (!canAccessCompany(auth.user, company)) throw new AgentError(403, "会社スコープ外です");
  const baseline = structuredClone(data);
  const results: AgentOperationResult[] = [];
  let failed = false;
  for (const [index, operation] of request.operations.entries()) {
    if (failed && options.stopOnFailure) { results.push({ index, op: operation.op, status: "skipped", error: "前の操作が失敗したため実行していません" }); continue; }
    const before = stampIndex(data);
    try {
      const { targetId, result } = applyOperation(data, auth, company, operation, today);
      results.push({ index, op: operation.op, status: "succeeded", targetId, result, changes: diffChanges(baseline, before, data) });
    } catch (error) {
      failed = true;
      const message = error instanceof z.ZodError ? `入力が不正です: ${error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ")}` : error instanceof Error ? error.message : "操作に失敗しました";
      results.push({ index, op: operation.op, status: "failed", targetId: operation.target.id, error: message });
    }
  }
  return { company, dryRun: false, atomicity: request.atomicity, results, succeeded: results.filter((row) => row.status === "succeeded").length, failed: results.filter((row) => row.status === "failed").length, skipped: results.filter((row) => row.status === "skipped").length };
}

// ---- Idempotency -------------------------------------------------------------------------------

export const AGENT_REQUEST_TTL_MS = 7 * 86400000;
export const agentRequestHash = (request: AgentBatchRequest) => createRequestHash(JSON.stringify({ ...request, idempotencyKey: undefined, dryRun: undefined }));
function createRequestHash(text: string) {
  // FNV-1a over the canonical body is enough to detect a different payload reusing a key; it is not a secret.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length}:${hash.toString(16)}`;
}
export function findAgentRequest(data: AppData, tokenId: string, idempotencyKey: string, now = new Date()) {
  return (data.agentRequests || []).find((row) => row.tokenId === tokenId && row.idempotencyKey === idempotencyKey && row.expiresAt > now.toISOString());
}
export function recordAgentRequest(data: AppData, tokenId: string, idempotencyKey: string, requestHash: string, result: unknown, now = new Date()) {
  const timestamp = now.toISOString();
  const entry: AgentRequest = { id: randomUUID(), tokenId, idempotencyKey, requestHash, result, createdAt: timestamp, expiresAt: new Date(now.getTime() + AGENT_REQUEST_TTL_MS).toISOString() };
  data.agentRequests = [entry, ...(data.agentRequests || []).filter((row) => row.expiresAt > timestamp)].slice(0, 1000);
  return entry;
}

export function describeAgentApi() {
  return {
    version: "v1",
    authentication: "Authorization: Bearer <token>（管理者が利用者管理で発行。権限はトークンの利用者ロール ∩ scopes、会社は JAPAN のみ）",
    resources: Object.entries(agentResources).map(([resource, scope]) => ({ resource, scope, path: `/api/agent/v1/${resource}` })),
    listParameters: ["company", "start", "end", "updatedSince", "account", "status", "side", "reviewed", "q", "kind", "limit(1-500)", "cursor"],
    operations: Object.entries(agentOperations).map(([op, scope]) => ({ op, scope })),
    batch: { path: "/api/agent/v1/batch", method: "POST", body: { idempotencyKey: "string?", dryRun: "boolean", atomicity: "batch | row", operations: [{ op: "...", target: { id: "..." }, expect: { updatedAt: "..." }, payload: {}, reason: "..." }] } },
    docs: "docs/agent-api-2026-10-31.md",
  };
}

export type { IssuedInvoice };
