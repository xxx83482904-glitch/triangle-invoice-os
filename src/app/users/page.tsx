import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { can, defaultPathForRole, roleLabel } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { approvalRoles } from "@/lib/user-access";
import { ApprovalForm } from "./approval-form";

export default async function UsersPage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  if (!can(actor, "manage:users")) redirect(defaultPathForRole(actor.role));
  const data = await readDataForRequest();
  const users = data.users.filter((user) => !user.deletedAt);
  const pending = users.filter((user) => user.accessStatus === "PENDING");
  const roles = approvalRoles.map((value) => ({ value, label: roleLabel(value) }));

  return <AppShell>
    <PageHeader title="利用者管理" />
    <section className="mb-8 min-w-0" aria-labelledby="pending-users">
      <h2 id="pending-users" className="mb-3 text-base font-semibold">承認待ち {pending.length}件</h2>
      <div className="divide-y border-y">
        {pending.length ? pending.map((user) => <div key={user.id} className="grid min-w-0 gap-3 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
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
      <h2 id="registered-users" className="mb-3 text-base font-semibold">登録済み利用者</h2>
      <div className="divide-y border-y">
        {users.filter((user) => user.accessStatus !== "PENDING").map((user) => <div key={user.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><div className="break-words font-medium">{user.name}</div><div className="break-all text-sm text-muted-foreground">{user.email}</div></div>
          <div className="text-sm">{user.accessStatus === "REJECTED" ? "申請却下" : roleLabel(user.role)}</div>
        </div>)}
      </div>
    </section>
  </AppShell>;
}
