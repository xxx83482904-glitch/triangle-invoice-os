import type { BankEdit, BankTransaction } from "@/lib/banking-types";

export type BankSaveScope = "selected" | "reviewed" | "edited";
export type BankDraft = BankEdit & { patch: Partial<BankEdit> };
export type BankDrafts = Record<string, BankDraft>;
export type BankSaveChange = { before: BankTransaction; after: BankEdit; prediction: boolean };

export function bankEditFrom(row: BankTransaction | BankEdit): BankEdit {
  return { id: row.id, updatedAt: row.updatedAt, categoryId: row.categoryId, subCategoryId: row.subCategoryId,
    treatment: row.treatment, reviewed: row.reviewed, memo: row.memo, classificationSource: row.classificationSource,
    classificationReason: row.classificationReason, classificationConfidence: row.classificationConfidence };
}

export function patchBankDraft(drafts: BankDrafts, row: BankTransaction, patch: Partial<BankEdit>): BankDraft {
  const previous = drafts[row.id];
  return { ...(previous || bankEditFrom(row)), ...patch, id: row.id, updatedAt: previous?.updatedAt || row.updatedAt,
    patch: { ...previous?.patch, ...patch } };
}

// The patch is applied to persisted data, never to an automatically predicted display row.
export function bankSaveChanges(originals: BankTransaction[], displayed: BankTransaction[], drafts: BankDrafts, selected: Set<string>, scope: BankSaveScope): BankSaveChange[] {
  const shown = new Map(displayed.map((row) => [row.id, row]));
  return originals.flatMap((before) => {
    const draft = drafts[before.id];
    const row = shown.get(before.id);
    if (scope === "selected" ? !selected.has(before.id) : !draft || (scope === "reviewed" && !draft.reviewed)) return [];
    if (!draft && (!row || !(row as BankTransaction & { predictionPending?: boolean }).predictionPending)) return [];
    const version = draft?.updatedAt || row?.updatedAt;
    const after = draft ? { ...bankEditFrom(before), ...draft.patch, id: before.id, updatedAt: before.updatedAt } : bankEditFrom(row!);
    // A lost response can be recovered without sending an already-applied edit again.
    if (Object.keys(after).filter((key) => !["id", "updatedAt", "classificationSource"].includes(key)).every((key) => after[key as keyof BankEdit] === bankEditFrom(before)[key as keyof BankEdit])) return [];
    if (version !== before.updatedAt) throw new Error(`${before.content || before.id}: 明細が更新されています。編集を保持して最新状態を確認し、該当行の編集を破棄してやり直してください`);
    if (after.reviewed && before.bookkeeping?.hold) throw new Error(`${before.content}: 保留を解消してから確認済みにしてください`);
    if (before.bookkeeping?.splits?.length && (after.categoryId || after.subCategoryId || after.treatment !== before.treatment)) throw new Error(`${before.content}: 科目分割の内訳は記帳詳細から変更してください`);
    return [{ before, after, prediction: !draft }];
  });
}

export function bankSaveIds(displayed: BankTransaction[], drafts: BankDrafts, selected: Set<string>, scope: BankSaveScope) {
  if (scope === "selected") {
    const predictions = new Set(displayed.filter((row) => (row as BankTransaction & { predictionPending?: boolean }).predictionPending).map((row) => row.id));
    return [...selected].filter((id) => drafts[id] || predictions.has(id));
  }
  return Object.values(drafts).filter((row) => scope !== "reviewed" || row.reviewed).map((row) => row.id);
}

export function removeSavedBankDrafts(drafts: BankDrafts, saved: BankEdit[]) {
  const next = { ...drafts };
  for (const edit of saved) delete next[edit.id];
  return next;
}

export function bankMatchingSelection(rows: BankTransaction[], explicitlySelected: Set<string>) {
  return new Set(rows.filter((row) => (row.treatment !== "EXCLUDED" && row.sourceStatus !== "excluded") || explicitlySelected.has(row.id)).map((row) => row.id));
}

export const BANK_RENDER_WINDOW = 50;
export function bankRenderWindow<T>(rows: T[], start: number) {
  const offset = Math.min(Math.max(0, Math.floor(start / BANK_RENDER_WINDOW) * BANK_RENDER_WINDOW), Math.max(0, Math.floor((rows.length - 1) / BANK_RENDER_WINDOW) * BANK_RENDER_WINDOW));
  return { offset, rows: rows.slice(offset, offset + BANK_RENDER_WINDOW), end: Math.min(offset + BANK_RENDER_WINDOW, rows.length) };
}
