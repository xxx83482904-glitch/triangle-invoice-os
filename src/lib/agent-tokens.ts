import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ApiToken, ApiTokenScope, AppData, User } from "@/lib/types";
import { can } from "@/lib/rbac";
import { isActiveUser } from "@/lib/user-access";

type Actor = Pick<User, "id" | "role">;

// A token can never do more than the person it belongs to: effective rights are role permissions ∩ scopes.
export const agentScopes: Record<ApiTokenScope, { label: string; permission: string }> = {
  "bank:read": { label: "明細・書類・照合・支払記録の読み取り", permission: "view:banking" },
  "integrity:read": { label: "整合性チェックの読み取り", permission: "view:banking" },
  "bank:write": { label: "明細の分類・確認・記帳メモ", permission: "manage:banking" },
  "reconcile:write": { label: "銀行・請求書照合の確定・解除・維持", permission: "manage:banking" },
  "payments:write": { label: "支払・入金記録の登録・修正・取消", permission: "view:payments" },
  "received:write": { label: "受領請求書の項目修正", permission: "manage:receivedInvoices" },
  "mail:write": { label: "郵便物の連携・解除", permission: "manage:mailSorter" },
  "partners:write": { label: "支払先・案件の作成", permission: "manage:vendors" },
};
export const agentScopeList = Object.keys(agentScopes) as ApiTokenScope[];
export const AGENT_TOKEN_PREFIX = "tri_";
export const hashAgentToken = (plain: string) => createHash("sha256").update(plain).digest("hex");

// The plain token exists only in the caller's hands: the store keeps the hash and a display prefix.
export function generateAgentTokenSecret() {
  const plain = `${AGENT_TOKEN_PREFIX}${randomBytes(30).toString("base64url")}`;
  return { plain, hash: hashAgentToken(plain), prefix: plain.slice(0, 12) };
}

const issueSchema = z.object({
  userId: z.string().min(1).max(200).optional(), name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(agentScopeList as [ApiTokenScope, ...ApiTokenScope[]])).min(1), expiresInDays: z.number().int().min(1).max(365),
  hash: z.string().length(64), prefix: z.string().min(8).max(16),
});
export type IssueAgentTokenInput = z.input<typeof issueSchema>;

export function issueAgentToken(data: AppData, actor: Actor, input: IssueAgentTokenInput, now = new Date()) {
  if (!can(actor, "manage:users")) throw new Error("権限がありません");
  const value = issueSchema.parse(input);
  const user = data.users.find((row) => row.id === (value.userId || actor.id) && isActiveUser(row));
  if (!user) throw new Error("利用者が見つかりません");
  const missing = value.scopes.filter((scope) => !can(user, agentScopes[scope].permission));
  if (missing.length) throw new Error(`この利用者の権限では付与できないスコープがあります: ${missing.join(", ")}`);
  if ((data.apiTokens || []).some((row) => row.tokenHash === value.hash)) throw new Error("トークンを再生成してください");
  const timestamp = now.toISOString();
  const token: ApiToken = { id: randomUUID(), userId: user.id, name: value.name, tokenHash: value.hash, prefix: value.prefix, scopes: [...new Set(value.scopes)], company: "JAPAN",
    expiresAt: new Date(now.getTime() + value.expiresInDays * 86400000).toISOString(), createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
  data.apiTokens = [token, ...(data.apiTokens || [])];
  return { id: token.id, prefix: token.prefix, expiresAt: token.expiresAt };
}

export function revokeAgentToken(data: AppData, actor: Actor, id: string, updatedAt: string, now = new Date()) {
  if (!can(actor, "manage:users")) throw new Error("権限がありません");
  const token = (data.apiTokens || []).find((row) => row.id === id);
  if (!token || token.updatedAt !== updatedAt) throw new Error("トークンが更新されています。画面を更新してください");
  if (token.revokedAt) throw new Error("すでに取り消されています");
  token.revokedAt = now.toISOString(); token.updatedAt = token.revokedAt;
  return { id: token.id };
}

export type AgentAuth = { token: ApiToken; user: User };
export type AgentVerification = { ok: true; auth: AgentAuth } | { ok: false; status: 401 | 403; error: string };

export function verifyAgentToken(data: AppData, authorization: string | null | undefined, now = new Date()): AgentVerification {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || "");
  if (!match || !match[1].startsWith(AGENT_TOKEN_PREFIX)) return { ok: false, status: 401, error: "Authorization: Bearer <token> が必要です" };
  const hash = Buffer.from(hashAgentToken(match[1]));
  const token = (data.apiTokens || []).find((row) => { const stored = Buffer.from(row.tokenHash); return stored.length === hash.length && timingSafeEqual(stored, hash); });
  if (!token) return { ok: false, status: 401, error: "トークンが無効です" };
  if (token.revokedAt) return { ok: false, status: 401, error: "トークンは取り消されています" };
  if (token.expiresAt <= now.toISOString()) return { ok: false, status: 401, error: "トークンの有効期限が切れています" };
  const user = data.users.find((row) => row.id === token.userId && isActiveUser(row));
  if (!user) return { ok: false, status: 403, error: "トークンの利用者が無効です" };
  if (token.company !== "JAPAN") return { ok: false, status: 403, error: "このトークンの会社スコープは利用できません" };
  return { ok: true, auth: { token, user } };
}

export const agentCan = (auth: AgentAuth, scope: ApiTokenScope) => auth.token.scopes.includes(scope) && can(auth.user, agentScopes[scope].permission);

export function touchAgentToken(data: AppData, tokenId: string, now = new Date()) {
  const token = (data.apiTokens || []).find((row) => row.id === tokenId);
  if (token) token.lastUsedAt = now.toISOString();
}

export type AgentTokenView = { id: string; updatedAt: string; name: string; prefix: string; userId: string; userName: string; scopes: ApiTokenScope[]; expiresAt: string; lastUsedAt?: string; revokedAt?: string | null; status: "ACTIVE" | "EXPIRED" | "REVOKED"; createdAt: string };
export function agentTokenViews(data: AppData, now = new Date()): AgentTokenView[] {
  const users = new Map(data.users.map((row) => [row.id, row.name]));
  return (data.apiTokens || []).map((token) => ({ id: token.id, updatedAt: token.updatedAt, name: token.name, prefix: token.prefix, userId: token.userId, userName: users.get(token.userId) || token.userId, scopes: token.scopes, expiresAt: token.expiresAt, lastUsedAt: token.lastUsedAt, revokedAt: token.revokedAt, createdAt: token.createdAt,
    status: token.revokedAt ? "REVOKED" : token.expiresAt <= now.toISOString() ? "EXPIRED" : "ACTIVE" }));
}
