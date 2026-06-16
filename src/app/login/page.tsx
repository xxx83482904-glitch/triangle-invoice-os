import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForRole } from "@/lib/rbac";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(defaultPathForRole(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="fixed top-4 right-4">
        <ThemeToggle compact />
      </div>
      <LoginForm />
    </main>
  );
}
