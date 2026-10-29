import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForRole } from "@/lib/rbac";
import { RegisterForm } from "./register-form";
import { ThemeToggle } from "@/components/app/theme-toggle";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(defaultPathForRole(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="fixed right-4 top-4"><ThemeToggle compact /></div>
      <RegisterForm />
    </main>
  );
}
