import assert from "node:assert/strict";
import test from "node:test";
import { bankSaveFailureMessage, operationErrorMessage, operationFailureToast, receivedUploadRedirect, unconfirmedUploadFiles, uploadFeedback } from "../src/lib/operation-feedback";
import { originalSourceState } from "../src/lib/original-file-preview";
import { saveBankEdits } from "../src/lib/banking";
import { applyReceivedInvoiceFields } from "../src/lib/received-invoice-edits";
import { applyIssuedInvoiceEdits } from "../src/lib/issued-invoice-edits";
import { admin } from "./document-fixture";
import { uxRound1FeedbackCases, uxRound1Fixture } from "./ux-round1-fixture";

test("operation errors keep validation/conflict reasons in both persistent feedback and the destructive toast", () => {
  for (const error of [" 他の更新があります ", new Error("他の更新があります"), { error: "他の更新があります" }]) {
    const message = operationErrorMessage(error);
    assert.equal(message, "他の更新があります");
    assert.deepEqual(operationFailureToast(error), { title: "操作に失敗しました", description: message, variant: "destructive" });
  }
});

test("unknown or blank failures use the recovery message without dumping opaque response objects", () => {
  for (const error of [undefined, null, {}, { error: 123, privateField: "not-for-display" }, " \n ", new Error("")]) {
    assert.match(operationErrorMessage(error), /入力内容を保持/);
    assert.equal(operationErrorMessage(error, "合成フォールバック"), "合成フォールバック");
    assert.doesNotMatch(operationFailureToast(error).description, /not-for-display|object Object/);
  }
});

test("partial bank save feedback distinguishes confirmed saves from unconfirmed responses", () => {
  const rejected = bankSaveFailureMessage(new Error("他の更新があります"), 100, false);
  assert.match(rejected, /100件保存済み.*他の更新.*残りの変更・選択は保持/);
  assert.doesNotMatch(rejected, /結果未確認/);
  assert.match(bankSaveFailureMessage(undefined, 0, true), /0件保存済み.*結果未確認.*再保存前に最新状態/);
});

test("upload feedback reports full success, partial failure, and missing responses separately", () => {
  assert.equal(uploadFeedback([{}, {}], 0).variant, "success");
  const partial = uploadFeedback([{}, { error: "合成エラー" }], 1);
  assert.equal(partial.title, "1件取込、1件エラー");
  assert.equal(partial.variant, "destructive");
  assert.match(partial.description!, /選択1件.*登録済みの内容を確認/);
  const missing = uploadFeedback([], 2);
  assert.equal(missing.variant, "destructive");
  assert.match(missing.title, /0件取込.*確認が必要/);
});

test("failed and unconfirmed uploads retain the actual selected objects; successful files are not retried", () => {
  const files = [{ name: "success.pdf" }, { name: "failed.pdf" }, { name: "missing.pdf" }];
  const results = [{ fileName: "success.pdf" }, { fileName: "failed.pdf", error: "合成エラー" }];
  const before = structuredClone({ files, results });
  const retained = unconfirmedUploadFiles(files, results);
  assert.deepEqual(retained, files.slice(1));
  assert.equal(retained[0], files[1]);
  assert.equal(retained[1], files[2]);
  assert.deepEqual({ files, results }, before);
  assert.deepEqual(unconfirmedUploadFiles(files, []), files);
});

test("ambiguous duplicate filenames are retained conservatively until every result is successful", () => {
  const files = [{ name: "duplicate.pdf", index: 1 }, { name: "duplicate.pdf", index: 2 }];
  assert.deepEqual(unconfirmedUploadFiles(files, [{ fileName: "duplicate.pdf" }]), files);
  assert.deepEqual(unconfirmedUploadFiles(files, [{ fileName: "duplicate.pdf" }, { fileName: "duplicate.pdf", error: "合成失敗" }]), files);
  assert.deepEqual(unconfirmedUploadFiles(files, [{ fileName: "duplicate.pdf" }, { fileName: "duplicate.pdf" }]), []);
});

test("missing original URL and authoritative missing-file flag produce a reason", () => {
  for (const url of [undefined, "", "  "]) {
    assert.equal(originalSourceState(url).missing, true);
    assert.match(originalSourceState(url).reason, /登録先/);
  }
  assert.match(originalSourceState("/api/files/missing.pdf", true).reason, /原本ファイルがありません/);
});

test("404 and 410 mean missing originals; authentication, service failure and untested URLs do not", () => {
  for (const status of [404, 410]) {
    const result = originalSourceState("/api/files/synthetic.pdf", false, status);
    assert.equal(result.missing, true); assert.match(result.reason, new RegExp(String(status)));
  }
  for (const status of [undefined, 200, 401, 403, 500, 503]) {
    assert.deepEqual(originalSourceState("/api/files/synthetic.pdf", false, status), { missing: false, reason: "" });
  }
});

test("preview fixture keeps broken invoice relationships separate from original-file availability", () => {
  const data = uxRound1Fixture();
  const cases = uxRound1FeedbackCases(data);
  assert.equal(cases.originals.availableMail, "ux-mail-original");
  assert.equal(cases.originals.missingMail, "ux-mail-missing");
  assert.ok(data.receivedInvoices.some((row) => row.id === cases.originals.missingReceived && row.fileUrl?.endsWith("ux-missing.pdf")));
  const brokenLinkWithOriginal = { ...data.mailDocuments[0], relatedReceivedInvoiceId: "missing-invoice" };
  assert.equal(originalSourceState(brokenLinkWithOriginal.fileUrl, false).missing, false);
});

test("preview bank conflict fails with the original selection/draft and accounting data unchanged", () => {
  const data = uxRound1Fixture(), cases = uxRound1FeedbackCases(data);
  const before = structuredClone(data), draft = structuredClone(cases.bank);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [draft]), /更新/);
  assert.deepEqual(data, before); assert.deepEqual(draft, cases.bank);
});

test("preview received-invoice conflict keeps both submitted values and stored invoice unchanged", () => {
  const data = uxRound1Fixture(), cases = uxRound1FeedbackCases(data), before = structuredClone(data);
  const form = new FormData();
  for (const [key, value] of Object.entries(cases.received.fields)) form.set(key, String(value));
  const submitted = [...form.entries()];
  assert.throws(() => applyReceivedInvoiceFields(data, admin, "JAPAN", cases.received.id, form), /他の更新/);
  assert.deepEqual(data, before); assert.deepEqual([...form.entries()], submitted);
});

test("preview issued-invoice conflict preserves edits, payment records and all other data", () => {
  const data = uxRound1Fixture(), cases = uxRound1FeedbackCases(data), before = structuredClone(data);
  const draft = structuredClone(cases.issued);
  assert.throws(() => applyIssuedInvoiceEdits(data, admin, "JAPAN", [draft]), /他の操作で更新/);
  assert.deepEqual(data, before); assert.deepEqual(draft, cases.issued);
});

test("preview duplicate-number case exists and duplicate editing is rejected atomically", () => {
  const data = uxRound1Fixture(), cases = uxRound1FeedbackCases(data), before = structuredClone(data);
  const source = data.issuedInvoices.find((row) => row.id === "ux-issued-future")!;
  const draft = { ...source, needsReview: Boolean(source.needsReview), invoiceNumber: cases.duplicateInvoiceNumber };
  assert.throws(() => applyIssuedInvoiceEdits(data, admin, "JAPAN", [draft]), /番号.*重複/);
  assert.deepEqual(data, before);
});

test("manual received upload accepts only the existing same-origin success redirect", () => {
  const origin = "http://127.0.0.1:3080";
  const response = { ok: true, redirected: true, url: origin + "/received-invoices?company=JAPAN&uploaded=1" };
  assert.equal(receivedUploadRedirect(response, origin), "/received-invoices?company=JAPAN&uploaded=1");
  for (const url of [origin + "/login", origin + "/received-invoices?company=CHINA&uploaded=1", origin + "/received-invoices?company=JAPAN", "https://example.invalid/received-invoices?company=JAPAN&uploaded=1", "bad-url"]) {
    assert.equal(receivedUploadRedirect({ ...response, url }, origin), undefined);
  }
  assert.equal(receivedUploadRedirect({ ...response, ok: false }, origin), undefined);
  assert.equal(receivedUploadRedirect({ ...response, redirected: false }, origin), undefined);
});
