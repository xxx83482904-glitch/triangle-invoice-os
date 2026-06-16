import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForRole } from "@/lib/rbac";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? defaultPathForRole(user.role) : "/login");
}
