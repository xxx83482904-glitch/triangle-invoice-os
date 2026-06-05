import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForRole } from "@/lib/rbac";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(defaultPathForRole(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <RegisterForm />
    </main>
  );
}
