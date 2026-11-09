import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { can, defaultPathForRole, roleLabel } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { approvalRoles, isActiveUser } from "@/lib/user-access";
import { editableRoles, userAccountViews } from "@/lib/user-admin";
import { Badge } from "@/components/ui/badge";
import { ApprovalForm } from "./approval-form";
import { AgentTokens } from "./agent-tokens";
import { agentScopes, agentTokenViews } from "@/lib/agent-tokens";
import { cardAccountLabel, companyCardAccounts } from "@/lib/card-receipts";
import { CompanyCardForm } from "./company-card-form";
import { UserAccountEditor } from "./user-account-editor";

export default async function UsersPage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  if (!can(actor, "manage:users")) redirect(defaultPathForRole(actor.role));
  const data = await readDataForRequest();
  const users = data.users.filter((user) => !user.deletedAt);
  const pending = users.filter((user) => user.accessStatus === "PENDING");
  const roles = approvalRoles.map((value) => ({ value, label: roleLabel(value) }));
  const accountRoles = editableRoles.map((value) => ({ value, label: roleLabel(value) }));
  const accounts = userAccountViews(data);
  const activeUsers = users.filter(isActiveUser);
  const activeUserIds = new Set(activeUsers.map((user) => user.id));
  const tokens = agentTokenViews(data);
  const tokenUsers = activeUsers.map((user) => ({ id: user.id, name: user.name, role: roleLabel(user.role) }));
  const cards = companyCardAccounts(data, "JAPAN").map((account) => ({ id: account.id, label: cardAccountLabel(account),
    holder: users.find((user) => user.companyCardAccountId === account.id)?.name || "" }));
  const scopes = Object.entries(agentScopes).map(([value, meta]) => ({ value, label: meta.label }));

  return <AppShell>
    <PageHeader title="利用者管理" />
    <section className="mb-8 min-w-0" aria-labelledby="pending-users">
      <h2 id="pending-users" className="mb-3 text-base font-semibold">承認待ち {pending.length}件</h2>
      <div className="space-y-2">
        {pending.length ? pending.map((user) => <div key={user.id} className="record-card grid min-w-0 gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <div className="min-w-0 space-y-1">
            <div className="break-words font-medium">{user.name}</div>
            <div className="break-all text-sm text-muted-foreground">{user.email}</div>
            <div className="text-xs text-muted-foreground">申請日 {user.createdAt.slice(0, 10)}</div>
          </div>
          <ApprovalForm id={user.id} updatedAt={user.updatedAt} roles={roles} />
        </div>) : <p className="py-6 text-sm text-muted-foreground">承認待ちの申請はありません。</p>}
      </div>
    </section>
    <section aria-labelledby="registered-users">
      <h2 id="registered-users" className="mb-1 text-base font-semibold">登録済み利用者</h2>
      {cards.length ? <p className="mb-3 text-sm text-muted-foreground">会社カードを登録した人は、スマホの経費精算で「会社カードで払った」を選んで領収書をカードの利用に付けられます。</p> : null}
      <div className="space-y-2">
        {accounts.map((user) => <div key={user.id} className="record-card flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{user.name}</span>
              {user.status !== "ACTIVE" ? <Badge variant="secondary" className="bg-muted font-normal text-muted-foreground">{user.status === "DISABLED" ? "停止中" : "申請却下"}</Badge> : null}
            </div>
            <div className="break-all text-sm text-muted-foreground">{user.email}</div>
            <div className="text-sm">{user.roleLabel}</div>
            {user.passwordChangedAt ? <div className="text-xs text-muted-foreground">パスワード変更 {user.passwordChangedAt.slice(0, 10)}</div> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {activeUserIds.has(user.id) && user.role !== "GUEST" && cards.length ? <CompanyCardForm key={`${user.id}:${user.companyCardAccountId || ""}`} userId={user.id} accountId={user.companyCardAccountId || ""} cards={cards} /> : null}
            <UserAccountEditor user={user} actorId={actor.id} roles={accountRoles} />
          </div>
        </div>)}
      </div>
    </section>
    <AgentTokens tokens={tokens} users={tokenUsers} scopes={scopes} />
  </AppShell>;
}
