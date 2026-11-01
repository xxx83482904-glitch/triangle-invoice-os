import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { projectAttention } from "../src/lib/project-attention";
import { projectAttentionPriority, projectContractSummary, projectContractValue, projectCreationValues, projectStageLabel, projectStageOptions, projectUninvoiced } from "../src/lib/project-display";
import { projectMoney } from "../src/lib/store";
import { resolveIssuedImportProject } from "../src/lib/issued-import-project";
import { billingProjectGroups } from "../src/lib/billing-project-cleanup";
import { agentBatchSchema, listAgentResource, runAgentOperations } from "../src/lib/agent-api";
import { generateAgentTokenSecret, issueAgentToken, verifyAgentToken } from "../src/lib/agent-tokens";
import type { AppData, IssuedInvoice, Payment, ReceivedInvoice } from "../src/lib/types";

const today = "2026-11-01";
function setup() {
  const data = fixture();
  data.issuedInvoices = []; data.receivedInvoices = []; data.payments = []; data.attachments = [];
  const project = data.projects[0];
  project.contractFileUrl = undefined; project.status = "WAITING";
  return { data, project };
}
const issued = (patch: Partial<IssuedInvoice> = {}): IssuedInvoice => ({ ...fixture().issuedInvoices[0], status: "ISSUED", needsReview: false, dueDate: "2026-10-31", ...patch });
const received = (patch: Partial<ReceivedInvoice> = {}): ReceivedInvoice => ({ ...fixture().receivedInvoices[0], status: "SCHEDULED", dueDate: "2026-10-31", ...patch });
const payment = (patch: Partial<Payment> = {}): Payment => ({ id: "pay", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 8000, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp, ...patch });
const counts = (data: AppData) => Object.fromEntries(projectAttention(data, data.projects[0], today).map((row) => [row.kind, row.count]));

test("Japan project attention does not count missing contracts, unbilled amounts or waiting status", () => {
  const { data, project } = setup();
  project.stage = "制作资料";
  const before = structuredClone(data);
  assert.deepEqual(projectAttention(data, project, today), []);
  assert.deepEqual(data, before);
});

test("project attention uses overdue and inclusive seven-day windows for unpaid bills", () => {
  const { data } = setup();
  for (const [i, dueDate] of ["2026-10-31", today, "2026-11-08", "2026-11-09", "", "invalid"].entries()) {
    data.issuedInvoices.push(issued({ id: `i${i}`, dueDate }));
    data.receivedInvoices.push(received({ id: `r${i}`, dueDate }));
  }
  assert.deepEqual(counts(data), { expenseOverdue: 1, incomeOverdue: 1, expenseSoon: 2, incomeSoon: 2 });
  assert.deepEqual(projectAttention(data, data.projects[0], today).map((r) => r.priority), [30, 30, 20, 20]);
});

test("project attention uses active payments including partial payments and ignores canceled payments", () => {
  const { data } = setup();
  data.issuedInvoices = [issued()];
  data.receivedInvoices = [received()];
  data.payments = [payment({ amount: 4000 }), payment({ id: "in", type: "INCOME", receivedInvoiceId: undefined, issuedInvoiceId: "issued-1", amount: 6000 })];
  assert.deepEqual(counts(data), { expenseOverdue: 1, incomeOverdue: 1 });
  data.payments[0].amount = 8000; data.payments[1].amount = 12000;
  assert.deepEqual(counts(data), {});
  data.payments[0].deletedAt = timestamp; data.payments[1].deletedAt = timestamp;
  assert.deepEqual(counts(data), { expenseOverdue: 1, incomeOverdue: 1 });
  data.payments[1].deletedAt = undefined; data.payments[1].amount = Number.NaN;
  assert.deepEqual(counts(data), { expenseOverdue: 1, incomeOverdue: 1 });
});

test("PAID projects with insufficient payment records need document review rather than a payment reminder", () => {
  const { data } = setup();
  data.issuedInvoices = [issued({ status: "PAID", needsReview: true })];
  data.receivedInvoices = [received({ status: "PAID" })];
  assert.deepEqual(counts(data), { documentReview: 2 });
  data.payments = [payment(), payment({ id: "income", type: "INCOME", receivedInvoiceId: undefined, issuedInvoiceId: "issued-1", amount: 12000 })];
  assert.deepEqual(counts(data), { documentReview: 1 }, "explicit OCR review is still required after payment");
});

test("project attention excludes archives, rejections, deleted bills, canceled sales and other projects", () => {
  const { data } = setup();
  data.receivedInvoices = [received({ status: "ARCHIVED" }), received({ id: "reject", status: "REJECTED" }), received({ id: "delete", deletedAt: timestamp }), received({ id: "other", projectId: "other" })];
  data.issuedInvoices = [issued({ status: "CANCELED", needsReview: true }), issued({ id: "delete", deletedAt: timestamp }), issued({ id: "other", projectId: "other" })];
  assert.deepEqual(counts(data), {});
});

test("project attention counts only the payable document of a debt group", () => {
  const { data } = setup();
  data.receivedInvoices = [received({ id: "old", issueDate: "2026-09-01", debtGroupId: "g", debtRole: "INVOICE", status: "REVIEWING" }), received({ id: "latest", issueDate: "2026-10-01", debtGroupId: "g", debtRole: "REISSUE" }), received({ id: "evidence", issueDate: "2026-10-02", debtGroupId: "g", debtRole: "RECEIPT", status: "REVIEWING" })];
  assert.deepEqual(counts(data), { expenseOverdue: 1 });
});

test("project attention separates document review from debts and ignores zero-value deadlines", () => {
  const { data } = setup();
  data.issuedInvoices = [issued({ id: "draft", status: "DRAFT", needsReview: true }), issued({ id: "review", needsReview: true, total: 0 })];
  data.receivedInvoices = (["OCR_PENDING", "REVIEWING", "APPROVAL_PENDING"] as const).map((status) => received({ id: status, status, total: 0 }));
  const before = structuredClone(data);
  assert.deepEqual(counts(data), { documentReview: 5 });
  assert.equal(projectAttention(data, data.projects[0], today)[0].financial, false);
  assert.deepEqual(data, before);
});

test("project completion does not conceal real unpaid deadlines; deletion does", () => {
  const { data, project } = setup();
  data.receivedInvoices = [received()];
  for (const status of ["COMPLETED", "ARCHIVED"] as const) {
    project.status = status;
    assert.deepEqual(counts(data), { expenseOverdue: 1 });
  }
  project.deletedAt = timestamp;
  assert.deepEqual(counts(data), {});
});

test("project attention ranks actual overdue items above multiple upcoming items and respects financial visibility", () => {
  const { data } = setup();
  data.receivedInvoices = [received({ dueDate: "2026-11-03", status: "REVIEWING" })];
  data.issuedInvoices = [issued({ dueDate: "2026-11-03" })];
  const upcoming = projectAttention(data, data.projects[0], today);
  assert.equal(projectAttentionPriority(upcoming, true), 20);
  assert.equal(projectAttentionPriority(upcoming, false), 10);
  data.receivedInvoices[0].dueDate = "2026-10-31";
  data.receivedInvoices[0].status = "SCHEDULED";
  const overdue = projectAttention(data, data.projects[0], today);
  assert.equal(projectAttentionPriority(overdue, true), 30);
  assert.equal(projectAttentionPriority(overdue, false), 0);
});

test("Japan project creation leaves absent amount and stage unset, preserving explicit zero and stage", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(projectCreationValues("JAPAN", {}))), {});
  assert.deepEqual(projectCreationValues("JAPAN", { contractAmount: 0, stage: "設計" }), { contractAmount: 0, stage: "設計" });
  assert.deepEqual(projectCreationValues("JAPAN", { contractAmount: 12345, stage: " " }), { contractAmount: 12345, stage: undefined });
});

test("China project creation and labels keep existing defaults and explicit values", () => {
  assert.deepEqual(projectCreationValues("CHINA", {}), { contractAmount: 0, stage: "制作资料" });
  assert.deepEqual(projectCreationValues("CHINA", { contractAmount: 123, stage: "施工" }), { contractAmount: 123, stage: "施工" });
  assert.equal(projectStageLabel("CHINA", "制作资料"), "制作资料");
  assert.equal(projectStageLabel("CHINA", undefined), "");
  assert.equal(projectContractValue({ company: "CHINA" }), 0);
});

test("Japan legacy stage is a presentation alias, retaining saved values and China option labels", () => {
  const options = [{ value: "制作资料", label: "制作资料" }, { value: "設計", label: "設計" }];
  const before = structuredClone(options);
  assert.equal(projectStageLabel("JAPAN", "制作资料"), "段階未設定");
  assert.equal(projectStageLabel("JAPAN", undefined), "段階未設定");
  assert.equal(projectStageLabel("JAPAN", "設計"), "設計");
  assert.deepEqual(projectStageOptions("JAPAN", options)[0], { value: "制作资料", label: "段階未設定" });
  assert.deepEqual(projectStageOptions("JAPAN", options, true), [options[1]]);
  assert.deepEqual(projectStageOptions("CHINA", options), before);
  assert.deepEqual(projectStageOptions("CHINA", options, true), before);
  assert.deepEqual(options, before);
});

test("unset contract money is null, distinct from existing zero, in display and project aggregates", () => {
  const { data, project } = setup();
  project.contractAmount = undefined;
  assert.equal(projectMoney(data, project.id).contractAmount, null);
  assert.equal(projectUninvoiced(null, 500), null);
  assert.equal(projectUninvoiced(0, 500), 0);
  assert.equal(projectUninvoiced(1000, 500), 500);
  assert.deepEqual(projectContractSummary([{ contractAmount: null, invoicedAmount: 500 }, { contractAmount: 0, invoicedAmount: 0 }, { contractAmount: 1000, invoicedAmount: 500 }]), { uninvoicedAmount: 500, unsetContractCount: 1 });
  project.contractAmount = 0;
  assert.equal(projectMoney(data, project.id).contractAmount, 0);
  project.contractAmount = 123;
  assert.equal(projectMoney(data, project.id).contractAmount, 123);
});

function apiSetup() {
  const { data } = setup();
  data.users.push({ id: "admin", role: "ADMIN", accessStatus: "ACTIVE", name: "合成管理者", email: "admin@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp });
  const secret = generateAgentTokenSecret();
  issueAgentToken(data, admin, { userId: "admin", name: "synthetic", scopes: ["bank:read", "partners:write"], expiresInDays: 30, hash: secret.hash, prefix: secret.prefix });
  const result = verifyAgentToken(data, `Bearer ${secret.plain}`);
  if (!result.ok) throw new Error(result.error);
  return { data, auth: result.auth };
}

test("agent project creation omits Japan defaults and reads unset contracts as null", () => {
  const { data, auth } = apiSetup();
  const existing = structuredClone(data.projects);
  const result = runAgentOperations(data, auth, agentBatchSchema.parse({ company: "JAPAN", operations: [{ op: "project.create", payload: { name: "合成未設定案件", clientId: "client" } }] }), { today });
  assert.equal(result.succeeded, 1);
  const added = data.projects.find((p) => p.name === "合成未設定案件")!;
  assert.ok(added);
  assert.equal(added.contractAmount, undefined); assert.equal(added.stage, undefined);
  const before = structuredClone(data);
  const read = listAgentResource(data, auth, "projects", {});
  assert.equal((read.items.find((item) => (item as { id: string }).id === added.id) as { contractAmount: number | null }).contractAmount, null);
  assert.deepEqual(data, before);
  assert.deepEqual(data.projects.filter((p) => existing.some((old) => old.id === p.id)), existing);
});

test("agent project reads preserve zero/numbers and dry runs never add projects", () => {
  const { data, auth } = apiSetup();
  data.projects[0].contractAmount = 0;
  const rows = listAgentResource(data, auth, "projects", {}).items as Array<{ id: string; contractAmount: number | null }>;
  assert.equal(rows.find((p) => p.id === "japan")!.contractAmount, 0);
  assert.equal(rows.find((p) => p.id === "other")!.contractAmount, 100000);
  const before = structuredClone(data);
  const result = runAgentOperations(structuredClone(data), auth, agentBatchSchema.parse({ company: "JAPAN", dryRun: true, operations: [{ op: "project.create", payload: { name: "合成試行", contractAmount: 0 } }] }), { today });
  assert.equal(result.succeeded, 1);
  assert.deepEqual(data, before);
});

test("OCR-created Japan projects do not imply a zero-value contract", () => {
  const { data } = setup();
  const result = resolveIssuedImportProject(data, admin, "JAPAN", "", { projectName: "合成新案件", clientName: "Test customer", text: "", fileName: "synthetic.pdf" });
  assert.equal(result.projectCreated, true);
  assert.equal(result.project.contractAmount, undefined);
  assert.equal(result.project.stage, undefined);
});

test("unset OCR placeholder contracts remain cleanup candidates without modifying data", () => {
  const { data } = setup();
  for (const [i, label] of ["初回", "三回目"].entries()) {
    const id = `placeholder-${i}`;
    data.projects.push({ ...data.projects[0], id, name: `合成店舗 設計${label}請求書`, status: "PLANNING", contractAmount: undefined, billingCount: 1, memo: "発行請求書OCRから自動作成。案件名・請求先・契約情報要確認。" });
    data.issuedInvoices.push(issued({ id: `placeholder-invoice-${i}`, projectId: id }));
  }
  const before = structuredClone(data);
  assert.equal(billingProjectGroups(data, admin, "JAPAN").length, 1);
  assert.deepEqual(data, before);
  data.projects.at(-1)!.contractAmount = 1;
  assert.equal(billingProjectGroups(data, admin, "JAPAN").length, 0);
});
