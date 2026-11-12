import assert from "node:assert/strict";
import test from "node:test";
import { expenseAccountant, expenseAdmin, expenseDesigner, expenseManager, expensesFixture } from "./expense-claims-fixture";
import { timestamp } from "./document-fixture";
import { assignCompanyCard, autoLinkCardReceipts, canViewCardReceiptFile, companyCardAccounts, myCardView, pickCardUse, removeCardReceipt, submitCardReceipt, type CardReceiptSubmit } from "../src/lib/card-receipts";
import { bankReceiptViews, removeBankReceipt } from "../src/lib/bank-receipts";
import type { BankTransaction } from "../src/lib/banking-types";

const today = "2026-11-08";
const account = (id: string, name: string, serviceName: string) => ({ id, company: "JAPAN" as const, officeCode: "office", sourceId: id, name, serviceName, isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp });
const cardUse = (id: string, accountId: string, amount: number, date: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: accountId,
  side: "EXPENSE", amount, content: `ｶ-ﾄﾞ ${id}`, transactionDate: date, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED",
  reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
const receipt = (patch: Partial<CardReceiptSubmit> = {}): CardReceiptSubmit => ({ spentOn: "2026-11-06", amount: 6820, payee: "合成ハンズ", purpose: "サンプル用の資材",
  file: { fileUrl: "/api/files/card-receipt.jpg", originalFileName: "r.jpg", mimeType: "image/jpeg" }, ...patch });

function setup() {
  const data = expensesFixture();
  data.bankAccounts = [account("aplus-des", "佐藤カード", "アプラス"), account("aplus-pm", "担当カード", "アプラス"), account("bank", "普通預金", "合成銀行")];
  data.bankTransactions = [
    cardUse("hands", "aplus-des", 6820, "2026-11-06"), cardUse("taxi-1", "aplus-des", 1480, "2026-11-05"), cardUse("taxi-2", "aplus-des", 1480, "2026-11-03"),
    cardUse("old", "aplus-des", 6820, "2026-10-01"), cardUse("pm-hands", "aplus-pm", 6820, "2026-11-06"), cardUse("refund", "aplus-des", 500, "2026-11-04", { side: "INCOME" }),
    cardUse("amazon", "aplus-des", 12980, "2026-11-04"), cardUse("skip", "aplus-des", 300, "2026-11-02", { bookkeeping: { invoiceRequirement: "NOT_REQUIRED" } as BankTransaction["bookkeeping"] }),
  ];
  assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "des", accountId: "aplus-des" });
  return data;
}

test("only administrators give out cards, only card accounts can be given, and each card belongs to one person", () => {
  const data = setup();
  assert.deepEqual(companyCardAccounts(data, "JAPAN").map((row) => row.id).sort(), ["aplus-des", "aplus-pm"]);
  assert.equal(data.users.find((row) => row.id === "des")?.companyCardAccountId, "aplus-des");
  assert.throws(() => assignCompanyCard(data, expenseAccountant, "JAPAN", { userId: "pm", accountId: "aplus-pm" }), /権限/);
  assert.throws(() => assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "pm", accountId: "bank" }), /カード/);
  assert.throws(() => assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "pm", accountId: "aplus-des" }), /合成補助さん/);
  assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "des", accountId: "" });
  assert.equal(data.users.find((row) => row.id === "des")?.companyCardAccountId, undefined);
});

test("PayPay and other wallets can be given as a company card, PayPay銀行 cannot", () => {
  const data = setup();
  data.bankAccounts.push(account("paypay", "PayPay", "PayPay"), account("paypay-bank", "PayPay銀行 / 本店 普通 0000000", "PayPay銀行"), account("paypay-card", "PayPayカード", "PayPayカード"));
  assert.deepEqual(companyCardAccounts(data, "JAPAN").map((row) => row.id).sort(), ["aplus-des", "aplus-pm", "paypay", "paypay-card"]);
  assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "pm", accountId: "paypay" });
  assert.equal(data.users.find((row) => row.id === "pm")?.companyCardAccountId, "paypay");
  assert.throws(() => assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "pm", accountId: "paypay-bank" }), /カード/);
  data.bankTransactions.push(cardUse("pp-lunch", "paypay", 1200, "2026-11-06"));
  const result = submitCardReceipt(data, expenseManager, "JAPAN", receipt({ amount: 1200 }), "pp-receipt");
  assert.equal(result.status, "LINKED");
  assert.equal(result.use?.id, "pp-lunch");
});

test("disabled, pending, rejected and deleted users cannot receive a company card", () => {
  for (const patch of [{ accessStatus: "DISABLED" as const }, { accessStatus: "PENDING" as const }, { accessStatus: "REJECTED" as const }, { deletedAt: timestamp }]) {
    const data = setup();
    Object.assign(data.users.find((user) => user.id === "pm")!, patch);
    const before = structuredClone(data);
    assert.throws(() => assignCompanyCard(data, expenseAdmin, "JAPAN", { userId: "pm", accountId: "aplus-pm" }), /利用者が見つかりません/);
    assert.deepEqual(data, before);
  }
});

test("a receipt with exactly one matching use on the person's own card is attached automatically and shows up for accounting", () => {
  const data = setup();
  assert.throws(() => submitCardReceipt(data, expenseManager, "JAPAN", receipt(), "no-card"), /会社カードが登録されていません/);
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt(), "r1");
  const saved = data.cardReceipts!.find((row) => row.id === "r1")!;
  assert.equal(saved.transactionId, "hands"); assert.equal(saved.linkedBy, "AUTO");
  const views = bankReceiptViews(data, "JAPAN", "hands");
  assert.equal(views.length, 1); assert.equal(views[0].source?.kind, "card");
  assert.match(views[0].source && "detail" in views[0].source ? views[0].source.detail : "", /会社カードの領収書・合成補助/);
  // The other person's identical use and the month-old use are never candidates.
  assert.equal(data.attachments.filter((row) => row.relatedId === "pm-hands" || row.relatedId === "old").length, 0);
  const view = myCardView(data, expenseDesigner, "JAPAN", today)!;
  assert.equal(view.receipts[0].status, "LINKED"); assert.equal(view.receipts[0].use?.id, "hands");
  assert.ok(!view.missing.some((row) => row.id === "hands"));
});

test("two equal uses wait for the person to choose, and only their own card's uses can be chosen", () => {
  const data = setup();
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ amount: 1480, spentOn: "2026-11-05", payee: "合成タクシー" }), "taxi");
  let view = myCardView(data, expenseDesigner, "JAPAN", today)!;
  assert.equal(view.receipts[0].status, "CHOOSE"); assert.deepEqual(view.receipts[0].candidates.map((row) => row.id), ["taxi-1", "taxi-2"]);
  const version = view.receipts[0].updatedAt;
  assert.throws(() => pickCardUse(data, expenseDesigner, "JAPAN", { id: "taxi", version, transactionId: "pm-hands" }), /あなたのカード/);
  assert.throws(() => pickCardUse(data, expenseManager, "JAPAN", { id: "taxi", version, transactionId: "taxi-1" }), /会社カードが登録されていません/);
  pickCardUse(data, expenseDesigner, "JAPAN", { id: "taxi", version, transactionId: "taxi-2" });
  view = myCardView(data, expenseDesigner, "JAPAN", today)!;
  assert.equal(view.receipts[0].status, "LINKED"); assert.equal(view.receipts[0].use?.id, "taxi-2"); assert.equal(data.cardReceipts![0].linkedBy, "SELF");
});

test("a receipt taken before the use reaches the statement waits and is attached after the next sync", () => {
  const data = setup();
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ amount: 1320, spentOn: "2026-11-07", payee: "合成カフェ" }), "cafe");
  assert.equal(myCardView(data, expenseDesigner, "JAPAN", today)!.receipts[0].status, "WAITING");
  assert.equal(autoLinkCardReceipts(data, "JAPAN"), 0);
  data.bankTransactions.push(cardUse("cafe-use", "aplus-des", 1320, "2026-11-08"));
  assert.equal(autoLinkCardReceipts(data, "JAPAN"), 1);
  assert.equal(data.cardReceipts![0].transactionId, "cafe-use");
});

test("picking a use from the missing list attaches it directly, but never a use that already has a receipt", () => {
  const data = setup();
  const before = myCardView(data, expenseDesigner, "JAPAN", today)!;
  // Income (refunds), uses marked as needing no document and other cards' uses are not "missing".
  assert.deepEqual(before.missing.map((row) => row.id).sort(), ["amazon", "hands", "old", "taxi-1", "taxi-2"].sort());
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ amount: 12900, payee: "合成通販", transactionId: "amazon" }), "amz");
  assert.equal(data.cardReceipts![0].transactionId, "amazon");
  assert.throws(() => submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ transactionId: "amazon" }), "again"), /すでに領収書/);
  assert.throws(() => submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ transactionId: "pm-hands" }), "other"), /あなたのカード/);
});

test("when accounting detaches a card receipt it is never matched to that use again, and the owner can delete their receipt", () => {
  const data = setup();
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt(), "r1");
  const attachment = data.attachments.find((row) => row.relatedId === "hands")!;
  assert.throws(() => removeBankReceipt(data, expenseDesigner, "JAPAN", attachment.id), /権限|口座/);
  removeBankReceipt(data, expenseAccountant, "JAPAN", attachment.id);
  const saved = data.cardReceipts![0];
  assert.equal(saved.transactionId, undefined); assert.deepEqual(saved.excludedTransactionIds, ["hands"]);
  assert.equal(autoLinkCardReceipts(data, "JAPAN"), 0);
  assert.equal(myCardView(data, expenseDesigner, "JAPAN", today)!.receipts[0].status, "WAITING");
  // Deleting a linked receipt also takes it off the bank row.
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt({ amount: 1480, spentOn: "2026-11-05", transactionId: "taxi-1" }), "r2");
  const linked = data.cardReceipts!.find((row) => row.id === "r2")!;
  assert.throws(() => removeCardReceipt(data, expenseManager, "JAPAN", { id: "r2", version: linked.updatedAt }), /見つかりません/);
  removeCardReceipt(data, expenseDesigner, "JAPAN", { id: "r2", version: linked.updatedAt });
  assert.ok(data.attachments.find((row) => row.id === linked.attachmentId)?.deletedAt);
  assert.ok(!myCardView(data, expenseDesigner, "JAPAN", today)!.receipts.some((row) => row.id === "r2"));
});

test("people without a card see no card view, and only the owner can open a card receipt's file through this rule", () => {
  const data = setup();
  assert.equal(myCardView(data, expenseManager, "JAPAN", today), null);
  submitCardReceipt(data, expenseDesigner, "JAPAN", receipt(), "r1");
  assert.ok(canViewCardReceiptFile(data, expenseDesigner, "card-receipt.jpg"));
  assert.ok(!canViewCardReceiptFile(data, expenseManager, "card-receipt.jpg"));
});
