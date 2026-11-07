import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForRole } from "@/lib/rbac";
import { safeNextPath } from "@/lib/safe-next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, next = safeNextPath(typeof params.next === "string" ? params.next : "");
  const user = await getCurrentUser();
  if (user) redirect(next || defaultPathForRole(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="fixed top-4 right-4">
        <ThemeToggle compact />
      </div>
      <LoginForm next={next} />
    </main>
  );
}
