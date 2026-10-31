"use client";

import { useActionState } from "react";
import { KeyRound, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentTokenView } from "@/lib/agent-tokens";
import { createAgentTokenAction, revokeAgentTokenAction } from "./actions";

const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const statusLabel = { ACTIVE: "有効", EXPIRED: "期限切れ", REVOKED: "取消済み" } as const;

// The plain token is shown exactly once, from the action result, and never stored or logged.
export function AgentTokens({ tokens, users, scopes }: { tokens: AgentTokenView[]; users: Array<{ id: string; name: string; role: string }>; scopes: Array<{ value: string; label: string }> }) {
  const [state, action, pending] = useActionState(createAgentTokenAction, { error: "" });
  const [revokeState, revoke, revoking] = useActionState(revokeAgentTokenAction, { error: "" });
  return <section className="mt-8 min-w-0 space-y-4" aria-labelledby="agent-tokens">
    <div><h2 id="agent-tokens" className="text-base font-semibold">エージェント用 API トークン</h2><p className="text-sm text-muted-foreground">外部のエージェントやスクリプトが `/api/agent/v1` を使うためのトークンです。権限は利用者の権限とスコープの両方に含まれる範囲だけで、日本版のデータに限られます。平文は発行時に一度だけ表示され、保存されません。</p></div>
    <form action={action} className="grid min-w-0 gap-3 rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-xs">名前<Input name="name" required maxLength={100} placeholder="例: 月次仕訳エージェント" className="h-11" disabled={pending} /></label>
        <label className="grid min-w-0 gap-1 text-xs">利用者（権限の上限）<select name="userId" className={selectClass} disabled={pending} defaultValue={users[0]?.id}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}（{user.role}）</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-xs">有効期間<select name="expiresInDays" className={selectClass} disabled={pending} defaultValue="90"><option value="30">30日</option><option value="90">90日</option><option value="180">180日</option><option value="365">365日</option></select></label>
      </div>
      <fieldset className="grid gap-1 text-sm sm:grid-cols-2"><legend className="mb-1 text-xs">スコープ</legend>{scopes.map((scope) => <label key={scope.value} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="scopes" value={scope.value} className="size-4 accent-primary" disabled={pending} defaultChecked={scope.value.endsWith(":read")} /><span className="min-w-0 break-words"><code className="text-xs">{scope.value}</code> {scope.label}</span></label>)}</fieldset>
      <div className="flex flex-wrap items-center gap-2"><Button disabled={pending} className="h-11 lg:h-9"><KeyRound className="size-4" />トークンを発行</Button>{state.error ? <p role="alert" className="break-words text-sm text-destructive">{state.error}</p> : null}</div>
      {state.plain ? <div role="status" className="space-y-1 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-700 dark:bg-emerald-950"><p className="font-medium">発行しました。この値は今だけ表示されます。安全な場所に保存してください。</p><Input readOnly value={state.plain} className="h-11 font-mono text-xs" aria-label="発行したトークン" onFocus={(event) => event.currentTarget.select()} /></div> : null}
    </form>
    <div className="divide-y border-y">
      {tokens.length ? tokens.map((token) => <div key={token.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 space-y-0.5"><div className="break-words font-medium">{token.name} <code className="text-xs text-muted-foreground">{token.prefix}…</code></div><div className="break-words text-xs text-muted-foreground">{token.userName} / {token.scopes.join(", ")} / 期限 {token.expiresAt.slice(0, 10)}{token.lastUsedAt ? ` / 最終利用 ${token.lastUsedAt.slice(0, 16).replace("T", " ")}` : " / 未使用"}</div></div>
        <div className="flex items-center gap-2 text-sm"><span>{statusLabel[token.status]}</span>{token.status === "ACTIVE" ? <form action={revoke}><input type="hidden" name="id" value={token.id} /><input type="hidden" name="updatedAt" value={token.updatedAt} /><Button variant="outline" className="h-11 lg:h-9" disabled={revoking}><Ban className="size-4" />取り消す</Button></form> : null}</div>
      </div>) : <p className="py-6 text-sm text-muted-foreground">発行済みのトークンはありません。</p>}
    </div>
    {revokeState.error ? <p role="alert" className="break-words text-sm text-destructive">{revokeState.error}</p> : null}
  </section>;
}
