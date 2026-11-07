import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BankAutosaveQueue, bankAutosaveFailureMessage, bankAutosaveSummary, bankAutosaveVisibleRows, bankBulkNeedsConfirmation, bankCandidateChanges, bankMemoSaveReady, nextBankAutosaveBatch, rebaseBankAutosaveDraft, type BankAutosaveEdit, type BankAutosaveEntry, type BankAutosaveNotice, type BankAutosaveResult } from "../src/lib/bank-autosave";
import type { BankDisplayRow } from "../src/lib/banking";

const row = (id = "a"): BankDisplayRow => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", transactionDate: "2026-11-01", side: "EXPENSE", amount: 1000, content: `合成明細 ${id}`, memo: "", sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "NORMAL", reviewed: false, classificationSource: "UNASSIGNED", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const saved = (edits: BankAutosaveEdit[], revision = "2026-11-01T00:00:01.000Z"): BankAutosaveResult => ({ rows: edits.map((edit) => ({ ...row(edit.id), ...edit.patch, updatedAt: revision, classificationSource: "MANUAL", predictionPending: false })), failures: [], auditLogId: revision });

test("autosave translates transport failures and missing responses into Japanese retry guidance", () => {
  const expected = "通信できませんでした。接続を確認して「再試行」を押してください";
  for (const error of [new TypeError("Failed to fetch"), new Error("fetch failed"), "Load failed", "NetworkError when attempting to fetch resource.", "net::ERR_INTERNET_DISCONNECTED", "No response", undefined, null, {}, ""]) {
    assert.equal(bankAutosaveFailureMessage(error), expected);
  }
});

test("autosave retains Japanese server validation reasons verbatim", () => {
  for (const reason of ["保留を解消してから確認済みにしてください", "利用者の権限を確認してください", "補助科目が勘定科目と一致しません", "入力内容を確認してください", "AI設定のAPIキーを確認してください"]) {
    assert.equal(bankAutosaveFailureMessage(reason), reason);
    assert.equal(bankAutosaveFailureMessage(new Error(reason)), reason);
  }
});

test("autosave does not expose mixed-language network errors or internal stack details", () => {
  for (const reason of ["通信失敗: Failed to fetch", "TypeError: 内部処理に失敗", "保存失敗\n    at internalSave (server.js:1:1)", "An error occurred in the Server Components render."]) {
    assert.equal(bankAutosaveFailureMessage(reason), "通信できませんでした。接続を確認して「再試行」を押してください");
  }
});

test("autosave conflicts name the existing resolution controls without changing the server reason", () => {
  const failure = { kind: "conflict" as const, error: "明細が更新されています。画面を更新して再度保存してください" };
  const before = { ...failure };
  const expected = "ほかの画面で先に変更されました。「最新の内容を読み込む」か「この変更を取り消す」を選んでください";
  assert.equal(bankAutosaveFailureMessage(failure.error, failure.kind), expected);
  assert.equal(bankAutosaveFailureMessage(undefined, "conflict"), expected);
  assert.doesNotMatch(expected, /再度保存/);
  assert.deepEqual(failure, before);
});

test("queue failures expose the translated transport and conflict messages to every view", async () => {
  let now = 0;
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => {}, save: async (edits) => {
    if (edits[0].id === "offline") throw new TypeError("Failed to fetch");
    return { rows: [], failures: [{ id: "conflict", kind: "conflict", error: "明細が更新されています。画面を更新して再度保存してください" }] };
  } });
  queue.enqueue([{ row: row("offline"), patch: { memo: "保持" } }]); now = 300; await queue.flush();
  assert.equal(queue.getSnapshot().entries.offline.error, "通信できませんでした。接続を確認して「再試行」を押してください");
  queue.enqueue([{ row: row("conflict"), patch: { memo: "保持" } }]); now = 600; await queue.flush();
  assert.equal(queue.getSnapshot().entries.conflict.error, bankAutosaveFailureMessage(undefined, "conflict"));
  assert.equal(queue.getSnapshot().entries.conflict.status, "conflict");
  assert.equal(Object.keys(queue.getSnapshot().drafts).length, 2);
});

test("autosave serializes a row and rebases only edits made during its request onto the returned version", async () => {
  let now = 0;
  const response = deferred<BankAutosaveResult>(), calls: BankAutosaveEdit[][] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => assert.fail("single edits must stay quiet"), save: async (edits) => { calls.push(edits); return calls.length === 1 ? response.promise : saved(edits, "2026-11-01T00:00:02.000Z"); } });
  queue.enqueue([{ row: row(), patch: { categoryId: "expense", reviewed: true, acknowledgeGuess: true } }]);
  now = 300; const first = queue.flush(); await Promise.resolve();
  queue.enqueue([{ row: row(), patch: { memo: "続けて入力" } }]);
  queue.enqueue([{ row: row(), patch: { memo: "最新の入力" } }]);
  now = 600; assert.equal(queue.flush(), first); assert.equal(calls.length, 1);
  response.resolve({ ...saved(calls[0]), rows: [{ ...saved(calls[0]).rows[0], classificationReason: "推測を確認済み" }] }); await first;
  assert.equal(queue.getSnapshot().drafts.a.updatedAt, "2026-11-01T00:00:01.000Z");
  assert.equal(queue.getSnapshot().drafts.a.categoryId, "expense");
  assert.equal(queue.getSnapshot().drafts.a.classificationReason, "推測を確認済み");
  await queue.flush();
  assert.deepEqual(calls[1], [{ id: "a", updatedAt: "2026-11-01T00:00:01.000Z", patch: { memo: "最新の入力" } }]);
  assert.deepEqual(queue.getSnapshot().drafts, {});
  assert.equal(queue.getSnapshot().entries.a.status, "saved");
  assert.equal(queue.getSnapshot().entries.a.savedUntil, now + 2000);
});

test("separate edits inside 300ms share a request and a bulk over 100 rows keeps every audit ID", async () => {
  let now = 0;
  const calls: BankAutosaveEdit[][] = [], notices: BankAutosaveNotice[] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: (notice) => notices.push(notice), save: async (edits) => { calls.push(edits); return { ...saved(edits), auditLogId: `log-${calls.length}` }; } });
  queue.enqueue([{ row: row("single-a"), patch: { memo: "1" } }]); now = 100;
  queue.enqueue([{ row: row("single-b"), patch: { memo: "2" } }]); now = 400;
  await queue.flush(); assert.equal(calls[0].length, 2); assert.equal(notices.length, 0);
  queue.enqueue(Array.from({ length: 205 }, (_, index) => ({ row: row(String(index)), patch: { reviewed: true } })), "を確認済みにしました");
  now = 700;
  await queue.flush(); await queue.flush(); await queue.flush();
  assert.deepEqual(calls.slice(1).map((batch) => batch.length), [100, 100, 5]);
  assert.equal(notices.length, 1); assert.equal(notices[0].count, 205);
  assert.deepEqual(notices[0].auditIds, ["log-2", "log-3", "log-4"]);
  assert.equal(new Set(notices[0].rowIds).size, 205);
});

test("Undo histories never mix different bulk operations or single-row edits", async () => {
  let now = 0;
  const calls: BankAutosaveEdit[][] = [], notices: BankAutosaveNotice[] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: (notice) => notices.push(notice), save: async (edits) => { calls.push(edits); return { ...saved(edits), auditLogId: String(calls.length) }; } });
  queue.enqueue(["a", "b"].map((id) => ({ row: row(id), patch: { reviewed: true } })), "を確認済みにしました");
  queue.enqueue(["c", "d"].map((id) => ({ row: row(id), patch: { treatment: "EXCLUDED" } })), "の扱いを変更しました");
  queue.enqueue([{ row: row("e"), patch: { memo: "独立" } }]); now = 300;
  await queue.flush(); await queue.flush(); await queue.flush();
  assert.deepEqual(calls.map((batch) => batch.map((edit) => edit.id)), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(notices.map((notice) => notice.auditIds), [["1"], ["2"]]);
});

test("a failed row keeps its edits, successful rows clear, and retry sends only the requested row", async () => {
  let now = 0, attempt = 0;
  const calls: BankAutosaveEdit[][] = [], notices: BankAutosaveNotice[] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: (notice) => notices.push(notice), save: async (edits) => {
    calls.push(edits); attempt++;
    return attempt === 1 ? { ...saved(edits.filter((edit) => edit.id === "ok")), failures: [{ id: "failed", kind: "failed", error: "保留を解消してください" }] } : saved(edits);
  } });
  queue.enqueue(["ok", "failed"].map((id) => ({ row: row(id), patch: { reviewed: true } }))); now = 300;
  await queue.flush(); await queue.flush(); assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(queue.getSnapshot().drafts), ["failed"]);
  assert.match(queue.getSnapshot().entries.failed.error!, /保留/);
  assert.equal(notices[0].count, 1); assert.equal(notices[0].failed, 1);
  queue.retry("failed"); await queue.flush();
  assert.deepEqual(calls[1].map((edit) => edit.id), ["failed"]);
});

test("a lost response retains changes and a conflict cannot silently rebase or retry", async () => {
  let now = 0, attempts = 0;
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => {}, save: async () => { attempts++; if (attempts === 1) throw new Error("応答なし"); return { rows: [], failures: [{ id: "a", kind: "conflict", error: "明細が更新されています" }] }; } });
  queue.enqueue([{ row: row(), patch: { memo: "自分の変更" } }]); now = 300; await queue.flush();
  assert.equal(queue.getSnapshot().entries.a.status, "failed");
  queue.retry("a"); await queue.flush();
  const newer = { ...row(), memo: "別のタブの変更", updatedAt: "2026-11-01T00:00:05.000Z" };
  queue.receive([newer]); queue.retry("a");
  queue.enqueue([{ row: newer, patch: { memo: "自分の変更を保持" } }]); now = 600; await queue.flush();
  assert.equal(attempts, 2); assert.equal(queue.getSnapshot().drafts.a.updatedAt, row().updatedAt);
  assert.equal(queue.getSnapshot().entries.a.status, "conflict");
  queue.discard("a"); assert.deepEqual(queue.getSnapshot().drafts, {}); assert.equal(queue.getSnapshot().rows.a.memo, newer.memo);
});

test("predictions alone never enter autosave, and adoption includes only the explicit candidates", () => {
  const predictions = [row("a"), row("b")].map((item) => ({ ...item, predictionPending: true, categoryId: "guess" }));
  const queue = new BankAutosaveQueue({ save: async () => assert.fail("not adopted"), onNotice: () => {} });
  queue.receive(predictions);
  assert.deepEqual(nextBankAutosaveBatch(queue.getSnapshot().entries, Infinity), []);
  const changes = bankCandidateChanges([predictions[0], row("ordinary")], {});
  assert.deepEqual(changes.map((change) => change.row.id), ["a"]);
  assert.equal(changes[0].patch.categoryId, "guess");
  queue.enqueue([{ row: predictions[0], patch: { memo: "メモだけ" } }]);
  assert.deepEqual(queue.getSnapshot().drafts.a.patch, { memo: "メモだけ" });
  assert.deepEqual(bankCandidateChanges(predictions, queue.getSnapshot().drafts).map((change) => change.row.id), ["b"]);
});

test("only operations reaching originally unloaded selected IDs require confirmation", () => {
  const unloaded = new Set(["outside", "excluded"]);
  assert.equal(bankBulkNeedsConfirmation(["a", "b"], unloaded), false);
  assert.equal(bankBulkNeedsConfirmation(["a", "outside"], unloaded), true);
  assert.equal(bankBulkNeedsConfirmation(["a", "b"], new Set()), false);
  assert.equal(bankBulkNeedsConfirmation([], unloaded), false);
});

test("autosave summary counts queued input, requests, successes, failures and conflicts separately", () => {
  const entries = Object.fromEntries(["queued", "saving", "saved", "failed", "conflict"].map((status) => [status, { status, dueAt: 0, composing: false }])) as Record<string, BankAutosaveEntry>;
  assert.deepEqual(bankAutosaveSummary(entries), { saving: 2, saved: 1, failed: 1, conflict: 1 });
  assert.deepEqual(bankAutosaveSummary({}, 1), { saving: 1, saved: 0, failed: 0, conflict: 0 });
});

test("memo debounce and blur never save during Japanese composition, including other edits to that row", async () => {
  assert.equal(bankMemoSaveReady(true, 5000, true), false);
  assert.equal(bankMemoSaveReady(false, 999), false);
  assert.equal(bankMemoSaveReady(false, 1000), true);
  assert.equal(bankMemoSaveReady(false, 1, true), true);
  let now = 0; const calls: BankAutosaveEdit[][] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => {}, save: async (edits) => { calls.push(edits); return saved(edits); } });
  queue.setComposing("a", true);
  queue.enqueue([{ row: row(), patch: { memo: "にほん" } }], undefined, false, true);
  now = 1000; queue.enqueue([{ row: row(), patch: { categoryId: "expense" } }]);
  now = 3000; queue.flushMemo("a"); await queue.flush(); assert.equal(calls.length, 0);
  queue.enqueue([{ row: row(), patch: { memo: "日本" } }], undefined, false, true);
  queue.setComposing("a", false); await queue.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0][0].patch.memo, "日本");
  queue.enqueue([{ row: row(), patch: { memo: "日本語" } }], undefined, false, true);
  now = 3999; await queue.flush(); assert.equal(calls.length, 1);
  now = 4000; await queue.flush(); assert.equal(calls.length, 2);
});

test("discarding unsent edits waits for the in-flight request and prevents its queued successor", async () => {
  let now = 0; const response = deferred<BankAutosaveResult>(), calls: BankAutosaveEdit[][] = [];
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => {}, save: async (edits) => { calls.push(edits); return response.promise; } });
  queue.enqueue([{ row: row(), patch: { memo: "送信済み" } }]); now = 300;
  const sending = queue.flush(); await Promise.resolve(); queue.enqueue([{ row: row(), patch: { memo: "未送信" } }]);
  let left = false; const leaving = queue.discardAll().then(() => { left = true; });
  await Promise.resolve(); assert.equal(left, false); response.resolve(saved(calls[0])); await sending; await leaving;
  now = 1000; await queue.flush(); assert.equal(calls.length, 1); assert.deepEqual(queue.getSnapshot().drafts, {});
});

test("Undo protects only its rows and receives authoritative versions before releasing them", () => {
  const queue = new BankAutosaveQueue({ save: async () => assert.fail(), onNotice: () => {} });
  queue.enqueue([{ row: row("dirty"), patch: { memo: "変更" } }]);
  assert.equal(queue.beginUndo(["dirty"]), false); assert.equal(queue.beginUndo(["a"]), true);
  queue.enqueue([{ row: row("a"), patch: { memo: "保存しない" } }]); assert.equal(queue.getSnapshot().drafts.a, undefined);
  const restored = { ...row(), updatedAt: "2026-11-01T00:00:05.000Z" };
  queue.receive([restored]); queue.endUndo(["a"]);
  queue.enqueue([{ row: row(), patch: { memo: "取り消した後の編集" } }]);
  assert.equal(queue.getSnapshot().drafts.a.updatedAt, restored.updatedAt);
  assert.equal(rebaseBankAutosaveDraft(restored, {}), undefined);
});

test("Japanese workspace connects autosave, adoption, IME, Undo and navigation without a save button", () => {
  const source = readFileSync("src/components/app/banking-workspace.tsx", "utf8");
  const japanBar = source.slice(source.indexOf('{company === "JAPAN" ? showActions'), source.indexOf('aria-label="明細の保存">'));
  assert.match(japanBar, /候補を採用/); assert.doesNotMatch(japanBar, /chooseSave|保存…|defaultSaveOption/);
  assert.match(source, /company !== "JAPAN" && savePreview/);
  assert.match(source, /if \(!leaveBlocked\) return/); assert.match(source, /if \(leaveBlocked\) \{ setLeaveUrl/);
  assert.match(source, /onCompositionStart=/); assert.match(source, /onCompositionEnd=/); assert.match(source, /onBlur=\{\(\) => autosave.queue.flushMemo/);
  const hook = readFileSync("src/hooks/use-bank-autosave.tsx", "utf8");
  assert.match(hook, /\[\.\.\.notice.auditIds\].reverse\(\)/); assert.match(hook, /undoBankAuditAction/); assert.match(hook, /元に戻す/);
});

test("closing a saved classification preview does not leak its rows into the filtered ledger", async () => {
  let now = 0;
  const queue = new BankAutosaveQueue({ now: () => now, onNotice: () => {}, save: async (edits) => saved(edits) });
  queue.enqueue([{ row: row("preview"), patch: { categoryId: "expense" } }]); now = 300; await queue.flush();
  assert.equal(bankAutosaveVisibleRows([row("base")], queue.getSnapshot().rows, queue.getSnapshot().entries).length, 1);
  queue.clearCompleted();
  assert.deepEqual(bankAutosaveVisibleRows([row("base")], queue.getSnapshot().rows, queue.getSnapshot().entries), []);
  queue.enqueue([{ row: row("pending"), patch: { memo: "保持する" } }]);
  assert.deepEqual(bankAutosaveVisibleRows([row("base")], queue.getSnapshot().rows, queue.getSnapshot().entries).map((item) => item.id), ["pending"]);
});

test("the active scheduler sends changes without a manual flush and expires the saved indicator", { timeout: 5000 }, async (context) => {
  const sent = deferred<boolean>();
  const queue = new BankAutosaveQueue({ onNotice: () => assert.fail("single edit"), save: async (edits) => { sent.resolve(true); return saved(edits); } });
  context.after(() => queue.deactivate());
  queue.activate(); queue.enqueue([{ row: row(), patch: { memo: "自動送信" } }]);
  await sent.promise; await queue.flush();
  assert.equal(queue.getSnapshot().entries.a.status, "saved");
  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal(queue.getSnapshot().entries.a, undefined);
  assert.deepEqual(queue.getSnapshot().drafts, {});
});
