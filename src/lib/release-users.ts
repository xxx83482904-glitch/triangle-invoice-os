import { hashSync } from "bcryptjs";
import type { AppData, UserRole } from "@/lib/types";

export type ReleaseUserSeed = { id: string; name: string; email: string; password: string; role: UserRole; legacyEmails?: string[] };
export const DEMO_EMAILS = ["accounting@triangle.local", "pm@triangle.local", "designer@triangle.local", "guest@triangle.local"];
const LEGACY_ADMIN_EMAIL = "admin@triangle.local";

// Release accounts come from the environment only. A seed counts when both the address and a password of 8+ characters are set.
export function releaseUserSeeds(env: Record<string, string | undefined> = process.env): ReleaseUserSeed[] {
  const seed = (id: string, name: string, role: UserRole, emailKey: string, passwordKey: string, legacyEmails: string[]): ReleaseUserSeed[] => {
    const email = (env[emailKey] || "").trim().toLowerCase(), password = env[passwordKey] || "";
    return email.includes("@") && password.length >= 8 ? [{ id, name, email, password, role, legacyEmails }] : [];
  };
  return [...seed("usr-admin", "Triangle Admin", "ADMIN", "RELEASE_ADMIN_EMAIL", "RELEASE_ADMIN_PASSWORD", [LEGACY_ADMIN_EMAIL]),
    ...seed("usr-mail-miyasaka", "Miyasaka", "MAIL_EDITOR", "RELEASE_MAIL_EDITOR_EMAIL", "RELEASE_MAIL_EDITOR_PASSWORD", [])];
}

// Creates a release user only when no account exists for it (by address, id or legacy address). Existing accounts are
// never renamed, re-roled, restored or password-reset here: that happens through the app. Seed-data demo accounts retire.
export function applyReleaseUsers(data: AppData, seeds: ReleaseUserSeed[], timestamp: string) {
  let changed = false;
  const keep = new Set<string>();
  for (const seed of seeds) {
    const existing = data.users.find((user) => user.email.toLowerCase() === seed.email)
      ?? data.users.find((user) => user.id === seed.id)
      ?? (seed.legacyEmails || []).map((email) => data.users.find((user) => user.email.toLowerCase() === email)).find(Boolean);
    if (existing) { keep.add(existing.id); continue; }
    data.users.unshift({ id: seed.id, name: seed.name, email: seed.email, passwordHash: hashSync(seed.password, 10), role: seed.role, createdAt: timestamp, updatedAt: timestamp });
    keep.add(seed.id); changed = true;
  }
  for (const user of data.users) {
    const email = user.email.toLowerCase();
    if ((DEMO_EMAILS.includes(email) || (email === LEGACY_ADMIN_EMAIL && seeds.length > 0)) && !keep.has(user.id) && !user.deletedAt) { user.deletedAt = timestamp; user.updatedAt = timestamp; changed = true; }
  }
  return changed;
}
