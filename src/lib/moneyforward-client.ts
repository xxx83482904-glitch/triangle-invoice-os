import "server-only";
import { z } from "zod";
import type { CompanyScope } from "@/lib/company";
import { isBankDate, type ImportedAccount, type ImportedCategory, type ImportedTransaction } from "@/lib/banking";

const sourceId = z.string().min(1).max(1000);
const date = z.string().refine(isBankDate);
const nullableId = sourceId.nullish();
const masterSchema = z.object({
  connected_accounts: z.array(z.object({ id: sourceId, name: z.string(), is_manual: z.boolean(), connected_sub_accounts: z.array(z.object({ id: sourceId, name: z.string() })).nullish() })),
});
const categoriesSchema = z.object({ accounts: z.array(z.object({ id: sourceId, name: z.string(), account_group: z.string(), available: z.boolean(), sub_accounts: z.array(z.object({ id: sourceId, name: z.string() })).nullish() })) });
const transactionsSchema = z.object({
  transactions: z.array(z.object({ id: sourceId, date, value: z.number().int().nonnegative().safe(), side: z.enum(["INCOME", "EXPENSE"]), content: z.string(), memo: z.string().nullish(), journalizing_status: z.string(), connected_account_id: sourceId, connected_sub_account_id: nullableId })).max(500),
  metadata: z.object({ total_count: z.number().int().nonnegative(), total_pages: z.number().int().nonnegative() }),
});
const officeSchema = z.object({ code: z.string(), name: z.string(), accounting_periods: z.array(z.object({ start_date: date, end_date: date })) });
const tokenSchema = z.object({ access_token: z.string().min(1), token_type: z.literal("Bearer"), expires_in: z.number().int().positive() });

export class MoneyForwardError extends Error {}
export type MoneyForwardConfig = { apiKey: string; officeCode: string };
export function moneyForwardConfig(company: CompanyScope): MoneyForwardConfig | null {
  if (!["JAPAN", "CHINA"].includes(company)) return null;
  const apiKey = process.env[`MONEYFORWARD_${company}_API_KEY`]?.trim();
  const officeCode = process.env[`MONEYFORWARD_${company}_OFFICE_CODE`]?.trim();
  return apiKey && /^\d{4}-\d{4}$/.test(officeCode || "") ? { apiKey, officeCode: officeCode! } : null;
}

export function bankingError(error: unknown) {
  if (error instanceof MoneyForwardError) return error.message;
  if (error instanceof z.ZodError) return "マネーフォワードの応答形式が一致しません。同期は完了していません";
  return "同期に失敗しました。接続状況を確認して再実行してください";
}

export class MoneyForwardClient {
  private token?: { value: string; expiresAt: number };
  private deadline = Date.now() + 20 * 60 * 1000;
  constructor(private config: MoneyForwardConfig, private fetcher: typeof fetch = fetch, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  private async request(url: string, authorization: string, method: "GET" | "POST") {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > this.deadline) throw new MoneyForwardError("同期の制限時間に達しました。保存済みの月は保持されています。再同期してください");
      let response: Response;
      try { response = await this.fetcher(url, { method, headers: { Authorization: `Bearer ${authorization}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000) }); }
      catch { throw new MoneyForwardError("マネーフォワードとの通信が中断されました。再同期してください"); }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const seconds = Number(response.headers.get("retry-after"));
        await this.sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10000) : (attempt + 1) * 1500);
        continue;
      }
      return response;
    }
    throw new MoneyForwardError("マネーフォワードへの接続に失敗しました");
  }

  private fail(status: number): never {
    const message = status === 401 ? "連携キーが無効または失効しています。管理者が接続設定を確認してください" : status === 403 ? "マネーフォワードの閲覧権限が不足しています" : status === 429 ? "APIの利用制限に達しました。時間をおいて再同期してください" : "マネーフォワードから明細を取得できませんでした";
    throw new MoneyForwardError(message);
  }
  private async json(response: Response) {
    if (!response.ok) this.fail(response.status);
    const text = await response.text();
    if (text.length > 10 * 1024 * 1024) throw new MoneyForwardError("APIの応答が大きすぎます");
    try { return JSON.parse(text) as unknown; } catch { throw new MoneyForwardError("APIの応答形式が不正です"); }
  }
  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60000) return this.token.value;
    const result = tokenSchema.parse(await this.json(await this.request("https://api.biz.moneyforward.com/auth/exchange", this.config.apiKey, "POST")));
    this.token = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
    return result.access_token;
  }
  private async get(path: "offices" | "connected_accounts" | "accounts" | "transactions", params: Record<string, string> = {}) {
    const url = new URL(`https://api-accounting.moneyforward.com/api/v3/${path}`);
    url.search = new URLSearchParams({ ...params, office_code: this.config.officeCode }).toString();
    let response = await this.request(url.toString(), await this.accessToken(), "GET");
    if (response.status === 401) {
      this.token = undefined;
      response = await this.request(url.toString(), await this.accessToken(), "GET");
    }
    return this.json(response);
  }
  async office() {
    const office = officeSchema.parse(await this.get("offices"));
    if (office.code !== this.config.officeCode) throw new MoneyForwardError("対象事業者が接続設定と一致しません");
    return office;
  }
  async accounts(): Promise<ImportedAccount[]> {
    const response = masterSchema.parse(await this.get("connected_accounts"));
    return response.connected_accounts.flatMap((account) => [
      { id: account.id, name: account.name, serviceName: account.name, isManual: account.is_manual },
      ...(account.connected_sub_accounts || []).map((sub) => ({ id: account.id, subId: sub.id, name: `${account.name} / ${sub.name}`, serviceName: account.name, isManual: account.is_manual })),
    ]);
  }
  async categories(): Promise<ImportedCategory[]> {
    const response = categoriesSchema.parse(await this.get("accounts"));
    return response.accounts.flatMap((account) => [
      { id: account.id, name: account.name, group: account.account_group, available: account.available },
      ...(account.sub_accounts || []).map((sub) => ({ id: sub.id, parentSourceId: account.id, name: sub.name, group: account.account_group, available: account.available })),
    ]);
  }
  async transactions(start: string, end: string): Promise<ImportedTransaction[]> {
    if (!isBankDate(start) || !isBankDate(end) || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new MoneyForwardError("APIの取得期間が不正です");
    const result: ImportedTransaction[] = [];
    const ids = new Set<string>();
    let expectedCount = -1, expectedPages = -1;
    for (let page = 1; page <= 200; page++) {
      const response = transactionsSchema.parse(await this.get("transactions", { start_date: start, end_date: end, order: "asc", per_page: "500", page: String(page) }));
      if (page === 1) { expectedCount = response.metadata.total_count; expectedPages = response.metadata.total_pages; }
      if (response.metadata.total_count !== expectedCount || response.metadata.total_pages !== expectedPages || expectedPages > 200) throw new MoneyForwardError("取得中に明細が変わったか、件数の上限を超えました。再同期してください");
      for (const row of response.transactions) {
        if (ids.has(row.id) || row.date < start || row.date > end) throw new MoneyForwardError("明細取得に重複または範囲外データがあります。再同期してください");
        ids.add(row.id); result.push(row);
      }
      if (page >= expectedPages) {
        if (result.length !== expectedCount) throw new MoneyForwardError("すべての明細を取得できませんでした。再同期してください");
        return result;
      }
    }
    throw new MoneyForwardError("明細の取得件数が上限を超えました");
  }
}
