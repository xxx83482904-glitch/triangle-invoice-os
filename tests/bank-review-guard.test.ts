import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankDisplayRows, mergeBankMasters, mergeBankTransactions, saveBankEdits, sourceKey } from "../src/lib/banking";
import { GUESS_ACKNOWLEDGED_PREFIX, acknowledgedGuessReason, bankClassificationLabel, isGuessClassification, stripGuessAcknowledgement } from "../src/lib/bank-classification";
import { bankSalesSuggestion } from "../src/lib/bank-sales-suggestion";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { bankSaveChanges, patchBankDraft } from "../src/lib/bank-workspace-drafts";
import type { AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
const category = (id: string) => sourceKey("JAPAN", office, "category", id);
const find = (data: AppData, sourceId: string) => data.bankTransactions.find((row) => row.sourceId === sourceId)!;
function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
    { id: "sales", name: "売上高", group: "INCOME", available: true },
    { id: "other-income", name: "雑収入", group: "INCOME", available: true },
  ]);
  mergeBankTransactions(data, "JAPAN", office, [
    { id: "unknown", connected_account_id: "bank", date: "2026-10-05", value: 3300, side: "EXPENSE", content: "用途不明 テスト", journalizing_status: "none" },
    { id: "fee", connected_account_id: "bank", date: "2026-10-06", value: 440, side: "EXPENSE", content: "振込手数料", journalizing_status: "none" },
    { id: "income", connected_account_id: "bank", date: today, value: 12000, side: "INCOME", content: "Test customer INV-001", journalizing_status: "none" },
  ], { start: "2026-10-01", end: "2026-10-31" });
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; });
  return data;
}
function reconcile(data: AppData, sourceId = "income", invoiceId = "issued-1") {
  const bank = find(data, sourceId), invoice = data.issuedInvoices.find((row) => row.id === invoiceId)!;
  return confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "issued", invoiceId, invoiceUpdatedAt: invoice.updatedAt, amount: Math.min(bank.amount, invoice.total), mode: "new", acknowledged: true }, today);
}

test("a guessed category cannot become reviewed without acknowledgement, and the whole batch stays untouched", () => {
  const data = setup();
  const candidate = bankDisplayRows(data, [find(data, "unknown")])[0];
  assert.equal(bankClassificationLabel(candidate).kind, "GUESS");
  assert.ok(isGuessClassification(candidate));
  const fee = find(data, "fee");
  const manualFee = { id: fee.id, updatedAt: fee.updatedAt, categoryId: category("fees"), treatment: "NORMAL" as const, reviewed: true, memo: "" };
  const before = JSON.stringify(data);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [manualFee, { ...candidate, reviewed: true }]), /推測のままの分類/);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(saveBankEdits(data, admin, "JAPAN", [manualFee, { ...candidate, reviewed: true, acknowledgeGuess: true }]), { count: 2, acknowledgedGuesses: 1 });
  const saved = find(data, "unknown");
  assert.equal(saved.reviewed, true); assert.equal(saved.classificationConfidence, "GUESS"); assert.equal(saved.classificationSource, "MANUAL");
  assert.equal(bankClassificationLabel(saved).kind, "CONFIRMED");
  assert.ok(saved.classificationReason!.startsWith(`${GUESS_ACKNOWLEDGED_PREFIX}: `));
  assert.ok(saved.classificationReason!.includes(candidate.classificationReason!));
  // The fee row was inferred from its description at import; a manual confirmation keeps that reason.
  assert.equal(fee.reviewed, true); assert.equal(fee.classificationReason, "摘要: 振込手数料");
  // Back to unreviewed: the acknowledgement note is removed and the row is a plain guess again.
  saveBankEdits(data, admin, "JAPAN", [{ ...saved, reviewed: false }]);
  assert.equal(saved.classificationReason, candidate.classificationReason);
  assert.equal(bankClassificationLabel(saved).kind, "GUESS");
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...saved, reviewed: true }]), /推測/);
});

test("keyword inference, a manual pick, an already reviewed guess and a changed category are not blocked", () => {
  const data = setup();
  const unknown = find(data, "unknown"), fee = find(data, "fee");
  const inferred = bankDisplayRows(data, [fee])[0];
  assert.equal(inferred.classificationConfidence, "INFERRED");
  saveBankEdits(data, admin, "JAPAN", [{ ...inferred, reviewed: true }]);
  assert.equal(fee.reviewed, true); assert.equal(fee.classificationReason, inferred.classificationReason);
  // A person choosing a category without any candidate provenance is a manual decision, not a guess.
  saveBankEdits(data, admin, "JAPAN", [{ id: unknown.id, updatedAt: unknown.updatedAt, categoryId: category("misc"), treatment: "NORMAL", reviewed: true, memo: "" }]);
  assert.deepEqual([unknown.reviewed, unknown.classificationConfidence, bankClassificationLabel(unknown).kind], [true, undefined, "CONFIRMED"]);
  // A guess that was reviewed before this guard existed keeps accepting memo edits.
  Object.assign(unknown, { classificationSource: "UNASSIGNED", classificationConfidence: "GUESS", classificationReason: "旧候補" });
  saveBankEdits(data, admin, "JAPAN", [{ ...unknown, memo: "note" }]);
  assert.deepEqual([unknown.memo, unknown.reviewed, unknown.classificationReason], ["note", true, "旧候補"]);
  // Adopting a guess for a different category than the one stored still needs the acknowledgement.
  const guessedFee = { id: fee.id, updatedAt: fee.updatedAt, categoryId: category("misc"), treatment: "NORMAL" as const, reviewed: true, memo: "", classificationConfidence: "GUESS" as const, classificationReason: "候補" };
  Object.assign(fee, { reviewed: false });
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [guessedFee]), /推測/);
  saveBankEdits(data, admin, "JAPAN", [{ ...guessedFee, acknowledgeGuess: true }]);
  assert.equal(fee.classificationReason, `${GUESS_ACKNOWLEDGED_PREFIX}: 候補`);
});

test("legacy rows without stored confidence are judged by their label, and reason helpers round-trip", () => {
  const data = setup(), unknown = find(data, "unknown");
  Object.assign(unknown, { categoryId: category("misc"), classificationSource: "UNASSIGNED", classificationConfidence: undefined, classificationReason: undefined });
  assert.equal(bankClassificationLabel(unknown).kind, "GUESS");
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...unknown, reviewed: true }]), /推測/);
  saveBankEdits(data, admin, "JAPAN", [{ ...unknown, reviewed: true, acknowledgeGuess: true }]);
  assert.equal(unknown.classificationReason, GUESS_ACKNOWLEDGED_PREFIX);
  assert.equal(unknown.classificationConfidence, "GUESS");
  assert.equal(stripGuessAcknowledgement(GUESS_ACKNOWLEDGED_PREFIX), undefined);
  assert.equal(stripGuessAcknowledgement(`${GUESS_ACKNOWLEDGED_PREFIX}: 摘要から`), "摘要から");
  assert.equal(stripGuessAcknowledgement("別の理由"), "別の理由");
  assert.equal(acknowledgedGuessReason(`${GUESS_ACKNOWLEDGED_PREFIX}: 摘要から`), `${GUESS_ACKNOWLEDGED_PREFIX}: 摘要から`);
  assert.equal(acknowledgedGuessReason("x".repeat(1200)).length, 1000);
  assert.equal(isGuessClassification({ ...unknown, reviewed: false, bookkeeping: { hold: { reason: "OTHER", question: "?" } } }), false);
  assert.equal(isGuessClassification({ ...unknown, reviewed: false, treatment: "TRANSFER" }), false);
});

test("the acknowledgement travels with the draft to the save request and clears when un-reviewing", () => {
  const data = setup(), row = find(data, "unknown");
  Object.assign(row, { categoryId: category("misc"), classificationSource: "AUTO", classificationConfidence: "GUESS" });
  const drafts = { [row.id]: patchBankDraft({}, row, { reviewed: true, acknowledgeGuess: true }) };
  const [change] = bankSaveChanges([row], [row], drafts, new Set(), "reviewed");
  assert.deepEqual([change.after.reviewed, change.after.acknowledgeGuess], [true, true]);
  const cleared = { [row.id]: patchBankDraft(drafts, row, { reviewed: false, acknowledgeGuess: undefined }) };
  assert.deepEqual(bankSaveChanges([row], [row], cleared, new Set(), "edited"), []);
});

test("income reconciled with an issued invoice proposes a sales category until an acceptable one is chosen", () => {
  const data = setup(), income = find(data, "income");
  assert.equal(bankSalesSuggestion(data, income), undefined);
  reconcile(data);
  const suggestion = bankSalesSuggestion(data, income)!;
  assert.deepEqual([suggestion.categoryId, suggestion.categoryName, suggestion.acceptedIds], [category("sales"), "売上高", [category("sales")]]);
  assert.match(suggestion.reason, /未設定/); assert.match(suggestion.reason, /未保存/);
  assert.match(bankSalesSuggestion(data, income, { categoryId: category("other-income"), treatment: "NORMAL" })!.reason, /「雑収入」は売上系ではありません/);
  assert.equal(bankSalesSuggestion(data, income, { categoryId: category("sales"), treatment: "NORMAL" }), undefined);
  assert.equal(bankSalesSuggestion(data, income, { categoryId: undefined, treatment: "EXCLUDED" }), undefined);
  assert.equal(bankSalesSuggestion(data, find(data, "unknown")), undefined);
  // Display rows carry the hint without touching the data; nothing else gets one.
  const before = JSON.stringify(data);
  const rows = bankDisplayRows(data, data.bankTransactions);
  assert.equal(rows.find((row) => row.id === income.id)!.salesSuggestion?.categoryId, category("sales"));
  assert.ok(rows.filter((row) => row.id !== income.id).every((row) => !row.salesSuggestion));
  assert.equal(JSON.stringify(data), before);
  // Saving the proposal is an ordinary manual edit; afterwards the hint is gone.
  saveBankEdits(data, admin, "JAPAN", [{ id: income.id, updatedAt: income.updatedAt, categoryId: category("sales"), treatment: "NORMAL", reviewed: false, memo: "", classificationConfidence: "INFERRED", classificationReason: "発行請求書と照合済みの入金（売上科目の提案を採用・未確定）" }]);
  assert.equal(bankSalesSuggestion(data, income), undefined);
  income.categoryId = undefined;
  data.bankReconciliations[0].deletedAt = timestamp;
  assert.equal(bankSalesSuggestion(data, income), undefined);
});

test("received-invoice links never propose sales, and the candidate set follows the available category names", () => {
  const data = setup(), income = find(data, "income");
  reconcile(data);
  const sales = data.accountingCategories.find((row) => row.id === category("sales"))!;
  const other = data.accountingCategories.find((row) => row.id === category("other-income"))!;
  // Without a 売上-named category every income category is acceptable, so 雑収入 is proposed and satisfies.
  sales.available = false;
  assert.deepEqual(bankSalesSuggestion(data, income)!.candidates, [{ id: other.id, name: "雑収入" }]);
  assert.equal(bankSalesSuggestion(data, income, { categoryId: other.id, treatment: "NORMAL" }), undefined);
  // Several sales names: 売上高 wins; otherwise only the list is offered.
  sales.available = true; other.name = "売上値引";
  assert.equal(bankSalesSuggestion(data, income)!.categoryId, sales.id);
  sales.name = "受託売上"; other.name = "製品売上";
  const listed = bankSalesSuggestion(data, income)!;
  assert.equal(listed.categoryId, undefined); assert.equal(listed.candidates.length, 2);
  assert.equal(bankSalesSuggestion(data, income, { categoryId: other.id, treatment: "NORMAL" }), undefined);
  // A category from another office is not offered.
  other.officeCode = "elsewhere";
  assert.deepEqual(bankSalesSuggestion(data, income)!.candidates.map((row) => row.name), ["受託売上"]);
  // Expense reconciled with a received invoice has nothing to do with sales.
  data.bankTransactions.push({ ...income, id: "expense", sourceId: "expense", side: "EXPENSE", amount: 8000, content: "Test supplier" });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
  const expense = find(data, "expense"), received = data.receivedInvoices[0];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: expense.id, transactionUpdatedAt: expense.updatedAt, invoiceKind: "received", invoiceId: received.id, invoiceUpdatedAt: received.updatedAt, amount: 8000, mode: "new", acknowledged: true }, today);
  assert.equal(bankSalesSuggestion(data, expense), undefined);
});
