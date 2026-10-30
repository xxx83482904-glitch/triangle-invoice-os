import type { BankDisplayRow } from "@/lib/banking";

export function mergeBankWorkspaceRows(...sources: BankDisplayRow[][]) {
  const rows = new Map<string, BankDisplayRow>();
  for (const source of sources) for (const row of source) {
    const previous = rows.get(row.id);
    if (!previous || row.updatedAt >= previous.updatedAt) rows.set(row.id, row);
  }
  return [...rows.values()];
}

export function bankWorkspaceRevision(propsRevision: string, stream: { revision: string; baseRevision: string }) {
  return propsRevision === stream.baseRevision ? stream.revision : propsRevision;
}

export class BankLoadGuard {
  private generation = 0;
  private active: number | null = null;

  begin() {
    if (this.active !== null) return null;
    this.active = ++this.generation;
    return this.active;
  }
  isCurrent(token: number) { return this.active === token && token === this.generation; }
  finish(token: number) {
    if (!this.isCurrent(token)) return false;
    this.active = null;
    return true;
  }
  invalidate() { this.generation++; this.active = null; }
}
