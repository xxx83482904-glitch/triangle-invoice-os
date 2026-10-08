import "server-only";
import { z } from "zod";
import { assertBankAccess, bankToday, isBankDate, mergeBankMasters, mergeBankTransactions, monthRanges } from "@/lib/banking";
import { bankingError, MoneyForwardClient, MoneyForwardError, moneyForwardConfig } from "@/lib/moneyforward-client";
import { mutateData, readData } from "@/lib/store";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";
import type { BankSyncState } from "@/lib/banking-types";

type Actor = Pick<User, "id" | "role">;
export type BankSyncRequest = { mode: "recent" | "all" | "range"; start?: string; end?: string };
const requestSchema = z.object({ mode: z.enum(["recent", "all", "range"]), start: z.string().optional(), end: z.string().optional() });
const staleMs = 30 * 60 * 1000;
export const bankSyncBusy = (state?: BankSyncState) => state?.status === "RUNNING" && Date.now() - Date.parse(state.updatedAt) < staleMs;
const noUndo = { undoable: false };

function syncState(data: AppData, company: CompanyScope, officeCode: string) {
  if (data.bankSyncStates.some((state) => state.company !== company && state.officeCode === officeCode)) throw new MoneyForwardError("この事業者は別の会社に連携済みです");
  let state = data.bankSyncStates.find((item) => item.company === company);
  if (state && state.officeCode !== officeCode) throw new MoneyForwardError("接続先事業者が変更されています。既存データとの対応を管理者が確認してください");
  if (!state) {
    const timestamp = new Date().toISOString();
    state = { id: `bank-sync-${company}`, company, officeCode, officeName: "", autoSync: false, status: "IDLE", imported: 0, updated: 0, createdAt: timestamp, updatedAt: timestamp };
    data.bankSyncStates.push(state);
  }
  return state;
}

export async function setBankAutoSync(user: Actor, company: CompanyScope, enabled: boolean) {
  assertBankAccess(user, company);
  if (user.role !== "ADMIN" || typeof enabled !== "boolean") throw new Error("管理者のみ変更できます");
  const config = moneyForwardConfig(company);
  if (!config && enabled) throw new Error("連携キーと事業者番号の設定が必要です");
  return mutateData(user.id, "BANK_AUTO_SYNC", "BankSyncState", company, (data) => {
    const live = data.users.find((row) => row.id === user.id && !row.deletedAt);
    if (live?.role !== "ADMIN") throw new Error("管理者のみ変更できます");
    const state = config ? syncState(data, company, config.officeCode) : data.bankSyncStates.find((row) => row.company === company);
    if (!state) throw new Error("連携設定がありません");
    state.autoSync = enabled; state.updatedAt = new Date().toISOString();
    return { enabled };
  }, undefined, noUndo);
}

export async function queueBankSync(company: CompanyScope, input: BankSyncRequest, user?: Actor) {
  if (user) assertBankAccess(user, company);
  const request = requestSchema.parse(input);
  if (request.mode === "range" && (!request.start || !request.end || !isBankDate(request.start) || !isBankDate(request.end) || request.start > request.end || request.end > bankToday())) throw new MoneyForwardError("取得期間を確認してください");
  if (request.mode === "range") monthRanges(request.start!, request.end!);
  const config = moneyForwardConfig(company);
  if (!config) throw new MoneyForwardError("連携キーと事業者番号が未設定です");
  const runId = crypto.randomUUID();
  let resume: { start: string; completedThrough: string } | undefined;
  await mutateData(user?.id || "system-moneyforward", "BANK_SYNC_START", "BankSyncState", company, (data) => {
    if (user) {
      const live = data.users.find((row) => row.id === user.id && !row.deletedAt);
      if (!live) throw new MoneyForwardError("利用者が見つかりません");
      assertBankAccess(live, company);
    }
    const state = syncState(data, company, config.officeCode);
    if (!user && !state.autoSync) throw new MoneyForwardError("自動同期は停止中です");
    if (bankSyncBusy(state)) throw new MoneyForwardError("同期はすでに実行中です");
    if (["ERROR", "RUNNING"].includes(state.status) && state.requestMode === request.mode && state.rangeStart && state.completedThrough && (request.mode !== "range" || (state.rangeStart === request.start && state.rangeEnd === request.end))) {
      resume = { start: state.rangeStart, completedThrough: state.completedThrough };
    }
    Object.assign(state, { runId, requestMode: request.mode, status: "RUNNING", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), imported: 0, updated: 0, error: undefined, rangeStart: resume?.start, rangeEnd: undefined, completedThrough: resume?.completedThrough });
    return { runId };
  }, undefined, noUndo);
  return { company, runId, request, resume, userId: user?.id || "system-moneyforward" };
}

export async function runBankSync(job: Awaited<ReturnType<typeof queueBankSync>>) {
  const { company, runId, request, userId } = job;
  const update = <T>(action: string, callback: (data: AppData, state: BankSyncState) => T) => mutateData(userId, action, "BankSyncState", company, (data) => {
    const state = data.bankSyncStates.find((row) => row.company === company && row.runId === runId);
    if (!state) throw new MoneyForwardError("同期処理が変更されています");
    state.updatedAt = new Date().toISOString();
    return callback(data, state);
  }, undefined, noUndo);
  try {
    const config = moneyForwardConfig(company);
    if (!config) throw new MoneyForwardError("連携設定がありません");
    const client = new MoneyForwardClient(config);
    const office = await client.office();
    const accounts = await client.accounts();
    const categories = await client.categories();
    const earliest = office.accounting_periods.map((period) => period.start_date).sort()[0];
    if (!earliest) throw new MoneyForwardError("取得可能な会計期間がありません");
    const state = (await readData()).bankSyncStates.find((row) => row.company === company);
    const recentStart = state?.lastSuccessAt ? new Date(Date.parse(state.lastSuccessAt) - 90 * 86400000).toISOString().slice(0, 10) : earliest;
    const start = job.resume?.start || (request.mode === "range" ? request.start! : request.mode === "all" ? earliest : recentStart < earliest ? earliest : recentStart);
    const end = request.mode === "range" ? request.end! : bankToday();
    const ranges = monthRanges(start, end).filter((range) => !job.resume || range.end > job.resume.completedThrough);
    await update("BANK_SYNC_MASTERS", (data, current) => {
      if (current.officeCode !== office.code) throw new MoneyForwardError("連携事業者が一致しません");
      mergeBankMasters(data, company, office.code, accounts, categories);
      Object.assign(current, { officeName: office.name, rangeStart: start, rangeEnd: end });
      return { accounts: accounts.length, categories: categories.length, start, end };
    });
    for (const range of ranges) {
      const items = await client.transactions(range.start, range.end);
      await update("BANK_SYNC_MONTH", (data, current) => {
        const result = mergeBankTransactions(data, company, office.code, items, range);
        current.imported += result.imported; current.updated += result.updated; current.completedThrough = range.end;
        return { ...result, through: range.end };
      });
    }
    await update("BANK_SYNC_FINISH", (_data, current) => {
      current.status = "SUCCESS";
      // A historical-only refresh must not advance the incremental watermark.
      if (request.mode !== "range") current.lastSuccessAt = new Date().toISOString();
      return { imported: current.imported, updated: current.updated };
    });
  } catch (error) {
    await update("BANK_SYNC_ERROR", (_data, state) => { state.status = "ERROR"; state.error = bankingError(error); return { error: state.error }; });
  }
}

const scheduler = globalThis as typeof globalThis & { triangleBankTimer?: ReturnType<typeof setTimeout> };
export function startBankScheduler() {
  if (scheduler.triangleBankTimer || !(["JAPAN", "CHINA"] as const).some((company) => moneyForwardConfig(company))) return;
  const tick = async () => {
    try {
      for (const company of ["JAPAN", "CHINA"] as const) {
        if (!moneyForwardConfig(company)) continue;
        const state = (await readData()).bankSyncStates.find((row) => row.company === company);
        if (!state?.autoSync || bankSyncBusy(state)) continue;
        const last = state.status === "ERROR" ? state.updatedAt : state.lastSuccessAt || state.startedAt;
        if (last && Date.now() - Date.parse(last) < 6 * 60 * 60 * 1000) continue;
        await runBankSync(await queueBankSync(company, { mode: "recent" }));
      }
    } catch { /* Persisted job errors are shown in the banking workspace; retry on the next tick. */ }
    finally { scheduler.triangleBankTimer = setTimeout(tick, 60000); scheduler.triangleBankTimer.unref(); }
  };
  scheduler.triangleBankTimer = setTimeout(tick, 60000);
  scheduler.triangleBankTimer.unref();
}
