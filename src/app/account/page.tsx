import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { OwnPasswordForm } from "./password-form";

// Every signed-in person, whatever their role, can change their own password here.
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  return <AppShell>
    <PageHeader title="アカウント" description={`${user.name}（${user.email}）のパスワードを変更します。`} />
    <section aria-labelledby="own-password" className="space-y-3">
      <h2 id="own-password" className="text-base font-medium">パスワードの変更</h2>
      <OwnPasswordForm />
    </section>
  </AppShell>;
}
