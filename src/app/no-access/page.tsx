import { AppShell } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";

export default async function NoAccessPage() {
  await requireUser();
  return <AppShell><p className="py-8 text-sm">使える機能がありません。管理者に連絡してください。</p></AppShell>;
}
