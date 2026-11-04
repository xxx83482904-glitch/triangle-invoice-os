import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { navigationGroups } from "../src/lib/app-navigation";
import { bankToday } from "../src/lib/banking";
import { dashboardSummary } from "../src/lib/dashboard";
import { dashboardNextSteps } from "../src/lib/dashboard-next-steps";
import { applyExpenseMutation, canViewExpenseFile, expenseCategoryOptions, expenseClaimViews, expenseReceiptFallback, expenseSettlementSummary, type ExpenseMutation } from "../src/lib/expense-claim-edits";
import { expenseEditableBy, expenseMonth } from "../src/lib/expense-claims";
import { uploadedFileNameFromUrl } from "../src/lib/files";
import { assertJapanData } from "../src/lib/japan-storage";
import { can } from "../src/lib/rbac";
import type { AppData, User } from "../src/lib/types";
import { timestamp } from "./document-fixture";
import { expenseAccountant as acct, expenseAdmin as admin, expenseDesigner as des, expenseManager as pm, expensesFixture } from "./expense-claims-fixture";

const today = "2026-10-31";
const contents = { spentOn: "2026-09-15", amount: 1850, payee: "合成交通店", purpose: "合成案件の打ち合わせ交通費", categoryId: "travel", projectId: "japan", paidWith: "CASH" as const, memo: "合成メモ" };
const row = (data: AppData, id: string) => data.expenseClaims!.find((item) => item.id === id)!;
const target = (data: AppData, id: string) => ({ id, version: row(data, id).updatedAt });
const mutate = (data: AppData, input: ExpenseMutation, actor: Pick<User, "id" | "role"> = acct) => applyExpenseMutation(data, actor, "JAPAN", input);
const submit = (data: AppData, actor = des, extra: Partial<Extract<ExpenseMutation, { action: "submit" }>> = {}) => {
  const result = mutate(data, { action: "submit", ...contents, ...extra }, actor);
  assert.ok("id" in result); return result;
};
const sources = (data: AppData) => ({ received: data.receivedInvoices, mail: data.mailDocuments, payments: data.payments, issued: data.issuedInvoices, projects: data.projects, bank: data.bankTransactions });

test("all six submitting roles can create claims while billing and guest roles are denied", () => {
  for (const role of ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "DESIGNER", "MAIL_EDITOR"] as const) {
    const data = expensesFixture(), actor = { id: "des", role }, result = submit(data, actor), created = row(data, result.id);
    assert.equal(created.submittedById, actor.id); assert.equal(created.company, "JAPAN"); assert.equal(created.status, "SUBMITTED");
    assert.equal(created.amount, 1850); assert.equal(created.createdAt, created.updatedAt);
    assert.deepEqual(created.history, [{ action: "SUBMIT", at: result.updatedAt, byId: actor.id }]);
  }
  for (const role of ["BILLING_EDITOR", "GUEST"] as const) {
    const data = expensesFixture(), before = structuredClone(data);
    assert.throws(() => submit(data, { id: "des", role }), /^Error: 権限がありません$/); assert.deepEqual(data, before);
  }
});

test("submission rejects future or impossible dates, non-integer amounts and empty required text", () => {
  const future = new Date(`${bankToday()}T00:00:00Z`); future.setUTCDate(future.getUTCDate() + 1);
  for (const extra of [{ spentOn: future.toISOString().slice(0, 10) }, { spentOn: "2026-02-30" }, { spentOn: "2026/09/15" }, { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: NaN }, { payee: "  " }, { purpose: "" }]) {
    const data = expensesFixture(), before = structuredClone(data);
    assert.throws(() => submit(data, des, extra)); assert.deepEqual(data, before);
  }
});

test("field length limits and unknown or inactive project and category references are rejected", () => {
  for (const extra of [{ payee: "合".repeat(101) }, { purpose: "合".repeat(201) }, { memo: "合".repeat(1001) }, { projectId: "missing" }, { categoryId: "sales" }, { categoryId: "missing" }]) {
    const data = expensesFixture(), before = structuredClone(data);
    assert.throws(() => submit(data, des, extra)); assert.deepEqual(data, before);
  }
  for (const kind of ["deleted-project", "foreign-project", "disabled-category", "deleted-category", "foreign-category"] as const) {
    const data = expensesFixture();
    if (kind === "deleted-project") data.projects[0].deletedAt = timestamp;
    if (kind === "foreign-project") data.projects[0].company = "CHINA";
    if (kind === "disabled-category") data.accountingCategories[0].available = false;
    if (kind === "deleted-category") data.accountingCategories[0].deletedAt = timestamp;
    if (kind === "foreign-category") data.accountingCategories[0].company = "CHINA";
    assert.throws(() => submit(data), /案件|科目/);
  }
});

test("optional category and project support common expenses without creating other accounting rows", () => {
  const data = expensesFixture(), before = structuredClone(sources(data));
  const created = row(data, submit(data, des, { projectId: undefined, categoryId: undefined }).id);
  assert.equal(created.projectId, undefined); assert.equal(created.categoryId, undefined); assert.deepEqual(sources(data), before);
  assert.throws(() => applyExpenseMutation(data, admin, "CHINA", { action: "submit", ...contents }), /日本/);
});

test("even a manager cannot update or withdraw someone else's submitted claim", () => {
  for (const actor of [pm, acct, admin]) for (const action of ["update", "withdraw"] as const) {
    const data = expensesFixture(), before = structuredClone(data), ref = target(data, "submitted-des");
    const input: ExpenseMutation = action === "update" ? { action, ...ref, ...contents } : { action, ...ref };
    assert.throws(() => mutate(data, input, actor), /^Error: 権限がありません$/); assert.deepEqual(data, before);
  }
});

test("editing submitted claims preserves the original receipt and appends an EDIT history entry", () => {
  const data = expensesFixture(), before = structuredClone(row(data, "submitted-des")), ref = target(data, before.id);
  mutate(data, { action: "update", ...ref, ...contents, amount: 3000 }, des);
  const updated = row(data, before.id);
  assert.equal(updated.amount, 3000); assert.equal(updated.status, "SUBMITTED"); assert.equal(updated.history.at(-1)?.action, "EDIT");
  assert.equal(updated.fileUrl, before.fileUrl); assert.equal(updated.originalFileName, before.originalFileName); assert.equal(updated.createdAt, before.createdAt);
  assert.ok(updated.updatedAt > before.updatedAt);
});

test("a returned claim is resubmitted with its reason cleared and new receipt metadata", () => {
  const data = expensesFixture(), ref = target(data, "returned-des");
  const file = { fileUrl: "/uploads/received-invoices/synthetic-replacement.pdf", originalFileName: "合成差替え.pdf", mimeType: "application/pdf" as const, ocrText: "合成OCR" };
  mutate(data, { action: "update", ...ref, ...contents, file }, des);
  const updated = row(data, ref.id);
  assert.equal(updated.status, "SUBMITTED"); assert.equal(updated.reviewNote, undefined); assert.equal(updated.history.at(-1)?.action, "RESUBMIT");
  for (const key of ["fileUrl", "originalFileName", "mimeType", "ocrText"] as const) assert.equal(updated[key], file[key]);
  assert.equal(updated.history[1].note, "合成用途を詳しく記載してください");
});

test("only one's own submitted or returned claim is editable and withdrawable", () => {
  const data = expensesFixture();
  assert.equal(expenseEditableBy(des, row(data, "submitted-des")), true); assert.equal(expenseEditableBy(des, row(data, "returned-des")), true);
  assert.equal(expenseEditableBy(des, row(data, "approved-des")), false); assert.equal(expenseEditableBy(pm, row(data, "submitted-des")), false);
  for (const id of ["submitted-des", "returned-des"]) {
    mutate(data, { action: "withdraw", ...target(data, id) }, des);
    assert.equal(row(data, id).status, "WITHDRAWN"); assert.equal(row(data, id).history.at(-1)?.action, "WITHDRAW");
    assert.throws(() => mutate(data, { action: "update", ...target(data, id), ...contents }, des), /現在の状態/);
  }
});

test("approval, payment and cancellation track actors and clear only settlement metadata", () => {
  const data = expensesFixture(), before = structuredClone(sources(data)), id = "submitted-des";
  mutate(data, { action: "approve", ...target(data, id) });
  assert.equal(row(data, id).status, "APPROVED"); assert.equal(row(data, id).reviewedById, "acct");
  assert.equal(row(data, id).reviewedAt, row(data, id).updatedAt);
  const reviewedAt = row(data, id).reviewedAt;
  mutate(data, { action: "pay", items: [target(data, id)], paidAt: today, memo: "合成振込メモ" });
  assert.equal(row(data, id).status, "PAID"); assert.equal(row(data, id).paidAt, today); assert.equal(row(data, id).paidById, "acct"); assert.equal(row(data, id).paymentMemo, "合成振込メモ");
  mutate(data, { action: "unpay", ...target(data, id) }, admin);
  assert.equal(row(data, id).status, "APPROVED"); assert.equal(row(data, id).reviewedAt, reviewedAt);
  for (const key of ["paidAt", "paidById", "paymentMemo"] as const) assert.equal(Object.hasOwn(row(data, id), key), false);
  assert.deepEqual(row(data, id).history.map((entry) => entry.action), ["SUBMIT", "APPROVE", "PAY", "UNPAY"]);
  assert.equal(row(data, id).history.at(-1)?.byId, "admin"); assert.deepEqual(sources(data), before);
});

test("submitted and approved claims can be returned only with a nonempty bounded reason", () => {
  for (const id of ["submitted-des", "approved-des"]) {
    const data = expensesFixture(), before = structuredClone(data);
    for (const note of ["", "  ", "合".repeat(501)]) assert.throws(() => mutate(data, { action: "return", ...target(data, id), note }));
    assert.deepEqual(data, before);
    mutate(data, { action: "return", ...target(data, id), note: " 合成確認依頼 " });
    assert.equal(row(data, id).status, "RETURNED"); assert.equal(row(data, id).reviewNote, "合成確認依頼");
    assert.equal(row(data, id).history.at(-1)?.note, "合成確認依頼"); assert.equal(row(data, id).reviewedById, "acct");
  }
});

test("non-accounting roles cannot approve, return, pay or cancel payments", () => {
  for (const actor of [des, pm, { id: "des", role: "MAIL_EDITOR" as const }]) {
    const data = expensesFixture(), before = structuredClone(data);
    const attempts: ExpenseMutation[] = [
      { action: "approve", ...target(data, "submitted-des") }, { action: "return", ...target(data, "submitted-des"), note: "合成理由" },
      { action: "pay", items: [target(data, "approved-des")], paidAt: today }, { action: "unpay", ...target(data, "paid-pm") },
    ];
    for (const input of attempts) assert.throws(() => mutate(data, input, actor), /^Error: 権限がありません$/);
    assert.deepEqual(data, before);
  }
});

test("invalid state transitions fail without changing any claim or history", () => {
  const cases = [
    ["approve", "paid-pm"], ["approve", "approved-des"], ["approve", "returned-des"], ["return", "paid-pm"], ["return", "withdrawn-pm"],
    ["unpay", "approved-des"], ["unpay", "submitted-des"], ["withdraw", "approved-des"], ["update", "approved-des"],
  ] as const;
  for (const [action, id] of cases) {
    const data = expensesFixture(), before = structuredClone(data), ref = target(data, id);
    const input: ExpenseMutation = action === "return" ? { action, ...ref, note: "合成理由" } : action === "update" ? { action, ...ref, ...contents } : { action, ...ref };
    assert.throws(() => mutate(data, input, action === "withdraw" || action === "update" ? des : acct), /現在の状態/); assert.deepEqual(data, before);
  }
});

test("stale versions are rejected for every existing-claim mutation", () => {
  const data = expensesFixture(), before = structuredClone(data);
  const attempts: ExpenseMutation[] = [
    { action: "update", id: "submitted-des", version: "stale", ...contents }, { action: "withdraw", id: "submitted-des", version: "stale" },
    { action: "approve", id: "submitted-des", version: "stale" }, { action: "return", id: "submitted-des", version: "stale", note: "合成理由" },
    { action: "pay", items: [{ id: "approved-des", version: "stale" }], paidAt: today }, { action: "unpay", id: "paid-pm", version: "stale" },
  ];
  for (const input of attempts) assert.throws(() => mutate(data, input, input.action === "update" || input.action === "withdraw" ? des : acct), /^Error: 経費の申請が更新されています。再読込してください$/);
  assert.deepEqual(data, before);
});

test("one stale or wrong-state item makes an entire settlement batch fail atomically", () => {
  for (const failure of ["stale", "state", "missing", "deleted", "foreign"]) {
    const data = expensesFixture(), good = target(data, "approved-des");
    const other = failure === "state" ? target(data, "submitted-des") : target(data, "approved-pm");
    if (failure === "stale") other.version = "stale";
    if (failure === "missing") other.id = "missing";
    if (failure === "deleted") row(data, other.id).deletedAt = timestamp;
    if (failure === "foreign") row(data, other.id).company = "CHINA";
    const before = structuredClone(data);
    assert.throws(() => mutate(data, { action: "pay", items: [good, other], paidAt: today })); assert.deepEqual(data, before);
  }
});

test("settlement rejects empty or duplicate batches and invalid dates or oversized memos", () => {
  const data = expensesFixture(), before = structuredClone(data), item = target(data, "approved-des");
  for (const input of [
    { action: "pay", items: [], paidAt: today }, { action: "pay", items: [item, item], paidAt: today },
    { action: "pay", items: [item], paidAt: "2026-02-30" }, { action: "pay", items: [item], paidAt: "" },
    { action: "pay", items: [item], paidAt: today, memo: "合".repeat(1001) },
  ] satisfies ExpenseMutation[]) assert.throws(() => mutate(data, input));
  assert.deepEqual(data, before);
});

test("batch settlement advances every timestamp even when previous versions are ahead of the clock", () => {
  const data = expensesFixture(); row(data, "approved-des").updatedAt = "2099-01-01T00:00:00.000Z";
  const result = mutate(data, { action: "pay", items: [target(data, "approved-pm"), target(data, "approved-des")], paidAt: today });
  assert.ok("ids" in result); assert.deepEqual(result.ids, ["approved-pm", "approved-des"]); assert.equal(result.updatedAt, "2099-01-01T00:00:00.001Z");
  for (const id of result.ids) { assert.equal(row(data, id).updatedAt, result.updatedAt); assert.equal(row(data, id).status, "PAID"); }
});

test("deleted or foreign claims cannot be edited or reviewed and Chinese storage is rejected", () => {
  for (const patch of [{ deletedAt: timestamp }, { company: "CHINA" as const }]) {
    const data = expensesFixture(); Object.assign(row(data, "submitted-des"), patch); const before = structuredClone(data);
    assert.throws(() => mutate(data, { action: "update", ...target(data, "submitted-des"), ...contents }, des), /見つかりません/);
    assert.throws(() => mutate(data, { action: "approve", ...target(data, "submitted-des") }), /見つかりません/); assert.deepEqual(data, before);
  }
  const data = expensesFixture(); assert.doesNotThrow(() => assertJapanData(data)); row(data, "submitted-des").company = "CHINA";
  assert.throws(() => assertJapanData(data), /中国/);
});

test("views show designers only their claims and accounting everyone, without mutation", () => {
  const data = expensesFixture(), before = structuredClone(data);
  const own = expenseClaimViews(data, des, "JAPAN"), all = expenseClaimViews(data, acct, "JAPAN");
  assert.equal(own.length, 3); assert.ok(own.every((item) => item.submittedById === des.id)); assert.equal(all.length, 6);
  assert.deepEqual(own.map((item) => item.id), ["approved-des", "submitted-des", "returned-des"]);
  assert.equal(own[0].submitterName, "合成補助"); assert.equal(own[0].reviewerName, "合成経理"); assert.equal(own[0].projectName, "合成案件1"); assert.equal(own[0].categoryName, "旅費交通費");
  assert.equal(all.find((item) => item.id === "paid-pm")?.paidByName, "合成経理"); assert.equal(own[0].editable, false); assert.equal(own[1].editable, true);
  assert.deepEqual(data, before);
});

test("view ordering, deleted/company filtering and missing-user fallbacks are deterministic", () => {
  const data = expensesFixture(), source = row(data, "submitted-des");
  data.expenseClaims!.push({ ...structuredClone(source), id: "newer", createdAt: "2026-10-12T00:00:00.000Z", submittedById: "missing-user" },
    { ...structuredClone(source), id: "deleted", deletedAt: timestamp }, { ...structuredClone(source), id: "foreign", company: "CHINA" });
  const views = expenseClaimViews(data, acct, "JAPAN");
  assert.equal(views.length, 7); assert.ok(views.findIndex((item) => item.id === "newer") < views.findIndex((item) => item.id === source.id));
  assert.equal(views.find((item) => item.id === "newer")?.submitterName, "missing-user");
  assert.throws(() => expenseClaimViews(data, admin, "CHINA"), /日本/);
  assert.throws(() => expenseClaimViews(data, { id: "des", role: "BILLING_EDITOR" }, "JAPAN"), /権限/);
});

test("settlement summary separates people, outstanding approvals and the month of payment", () => {
  const data = expensesFixture(), views = expenseClaimViews(data, acct, "JAPAN"), summary = expenseSettlementSummary(views, today);
  assert.deepEqual(summary.totals, { submittedCount: 1, submittedAmount: 1200, approvedCount: 2, approvedAmount: 8100, paidThisMonth: 5600 });
  assert.deepEqual(summary.people.find((person) => person.userId === "des"), { userId: "des", name: "合成補助", approvedCount: 1, approvedAmount: 3600, submittedCount: 1, submittedAmount: 1200 });
  assert.deepEqual(summary.people.find((person) => person.userId === "pm"), { userId: "pm", name: "合成担当", approvedCount: 1, approvedAmount: 4500, submittedCount: 0, submittedAmount: 0 });
  assert.equal(expenseSettlementSummary(views, "2026-11-01").totals.paidThisMonth, 0);
  row(data, "paid-pm").spentOn = "2026-09-01";
  assert.equal(expenseSettlementSummary(expenseClaimViews(data, acct, "JAPAN"), today).totals.paidThisMonth, 5600);
  assert.equal(expenseSettlementSummary(expenseClaimViews(data, des, "JAPAN"), today).totals.approvedAmount, 3600);
});

test("category options include only active expense categories and label children with their parent", () => {
  const data = expensesFixture(), base = data.accountingCategories[0];
  data.accountingCategories.push({ ...base, id: "child", name: "電車", parentId: "travel" }, { ...base, id: "disabled", available: false },
    { ...base, id: "deleted", deletedAt: timestamp }, { ...base, id: "foreign", company: "CHINA" });
  const options = expenseCategoryOptions(data, "JAPAN");
  assert.deepEqual(new Set(options.map((item) => item.value)), new Set(["travel", "supplies", "child"]));
  assert.equal(options.find((item) => item.value === "child")?.label, "旅費交通費 / 電車");
  assert.deepEqual(options.map((item) => item.label), options.map((item) => item.label).sort((a, b) => a.localeCompare(b, "ja")));
  assert.equal(expenseMonth(row(data, "submitted-des")), "2026-10"); assert.equal(expenseMonth(row(data, "returned-des")), "2026-09");
});

test("expense navigation and permissions stay limited to the approved roles", () => {
  for (const role of ["ADMIN", "DESIGNER", "ACCOUNTING", "PROJECT_MANAGER", "CHIEF_DESIGNER", "MAIL_EDITOR"] as const) assert.ok(navigationGroups(role).some((group) => group.items.some((item) => item.href === "/expenses")));
  for (const role of ["BILLING_EDITOR", "GUEST"] as const) assert.equal(navigationGroups(role).some((group) => group.items.some((item) => item.href === "/expenses")), false);
  assert.equal(can(des, "manage:expenses"), false); assert.equal(can(acct, "manage:expenses"), true);
});

test("receipt access allows the owner and accounting but denies another designer and unrelated filenames", () => {
  const data = expensesFixture(), name = uploadedFileNameFromUrl(row(data, "submitted-des").fileUrl), before = structuredClone(data);
  assert.equal(canViewExpenseFile(data, des, name), true); assert.equal(canViewExpenseFile(data, { id: "other", role: "DESIGNER" }, name), false);
  assert.equal(canViewExpenseFile(data, acct, name), true); assert.equal(canViewExpenseFile(data, admin, name), true);
  assert.equal(canViewExpenseFile(data, { id: "des", role: "BILLING_EDITOR" }, name), false); assert.equal(canViewExpenseFile(data, { id: "des", role: "GUEST" }, name), false);
  assert.equal(canViewExpenseFile(data, acct, "unrelated.pdf"), false); assert.equal(canViewExpenseFile(data, acct, ""), false); assert.deepEqual(data, before);
});

test("receipt access excludes deleted and foreign claims and handles encoded local and Vercel URLs", () => {
  for (const prefix of ["/uploads/received-invoices/", "/api/files/"]) {
    const data = expensesFixture(), receipt = row(data, "submitted-des"), name = "合成 領収書.pdf";
    receipt.fileUrl = `${prefix}${encodeURIComponent(name)}`;
    assert.equal(canViewExpenseFile(data, des, name), true);
    receipt.deletedAt = timestamp; assert.equal(canViewExpenseFile(data, acct, name), false);
    delete receipt.deletedAt; receipt.company = "CHINA"; assert.equal(canViewExpenseFile(data, acct, name), false);
  }
});

test("OCR fallback reads slash, hyphen, Japanese and Reiwa dates and prefers labeled totals", () => {
  for (const date of ["2026/9/15", "2026-09-15", "2026年9月15日", "令和8年9月15日", "２０２６年９月１５日"]) {
    assert.deepEqual(expenseReceiptFallback(`合成店\n${date}\n合計 ¥1,850\nお預り ¥10,000`), { spentOn: "2026-09-15", amount: 1850 });
  }
  assert.equal(expenseReceiptFallback("令和元年5月1日\n総額 600円").spentOn, "2019-05-01");
  assert.equal(expenseReceiptFallback("2026/02/30\n2026-09-01").spentOn, "2026-09-01");
  for (const label of ["お買上", "ご請求", "総額"]) assert.equal(expenseReceiptFallback(`${label}\n2,400円`).amount, 2400);
  assert.equal(expenseReceiptFallback("合成店\n¥250\n1,200円\n900円").amount, 1200);
  assert.deepEqual(expenseReceiptFallback("合成店のみ"), { spentOn: "", amount: undefined });
});

test("dashboard adds scoped submitted claims immediately after document review for accounting only", () => {
  const data = expensesFixture();
  data.expenseClaims!.push({ ...structuredClone(row(data, "submitted-des")), id: "deleted", deletedAt: timestamp }, { ...structuredClone(row(data, "submitted-des")), id: "foreign", company: "CHINA" });
  const summary = dashboardSummary(data, admin, "JAPAN", today), steps = dashboardNextSteps(data, admin, summary);
  const step = steps.find((item) => item.id === "expenses-submitted")!;
  assert.equal(step.count, 1); assert.equal(step.amount, 1200); assert.deepEqual(step.target, { href: "/expenses?company=JAPAN&status=SUBMITTED" });
  assert.equal(steps.indexOf(step), steps.findIndex((item) => item.id === "documents") + 1);
  assert.equal(dashboardNextSteps(data, des, summary).some((item) => item.id === step.id), false);
  row(data, "submitted-des").status = "APPROVED"; assert.equal(dashboardNextSteps(data, admin, summary).some((item) => item.id === step.id), false);
});

test("first expense submission persists a reversible audit patch without changing source documents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-expenses-store-test-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const data = expensesFixture(); delete data.expenseClaims; assertJapanData(data);
  await writeFile(path.join(dir, "app-data.json"), JSON.stringify(data));
  const { mutateData, readData, restoreUndoState } = await import("../src/lib/store");
  const before = await readData(); assert.equal(before.expenseClaims, undefined);
  const id = globalThis.crypto.randomUUID();
  await mutateData(des.id, "SUBMIT_EXPENSE_CLAIM", "ExpenseClaim", id, (draft) => applyExpenseMutation(draft, des, "JAPAN", { action: "submit", ...contents }, id));
  const after = JSON.parse(await readFile(path.join(dir, "app-data.json"), "utf8")) as AppData;
  assert.equal(after.auditLogs.length - before.auditLogs.length, 1); assert.equal(after.auditLogs[0].action, "SUBMIT_EXPENSE_CLAIM"); assert.equal(after.auditLogs[0].targetId, id);
  const patch = after.auditLogs[0].beforeStateJson as { changes: Array<{ collection: string; before: unknown }> };
  assert.equal(patch.changes.length, 1); assert.equal(patch.changes[0].collection, "expenseClaims"); assert.equal(patch.changes[0].before, null);
  const restored = structuredClone(after); restoreUndoState(restored, after.auditLogs[0].beforeStateJson);
  assert.deepEqual(restored.expenseClaims, []); assert.deepEqual(after.receivedInvoices, before.receivedInvoices); assert.deepEqual(after.mailDocuments, before.mailDocuments);
  assert.deepEqual(sources(restored), sources(before));
  const legacy = structuredClone(before); delete legacy.expenseClaims;
  const legacyRestored = structuredClone(after); restoreUndoState(legacyRestored, legacy); assert.deepEqual(legacyRestored.expenseClaims, after.expenseClaims);
  const bytes = await readFile(path.join(dir, "app-data.json"), "utf8");
  await assert.rejects(() => mutateData(des.id, "UPDATE_EXPENSE_CLAIM", "ExpenseClaim", id, (draft) => applyExpenseMutation(draft, des, "JAPAN", { action: "update", id, version: "stale", ...contents })), /更新/);
  assert.equal(await readFile(path.join(dir, "app-data.json"), "utf8"), bytes);
});
