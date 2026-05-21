import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { compare } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { readData } from "@/lib/store";
import type { User } from "@/lib/types";

const cookieName = "triangle-session";

function secretKey() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? "triangle-invoice-os-local-development-secret",
  );
}

export type SessionUser = Pick<User, "id" | "name" | "email" | "role">;

export async function signIn(email: string, password: string) {
  const data = await readData();
  const user = data.users.find((item) => item.email.toLowerCase() === email.toLowerCase() && !item.deletedAt);
  if (!user) return null;
  const ok = await compare(password, user.passwordHash);
  if (!ok) return null;

  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secretKey());

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return user;
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (!token) return null;

  try {
    const verified = await jwtVerify(token, secretKey());
    const payload = verified.payload as SessionUser;
    const user = (await readData()).users.find((item) => item.id === payload.id && !item.deletedAt);
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
