import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { applyLegacyFlags, migrationId, runMigration, selectCandidates } from "../scripts/migrations/mail-processed-legacy-flags.mjs";

type Row = { id: string; updatedAt?: string; [key: string]: unknown };
const at = "2026-10-31T00:00:00.000Z", later = "2026-11-01T00:00:00.000Z";
const mail = (id: string, extra: Record<string, unknown> = {}): Row => ({ id, company: "JAPAN", updatedAt: at, ...extra });
const invoice = (id: string, extra: Record<string, unknown> = {}): Row => ({ id, projectId: "jp", status: "SCHEDULED", total: 1000, updatedAt: at, ...extra });
function fixture() {
  return { appEdition: "JAPAN", projects: [{ id: "jp", company: "JAPAN" }, { id: "cn", company: "CHINA" }, { id: "legacy-project" }, { id: "deleted-project", company: "JAPAN", deletedAt: at }],
    mailDocuments: [mail("linked", { relatedReceivedInvoiceId: "scheduled" }), mail("dangling", { relatedReceivedInvoiceId: "missing-invoice" }), mail("unlinked"),
      mail("manual-false", { mailProcessed: false, relatedReceivedInvoiceId: "paid" }), mail("manual-true", { mailProcessed: true }), mail("deleted", { deletedAt: at }), mail("cn", { company: "CHINA" }), mail("null-flag", { mailProcessed: null }), mail("legacy-company", { company: undefined })],
    receivedInvoices: [invoice("paid", { status: "PAID" }), invoice("scheduled"), invoice("archived", { status: "ARCHIVED" }), invoice("manual-false", { status: "PAID", mailProcessed: false }),
      invoice("manual-true", { mailProcessed: true }), invoice("deleted", { deletedAt: at }), invoice("cn", { projectId: "cn" }), invoice("missing-project", { projectId: "missing" }),
      invoice("deleted-project", { projectId: "deleted-project" }), invoice("legacy-project", { projectId: "legacy-project", status: "PAID" })],
    payments: [{ id: "synthetic-payment", receivedInvoiceId: "scheduled", amount: 1000 }], bankTransactions: [{ id: "synthetic-bank", reviewed: true, classificationSource: "AUTO", categoryId: "synthetic-category" }],
    bankReconciliations: [], auditLogs: [] as Array<{ action: string; afterJson: { migrationId: string; updated: number } }>, unrelated: { untouched: true } };
}

// Fake filesystem only: importing the module does not run its CLI, and no migration reads/writes actual files.
function memory(data = fixture()) {
  const file = path.resolve("synthetic-mail-flags/app-data.json"), files = new Map([[file, JSON.stringify(data, null, 2)]]), logs: string[] = [];
  const writes: string[] = [];
  const io = {
    read: (name: string) => { const value = files.get(name); if (value === undefined) throw new Error("Missing synthetic file"); return value; },
    writeNew: (name: string, text: string) => { if (files.has(name)) throw new Error("EEXIST"); files.set(name, text); writes.push(name); },
    mkdir: () => undefined,
    replace: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    remove: (name: string) => { if (!files.delete(name)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
  };
  const run = (args: string[]) => runMigration(["--data", file, ...args], { io, log: (message: string) => { logs.push(message); } });
  return { file, files, logs, writes, io, run, read: () => JSON.parse(files.get(file)!) as ReturnType<typeof fixture> };
}

test("legacy proposals match old display exactly, ignore payments and exclude existing/deleted/foreign flags", () => {
  const data = fixture(), before = structuredClone(data), rows = selectCandidates(data);
  assert.deepEqual(rows.map((row: { collection: string; id: string; proposedValue: boolean }) => [row.collection, row.id, row.proposedValue]), [
    ["mailDocuments", "linked", true], ["mailDocuments", "dangling", true], ["mailDocuments", "unlinked", false], ["mailDocuments", "legacy-company", false],
    ["receivedInvoices", "paid", true], ["receivedInvoices", "scheduled", false], ["receivedInvoices", "archived", false], ["receivedInvoices", "legacy-project", true],
  ]);
  assert.ok(rows.every((row: { updatedAt: string }) => row.updatedAt === at)); assert.deepEqual(data, before);
});

test("apply fills only missing flags with monotonic timestamps, audits and preserves every financial field", () => {
  const data = fixture(), before = structuredClone(data), plan = selectCandidates(data);
  assert.deepEqual(applyLegacyFlags(data, plan, at), { updated: 8, mailDocuments: 4, receivedInvoices: 4 });
  const expected = structuredClone(before);
  for (const item of plan as Array<{ collection: "mailDocuments" | "receivedInvoices"; id: string; proposedValue: boolean }>) {
    const row = expected[item.collection].find((row) => row.id === item.id)!;
    row.mailProcessed = item.proposedValue; row.updatedAt = "2026-10-31T00:00:00.001Z";
  }
  expected.auditLogs = data.auditLogs;
  assert.deepEqual(data, expected);
  assert.equal(data.auditLogs[0].action, "MAIL_PROCESSED_LEGACY_FLAGS_MIGRATION");
  assert.equal(data.auditLogs[0].afterJson.migrationId, migrationId); assert.equal(data.auditLogs[0].afterJson.updated, 8);
  const after = structuredClone(data);
  assert.deepEqual(applyLegacyFlags(data, selectCandidates(data), later), { updated: 0, mailDocuments: 0, receivedInvoices: 0 });
  assert.deepEqual(data, after);
});

for (const change of ["updatedAt", "explicit-flag", "deleted", "company", "link", "status", "project", "invalid-time"] as const) {
  test(`an outdated proposal rejects the entire batch before changing flags: ${change}`, () => {
    const data = fixture(), plan = selectCandidates(data), mail = data.mailDocuments[0], invoice = data.receivedInvoices[0];
    if (change === "updatedAt") invoice.updatedAt = later;
    if (change === "explicit-flag") invoice.mailProcessed = false;
    if (change === "deleted") invoice.deletedAt = later;
    if (change === "company") mail.company = "CHINA";
    if (change === "link") mail.relatedReceivedInvoiceId = undefined;
    if (change === "status") invoice.status = "SCHEDULED";
    if (change === "project") data.projects[0].company = "CHINA";
    if (change === "invalid-time") plan[0].updatedAt = "invalid";
    const before = structuredClone(data);
    assert.throws(() => applyLegacyFlags(data, plan, later)); assert.deepEqual(data, before);
  });
}

test("same ID in separate collections stays separate; missing timestamps and duplicate plan rows cannot apply", () => {
  const data = fixture(); data.receivedInvoices.push(invoice("linked", { status: "SCHEDULED" }));
  const plan = selectCandidates(data);
  applyLegacyFlags(data, plan, later);
  assert.equal(data.mailDocuments[0].mailProcessed, true); assert.equal(data.receivedInvoices.at(-1)!.mailProcessed, false);
  const fresh = fixture(), before = structuredClone(fresh), duplicate = selectCandidates(fresh);
  assert.throws(() => applyLegacyFlags(fresh, [...duplicate, duplicate[0]], later), /Duplicate/); assert.deepEqual(fresh, before);
  fresh.mailDocuments[0].updatedAt = undefined;
  assert.equal(selectCandidates(fresh)[0].updatedAt, null);
  const missingTime = structuredClone(fresh);
  assert.throws(() => applyLegacyFlags(fresh, selectCandidates(fresh), later), /updatedAt/); assert.deepEqual(fresh, missingTime);
});

test("default dry run prints IDs, counts and proposals without any file or data changes", () => {
  const m = memory(), before = new Map(m.files);
  const report = m.run([]);
  assert.ok(report.counts);
  assert.equal(report.mode, "dry-run"); assert.equal(report.counts.total, 8);
  assert.match(m.logs.join("\n"), /候補 8件/); assert.match(m.logs.join("\n"), /mailDocuments\tlinked\t.*\ttrue/);
  assert.match(m.logs.join("\n"), /Dry run/); assert.deepEqual(m.writes, []); assert.deepEqual(m.files, before);
});

test("JSON stdout and --out contain a reviewable plan; the data and existing output files stay unchanged", () => {
  const m = memory(), original = m.files.get(m.file), out = path.resolve("synthetic-mail-flags/report.json");
  const report = m.run(["--json", "--out", out]);
  assert.deepEqual(JSON.parse(m.logs[0]), report); assert.deepEqual(JSON.parse(m.files.get(out)!), report);
  assert.equal(m.files.get(m.file), original); assert.deepEqual(m.writes, [out]);
  assert.throws(() => m.run(["--out", out]), /EEXIST/); assert.equal(m.files.get(m.file), original);
  assert.throws(() => m.run(["--out", m.file]), /overwrite/); assert.equal(m.files.get(m.file), original);
});

test("explicit apply backs up exact bytes, writes atomically, is repeatable and restore first backs up current state", () => {
  const m = memory(), original = m.files.get(m.file)!;
  const applied = m.run(["--apply"]);
  assert.ok("result" in applied && applied.backup);
  assert.equal(applied.result.updated, 8); assert.equal(m.files.get(applied.backup), original);
  assert.match(applied.backup, /backups.*mail-processed-legacy-flags/);
  const after = m.files.get(m.file), writes = m.writes.length;
  const repeat = m.run(["--apply"]);
  assert.ok(repeat.counts);
  assert.equal(repeat.counts.total, 0); assert.equal(m.writes.length, writes); assert.equal(m.files.get(m.file), after);
  const restored = m.run(["--restore", applied.backup]);
  assert.ok(restored.backup);
  assert.equal(m.files.get(m.file), original); assert.equal(m.files.get(restored.backup), after);
  assert.equal([...m.files.keys()].some((name) => name.endsWith(".tmp")), false);
});

test("a saved dry-run plan applies unchanged targets and refuses targets edited after the report", () => {
  const m = memory(), out = path.resolve("synthetic-mail-flags/report.json");
  m.run(["--out", out]);
  const changed = m.read(); changed.receivedInvoices[0].updatedAt = later;
  m.files.set(m.file, JSON.stringify(changed)); const before = m.files.get(m.file), writes = m.writes.length;
  assert.throws(() => m.run(["--apply", "--plan", out]), /changed|updatedAt/);
  assert.equal(m.files.get(m.file), before); assert.equal(m.writes.length, writes);
  const fresh = memory(); fresh.run(["--out", out]);
  const applied = fresh.run(["--apply", "--plan", out]); assert.ok("result" in applied);
  assert.equal(applied.result.updated, 8);
  assert.throws(() => fresh.run(["--apply", "--plan", out]), /changed/);
});

test("apply rereads updatedAt immediately before mutation and refuses concurrent edits", () => {
  const m = memory(), read = m.io.read; let reads = 0;
  m.io.read = (name) => {
    if (name === m.file && ++reads === 2) {
      const changed = m.read(); changed.receivedInvoices[0].updatedAt = later;
      m.files.set(m.file, JSON.stringify(changed));
    }
    return read(name);
  };
  assert.throws(() => m.run(["--apply"]), /changed|updatedAt/);
  assert.equal(m.read().receivedInvoices[0].updatedAt, later); assert.equal(m.read().mailDocuments[0].mailProcessed, undefined);
  assert.deepEqual(m.writes, []);
});

test("a last-moment unrelated edit is not overwritten and the temporary file is removed", () => {
  const m = memory(), read = m.io.read; let reads = 0;
  m.io.read = (name) => {
    if (name === m.file && ++reads === 3) {
      const changed = m.read(); changed.unrelated.untouched = false; m.files.set(m.file, JSON.stringify(changed));
    }
    return read(name);
  };
  assert.throws(() => m.run(["--apply"]), /changed before write/);
  assert.equal(m.read().unrelated.untouched, false); assert.equal(m.read().mailDocuments[0].mailProcessed, undefined);
  assert.equal([...m.files.keys()].some((name) => name.endsWith(".tmp")), false);
  assert.ok([...m.files.keys()].some((name) => name.includes("backups")));
});

test("backup or atomic replacement failures preserve the source data", () => {
  for (const operation of ["writeNew", "replace"] as const) {
    const m = memory(), original = m.files.get(m.file);
    m.io[operation] = () => { throw new Error("simulated IO failure"); };
    assert.throws(() => m.run(["--apply"]), /simulated IO/); assert.equal(m.files.get(m.file), original);
    assert.equal([...m.files.keys()].some((name) => name.endsWith(".tmp")), false);
  }
});

test("invalid files, plans, arguments and restore combinations never write data", () => {
  for (const args of [["--aplly"], ["--out"], ["--plan", "report.json"], ["--apply", "--restore", "backup.json"], ["--restore", "backup.json", "--out", "report.json"]]) {
    const m = memory(); assert.throws(() => m.run(args)); assert.deepEqual(m.writes, []);
  }
  assert.throws(() => runMigration([], { io: memory().io, log: () => {} }), /--data/);
  const m = memory(), foreign = fixture(); foreign.appEdition = "CHINA";
  const backup = path.resolve("synthetic-mail-flags/foreign.json"); m.files.set(backup, JSON.stringify(foreign));
  assert.throws(() => m.run(["--restore", backup]), /Japan/); assert.deepEqual(m.writes, []);
  m.files.set(m.file, JSON.stringify(foreign)); assert.throws(() => m.run(["--apply"]), /Japan/); assert.deepEqual(m.writes, []);
  const duplicate = fixture(); duplicate.mailDocuments.push({ ...duplicate.mailDocuments[0] });
  assert.throws(() => selectCandidates(duplicate), /duplicate ID/);
});
