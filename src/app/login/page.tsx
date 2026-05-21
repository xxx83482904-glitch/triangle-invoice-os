import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "GUEST" ? "/guest-invoices" : "/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <LoginForm />
    </main>
  );
}
