import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultPathForUser } from "@/lib/app-navigation";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? defaultPathForUser(user) : "/login");
}
