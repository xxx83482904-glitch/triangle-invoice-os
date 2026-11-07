import type { BankDisplayRow } from "@/lib/banking";
import type { BankEdit, BankTransaction } from "@/lib/banking-types";
import { bankEditFrom, patchBankDraft, type BankDraft, type BankDrafts } from "@/lib/bank-workspace-drafts";

export type BankAutosaveEdit = { id: string; updatedAt: string; patch: Partial<BankEdit> };
export type BankAutosaveFailure = { id: string; kind: "failed" | "conflict"; error: string };
export type BankAutosaveResult = { rows: BankDisplayRow[]; failures: BankAutosaveFailure[]; auditLogId?: string };
export type BankAutosaveChange = { row: BankTransaction; patch: Partial<BankEdit> };
export type BankAutosaveStatus = "queued" | "saving" | "saved" | "failed" | "conflict";
export type BankAutosaveEntry = {
  draft?: BankDraft; status: BankAutosaveStatus; error?: string; dueAt: number; composing: boolean;
  afterSend?: Partial<BankEdit>; group?: number; savedUntil?: number;
};
export type BankAutosaveNotice = { count: number; failed: number; label: string; auditIds: string[]; rowIds: string[] };
export type BankAutosaveSnapshot = { entries: Record<string, BankAutosaveEntry>; drafts: BankDrafts; rows: Record<string, BankDisplayRow>; undoing: string[] };

export function bankAutosaveFailureMessage(error: unknown, kind: BankAutosaveFailure["kind"] = "failed") {
  if (kind === "conflict") return "ほかの画面で先に変更されました。「最新の内容を読み込む」か「この変更を取り消す」を選んでください";
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  // Preserve Japanese validation reasons, but never expose transport errors or stack details.
  const internal = /failed to fetch|fetch failed|load failed|network(?:error| request failed)|\b\w*(?:Error|Exception)\b|net::ERR_|\n\s*at\s/i.test(message);
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(message) && !internal
    ? message : "通信できませんでした。接続を確認して「再試行」を押してください";
}

export function bankBulkNeedsConfirmation(ids: string[], unloadedIds: ReadonlySet<string>) {
  return ids.some((id) => unloadedIds.has(id));
}
export function bankMemoSaveReady(composing: boolean, idleMilliseconds: number, blurred = false) {
  return !composing && (blurred || idleMilliseconds >= 1000);
}
export function bankAutosaveSummary(entries: Record<string, BankAutosaveEntry>, undoing = 0) {
  const counts = { saving: undoing, saved: 0, failed: 0, conflict: 0 };
  for (const entry of Object.values(entries)) {
    if (entry.status === "queued" || entry.status === "saving") counts.saving++;
    else counts[entry.status]++;
  }
  return counts;
}
export function nextBankAutosaveBatch(entries: Record<string, BankAutosaveEntry>, now: number) {
  const ready = Object.entries(entries).filter(([, entry]) => entry.draft && entry.status === "queued" && !entry.composing && entry.dueAt <= now);
  const group = ready[0]?.[1].group;
  // A history record must belong to one bulk operation so Undo never includes unrelated edits.
  return ready.filter(([, entry]) => entry.group === group).slice(0, 100).map(([id, entry]) => ({ id, draft: entry.draft!, group }));
}
export function rebaseBankAutosaveDraft(saved: BankDisplayRow, afterSend?: Partial<BankEdit>) {
  return afterSend && Object.keys(afterSend).length ? patchBankDraft({}, saved, afterSend) : undefined;
}
export function bankCandidateChanges(rows: BankDisplayRow[], drafts: BankDrafts) {
  return rows.filter((row) => row.predictionPending && !drafts[row.id]).map((row) => ({ row, patch: bankEditFrom(row) }));
}
export function bankAutosaveVisibleRows(base: BankDisplayRow[], saved: Record<string, BankDisplayRow>, entries: Record<string, BankAutosaveEntry>) {
  const visible = new Set(base.map((row) => row.id));
  return Object.values(saved).filter((row) => visible.has(row.id) || entries[row.id]);
}

type Group = BankAutosaveNotice & { id: number };
type Options = { save: (edits: BankAutosaveEdit[]) => Promise<BankAutosaveResult>; onNotice: (notice: BankAutosaveNotice) => void; now?: () => number };

export class BankAutosaveQueue {
  private snapshot: BankAutosaveSnapshot = { entries: {}, drafts: {}, rows: {}, undoing: [] };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private running?: Promise<void>;
  private flight: ReturnType<typeof nextBankAutosaveBatch> = [];
  private groups = new Map<number, Group>();
  private serial = 0;
  private composing = new Set<string>();
  private blurred = new Set<string>();
  private now: () => number;

  constructor(private options: Options) { this.now = options.now || Date.now; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; this.schedule(); }
  deactivate() { this.active = false; clearTimeout(this.timer); }
  private publish(entries = this.snapshot.entries, rows = this.snapshot.rows, undoing = this.snapshot.undoing) {
    this.snapshot = { entries, rows, undoing, drafts: Object.fromEntries(Object.entries(entries).flatMap(([id, entry]) => entry.draft ? [[id, entry.draft]] : [])) };
    for (const listener of this.listeners) listener();
    this.schedule();
  }
  enqueue(changes: BankAutosaveChange[], label = "を変更しました", notify = changes.length > 1, memo = false) {
    const group = notify ? ++this.serial : undefined;
    if (group) this.groups.set(group, { id: group, count: 0, failed: 0, label, auditIds: [], rowIds: [] });
    const entries = { ...this.snapshot.entries }, rows = { ...this.snapshot.rows };
    for (const { row, patch } of changes) {
      if (this.snapshot.undoing.includes(row.id)) continue;
      const previous = entries[row.id];
      const saved = this.snapshot.rows[row.id];
      const base = saved && saved.updatedAt >= row.updatedAt ? saved : row;
      rows[row.id] = base;
      const draft = patchBankDraft(previous?.draft ? { [row.id]: previous.draft } : {}, base, patch);
      const inFlight = this.flight.some((item) => item.id === row.id);
      entries[row.id] = { draft, group, composing: this.composing.has(row.id), dueAt: this.now() + (memo ? 1000 : 300),
        status: previous?.status === "conflict" ? "conflict" : inFlight ? "saving" : "queued",
        error: previous?.status === "conflict" ? previous.error : undefined,
        afterSend: inFlight ? { ...previous?.afterSend, ...patch } : undefined };
    }
    this.publish(entries, rows);
    this.finishGroups();
  }
  setComposing(id: string, composing: boolean) {
    if (composing) { this.composing.add(id); this.blurred.delete(id); } else this.composing.delete(id);
    const entry = this.snapshot.entries[id];
    if (entry?.draft) this.publish({ ...this.snapshot.entries, [id]: { ...entry, composing,
      dueAt: bankMemoSaveReady(composing, 0, this.blurred.has(id)) ? this.now() : this.now() + 1000 } });
    if (!composing) this.blurred.delete(id);
  }
  flushMemo(id: string) {
    this.blurred.add(id);
    const entry = this.snapshot.entries[id];
    if (entry?.draft && bankMemoSaveReady(entry.composing, 0, true)) this.publish({ ...this.snapshot.entries, [id]: { ...entry, dueAt: this.now() } });
  }
  retry(id: string) {
    const entry = this.snapshot.entries[id];
    if (entry?.draft && entry.status === "failed") this.publish({ ...this.snapshot.entries, [id]: { ...entry, status: "queued", error: undefined, group: undefined, dueAt: this.now() } });
  }
  discard(id: string) {
    const entries = { ...this.snapshot.entries }; delete entries[id];
    this.composing.delete(id); this.blurred.delete(id);
    this.publish(entries); this.finishGroups();
  }
  async discardAll() {
    this.groups.clear(); this.composing.clear(); this.blurred.clear();
    this.publish({});
    // Requests already sent cannot be cancelled; leave only after their outcome is known.
    await this.running;
  }
  receive(rows: BankDisplayRow[]) {
    this.publish(this.snapshot.entries, { ...this.snapshot.rows, ...Object.fromEntries(rows.map((row) => [row.id, row])) });
  }
  clearCompleted() { this.publish(Object.fromEntries(Object.entries(this.snapshot.entries).filter(([, entry]) => entry.status !== "saved"))); }
  beginUndo(ids: string[]) {
    if (ids.some((id) => this.snapshot.drafts[id] || this.snapshot.undoing.includes(id))) return false;
    this.publish(this.snapshot.entries, this.snapshot.rows, [...this.snapshot.undoing, ...ids]);
    return true;
  }
  endUndo(ids: string[]) { this.publish(this.snapshot.entries, this.snapshot.rows, this.snapshot.undoing.filter((id) => !ids.includes(id))); }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.active) return;
    const times = Object.values(this.snapshot.entries).flatMap((entry) => entry.status === "saved" && entry.savedUntil ? [entry.savedUntil] : !this.running && entry.status === "queued" && !entry.composing ? [entry.dueAt] : []);
    if (times.length) this.timer = setTimeout(() => {
      const entries = Object.fromEntries(Object.entries(this.snapshot.entries).filter(([, entry]) => entry.status !== "saved" || (entry.savedUntil || 0) > this.now()));
      this.publish(entries);
      void this.flush();
    }, Math.max(0, Math.min(...times) - this.now()));
  }
  flush() {
    if (this.running) return this.running;
    const batch = nextBankAutosaveBatch(this.snapshot.entries, this.now());
    if (!batch.length) return Promise.resolve();
    this.flight = batch;
    const entries = { ...this.snapshot.entries };
    for (const item of batch) entries[item.id] = { ...entries[item.id], status: "saving", afterSend: {} };
    // Defer dispatch until running is installed, including synchronously resolved test transports.
    this.running = Promise.resolve().then(async () => {
      let result: BankAutosaveResult;
      try { result = await this.options.save(batch.map(({ id, draft }) => ({ id, updatedAt: draft.updatedAt, patch: draft.patch }))); }
      catch (error) { result = { rows: [], failures: batch.map(({ id }) => ({ id, kind: "failed", error: bankAutosaveFailureMessage(error) })) }; }
      const next = { ...this.snapshot.entries }, rows = { ...this.snapshot.rows };
      const group = batch[0].group ? this.groups.get(batch[0].group) : undefined;
      for (const sent of batch) {
        const current = next[sent.id];
        const saved = result.rows.find((row) => row.id === sent.id);
        if (saved) {
          rows[sent.id] = saved;
          const draft = rebaseBankAutosaveDraft(saved, current?.afterSend);
          if (current) next[sent.id] = draft ? { ...current, draft, afterSend: undefined, status: "queued", error: undefined }
            : { status: "saved", dueAt: 0, composing: false, savedUntil: this.now() + 2000 };
          if (group) { group.count++; group.rowIds.push(sent.id); }
        } else {
          const failure = result.failures.find((failure) => failure.id === sent.id);
          if (current) next[sent.id] = { ...current, afterSend: undefined, status: failure?.kind || "failed", error: bankAutosaveFailureMessage(failure?.error, failure?.kind) };
          if (group) group.failed++;
        }
      }
      if (group && result.auditLogId) group.auditIds.push(result.auditLogId);
      this.flight = [];
      this.publish(next, rows);
      this.finishGroups();
    }).finally(() => { this.running = undefined; this.schedule(); });
    this.publish(entries);
    return this.running;
  }
  private finishGroups() {
    for (const [id, group] of this.groups) {
      if (this.flight.some((item) => item.group === id) || Object.values(this.snapshot.entries).some((entry) => entry.group === id && ["queued", "saving"].includes(entry.status))) continue;
      this.groups.delete(id);
      if (group.count || group.failed) this.options.onNotice(group);
    }
  }
}
