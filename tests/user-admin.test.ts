import test from "node:test";
import assert from "node:assert/strict";
import { editableRoles, endUserSessions, updateUserAccount, userAccountPasswordSchema, userAccountViews } from "../src/lib/user-admin";
import { isActiveUser, sessionVersionMatches } from "../src/lib/user-access";
import { roleLabel } from "../src/lib/rbac";
import type { AppData, User } from "../src/lib/types";
import { fixture, timestamp } from "./document-fixture";

const admin: User = { id: "test-admin", name: "Synthetic Admin", email: "admin@example.invalid", passwordHash: "test-only-admin-hash", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp };
const staff: User = { ...admin, id: "test-staff", name: "Synthetic Staff", email: "staff@example.invalid", passwordHash: "test-only-staff-hash", role: "DESIGNER" };
type UpdateInput = Parameters<typeof updateUserAccount>[2];

function setup(patch: Partial<User> = {}) {
  const data = fixture();
  const user = { ...staff, ...patch };
  data.users = [{ ...admin }, user];
  return { data, user };
}

function edit(user: User, patch: Partial<UpdateInput> = {}): UpdateInput {
  return { id: user.id, updatedAt: user.updatedAt, name: user.name, email: user.email, role: user.role,
    status: user.accessStatus === "DISABLED" || user.accessStatus === "REJECTED" ? user.accessStatus : "ACTIVE", ...patch };
}

function rejectsUnchanged(data: AppData, run: () => unknown, message?: RegExp) {
  const before = structuredClone(data);
  if (message) assert.throws(run, message);
  else assert.throws(run);
  assert.deepEqual(data, before);
}

test("account views sort active, disabled and rejected users by name and expose only display fields", () => {
  const { data } = setup();
  const make = (id: string, name: string, patch: Partial<User> = {}): User => ({ ...staff, id, name, email: `${id}@example.invalid`, ...patch });
  data.users = [
    make("rejected", "A Rejected", { accessStatus: "REJECTED" }),
    make("disabled-z", "Z Disabled", { accessStatus: "DISABLED" }),
    make("active-z", "Z Active", { accessStatus: "ACTIVE", sessionVersion: 4 }),
    make("pending", "A Pending", { accessStatus: "PENDING" }),
    make("legacy", "A Legacy", { approvedAt: timestamp, passwordChangedAt: timestamp, companyCardAccountId: "test-card", sessionVersion: 2 }),
    make("disabled-a", "A Disabled", { accessStatus: "DISABLED" }),
    make("deleted", "A Deleted", { deletedAt: timestamp }),
  ];
  const before = structuredClone(data);
  const views = userAccountViews(data);
  assert.deepEqual(views.map((view) => view.id), ["legacy", "active-z", "disabled-a", "disabled-z", "rejected"]);
  assert.deepEqual(views[0], { id: "legacy", name: "A Legacy", email: "legacy@example.invalid", role: "DESIGNER", roleLabel: roleLabel("DESIGNER"), status: "ACTIVE",
    updatedAt: timestamp, createdAt: timestamp, approvedAt: timestamp, passwordChangedAt: timestamp, companyCardAccountId: "test-card" });
  for (const view of views) {
    assert.deepEqual(Object.keys(view).sort(), ["id", "name", "email", "role", "roleLabel", "status", "updatedAt", "createdAt", "approvedAt", "passwordChangedAt", "companyCardAccountId"].sort());
  }
  assert.deepEqual(data, before);
});

test("edits normalize name and email, preserve unrelated fields, and return a safe audit summary", () => {
  const { data, user } = setup({ companyCardAccountId: "test-card" });
  const result = updateUserAccount(data, admin.id, edit(user, { name: "  Synthetic Renamed  ", email: "  RENAMED@EXAMPLE.INVALID  ", role: "ACCOUNTING" }));
  assert.deepEqual(result, {
    id: staff.id,
    before: { name: staff.name, email: staff.email, role: "DESIGNER", status: "ACTIVE" },
    after: { name: "Synthetic Renamed", email: "renamed@example.invalid", role: "ACCOUNTING", status: "ACTIVE" },
    passwordChanged: false, sessionsEnded: false,
  });
  assert.equal(user.name, result.after.name); assert.equal(user.email, result.after.email); assert.equal(user.role, "ACCOUNTING");
  assert.equal(user.passwordHash, staff.passwordHash); assert.equal(user.passwordChangedAt, undefined); assert.equal(user.sessionVersion, undefined);
  assert.equal(user.companyCardAccountId, "test-card"); assert.equal(user.createdAt, timestamp);
  assert.ok(Date.parse(user.updatedAt) > Date.parse(timestamp));
  assert.doesNotMatch(JSON.stringify(result), /passwordHash|test-only|sessionVersion/);
});

test("every editable role is accepted in the requested order", () => {
  assert.deepEqual(editableRoles, ["ADMIN", "ACCOUNTING", "CHIEF_DESIGNER", "PROJECT_MANAGER", "BILLING_EDITOR", "MAIL_EDITOR", "DESIGNER", "GUEST"]);
  for (const role of editableRoles) {
    const { data, user } = setup();
    updateUserAccount(data, admin.id, edit(user, { role }));
    assert.equal(user.role, role);
  }
});

test("stale versions, unknown, deleted and pending targets fail without mutation for both operations", () => {
  const { data, user } = setup();
  rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(user, { updatedAt: "stale" })), /この利用者は別の画面で変更されています。再読み込みしてください。/);
  rejectsUnchanged(data, () => endUserSessions(data, admin.id, { id: user.id, updatedAt: "stale" }), /この利用者は別の画面で変更されています。再読み込みしてください。/);
  for (const patch of [{ id: "missing" }, { id: "" }]) {
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(user, patch)));
    rejectsUnchanged(data, () => endUserSessions(data, admin.id, { id: patch.id, updatedAt: user.updatedAt }));
  }
  for (const patch of [{ deletedAt: timestamp }, { accessStatus: "PENDING" as const }]) {
    const target = setup(patch);
    rejectsUnchanged(target.data, () => updateUserAccount(target.data, admin.id, edit(target.user)));
    rejectsUnchanged(target.data, () => endUserSessions(target.data, admin.id, target.user));
  }
});

test("invalid input is rejected before any write, even when a password hash is supplied", () => {
  for (const patch of [
    { name: "   " }, { name: "x".repeat(101) }, { email: "invalid" }, { email: `${"x".repeat(240)}@example.invalid` },
    { role: "INVALID" as User["role"] }, { status: "PENDING" as UpdateInput["status"] }, { updatedAt: "" },
  ]) {
    const { data, user } = setup();
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(user, { ...patch, passwordHash: "test-only-new-hash" })));
  }
});

test("email uniqueness is case insensitive and includes deleted, pending and disabled users", () => {
  for (const patch of [{}, { deletedAt: timestamp }, { accessStatus: "PENDING" as const }, { accessStatus: "DISABLED" as const }]) {
    const { data, user } = setup();
    data.users.push({ ...staff, id: "duplicate", email: "Reserved@EXAMPLE.INVALID", ...patch });
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(user, { email: " RESERVED@example.invalid " })), /このメールアドレスはほかの利用者が使っています/);
  }
  const { data, user } = setup();
  updateUserAccount(data, admin.id, edit(user, { email: staff.email.toUpperCase() }));
  assert.equal(user.email, staff.email);
});

test("non-admin, disabled, deleted, pending, rejected and missing actors cannot edit or end sessions", () => {
  const patches: Partial<User>[] = [
    ...editableRoles.filter((role) => role !== "ADMIN").map((role) => ({ role })),
    { accessStatus: "DISABLED" }, { accessStatus: "PENDING" }, { accessStatus: "REJECTED" }, { deletedAt: timestamp },
    { accessStatus: "unknown" as User["accessStatus"] },
  ];
  for (const patch of patches) {
    const { data, user } = setup();
    Object.assign(data.users[0], patch);
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(user)), /権限がありません/);
    rejectsUnchanged(data, () => endUserSessions(data, admin.id, user), /権限がありません/);
  }
  const { data, user } = setup();
  rejectsUnchanged(data, () => updateUserAccount(data, "missing", edit(user)), /権限がありません/);
  rejectsUnchanged(data, () => endUserSessions(data, "missing", user), /権限がありません/);
});

test("an administrator cannot change their own role or status even when another administrator remains", () => {
  const { data, user } = setup({ role: "ADMIN" });
  for (const patch of [{ role: "ACCOUNTING" as const }, { status: "DISABLED" as const }]) {
    rejectsUnchanged(data, () => updateUserAccount(data, user.id, edit(user, patch)), /自分の権限と利用状態は、ほかの管理者が変更してください/);
  }
});

test("an administrator can edit their own name, email and password", () => {
  const { data } = setup();
  const user = data.users[0];
  const result = updateUserAccount(data, user.id, edit(user, { name: "Synthetic Self", email: "self@example.invalid", passwordHash: "test-only-self-hash" }));
  assert.equal(user.name, "Synthetic Self"); assert.equal(user.email, "self@example.invalid"); assert.equal(user.passwordHash, "test-only-self-hash");
  assert.equal(user.sessionVersion, 1); assert.ok(user.passwordChangedAt); assert.equal(result.passwordChanged, true); assert.equal(result.sessionsEnded, true);
  assert.equal(user.role, "ADMIN"); assert.equal(isActiveUser(user), true);
  assert.doesNotMatch(JSON.stringify(result), /passwordHash|test-only|sessionVersion/);
});

test("the sole active administrator cannot be demoted or disabled; inactive administrators do not change this", () => {
  for (const patch of [{ role: "DESIGNER" as const }, { status: "DISABLED" as const }]) {
    const { data } = setup();
    data.users.push(
      { ...staff, id: "disabled-admin", role: "ADMIN", accessStatus: "DISABLED" },
      { ...staff, id: "deleted-admin", role: "ADMIN", deletedAt: timestamp },
      { ...staff, id: "pending-admin", role: "ADMIN", accessStatus: "PENDING" },
      { ...staff, id: "rejected-admin", role: "ADMIN", accessStatus: "REJECTED" },
    );
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, edit(data.users[0], patch)));
    assert.equal(data.users.filter((user) => user.role === "ADMIN" && isActiveUser(user)).length, 1);
  }
});

test("another active administrator can demote or disable an administrator", () => {
  for (const patch of [{ role: "DESIGNER" as const }, { status: "DISABLED" as const }]) {
    const { data, user } = setup({ role: "ADMIN" });
    updateUserAccount(data, user.id, edit(data.users[0], patch));
    assert.equal(data.users.filter((item) => item.role === "ADMIN" && isActiveUser(item)).length, 1);
    assert.equal(data.users[0].role, patch.role ?? "ADMIN");
    assert.equal(data.users[0].accessStatus, patch.status ?? "ACTIVE");
  }
});

test("a password change updates its hash and timestamp, increments the session version and rejects replay", () => {
  for (const version of [undefined, 5]) {
    const { data, user } = setup({ sessionVersion: version });
    const input = edit(user, { passwordHash: "test-only-new-hash" });
    const result = updateUserAccount(data, admin.id, input);
    assert.equal(user.passwordHash, "test-only-new-hash"); assert.equal(user.passwordChangedAt, user.updatedAt);
    assert.equal(user.sessionVersion, (version ?? 0) + 1); assert.equal(result.passwordChanged, true); assert.equal(result.sessionsEnded, true);
    assert.equal(sessionVersionMatches(user, version), false);
    assert.doesNotMatch(JSON.stringify(result), /passwordHash|test-only|sessionVersion/);
    rejectsUnchanged(data, () => updateUserAccount(data, admin.id, input), /再読み込み/);
  }
});

test("empty or absent password hashes leave the hash, change date and session version alone", () => {
  for (const passwordHash of [undefined, ""]) {
    const { data, user } = setup({ sessionVersion: 4, passwordChangedAt: timestamp });
    const result = updateUserAccount(data, admin.id, edit(user, { passwordHash }));
    assert.equal(user.passwordHash, staff.passwordHash); assert.equal(user.passwordChangedAt, timestamp); assert.equal(user.sessionVersion, 4);
    assert.equal(result.passwordChanged, false); assert.equal(result.sessionsEnded, false);
  }
});

test("disabling invalidates sessions, and editing or re-enabling a disabled user does not revive old cookies", () => {
  const { data, user } = setup();
  const result = updateUserAccount(data, admin.id, edit(user, { status: "DISABLED" }));
  assert.equal(user.accessStatus, "DISABLED"); assert.equal(isActiveUser(user), false); assert.equal(user.sessionVersion, 1);
  assert.equal(result.sessionsEnded, true); assert.equal(result.passwordChanged, false);
  const unchangedStatus = updateUserAccount(data, admin.id, edit(user, { name: "Synthetic Disabled" }));
  assert.equal(unchangedStatus.sessionsEnded, false); assert.equal(user.sessionVersion, 1);
  const enabled = updateUserAccount(data, admin.id, edit(user, { status: "ACTIVE" }));
  assert.equal(isActiveUser(user), true); assert.equal(user.sessionVersion, 1); assert.equal(enabled.sessionsEnded, false);
  assert.equal(sessionVersionMatches(user), false); assert.equal(sessionVersionMatches(user, 1), true);
});

test("changing a password and disabling together account for both session-ending changes", () => {
  const { data, user } = setup({ sessionVersion: 2 });
  const result = updateUserAccount(data, admin.id, edit(user, { passwordHash: "test-only-new-hash", status: "DISABLED" }));
  assert.equal(user.sessionVersion, 4); assert.equal(isActiveUser(user), false); assert.equal(user.passwordChangedAt, user.updatedAt);
  assert.equal(result.sessionsEnded, true); assert.equal(result.passwordChanged, true);
});

test("unknown legacy states fail closed, and explicitly stopping them still invalidates old cookies", () => {
  const { data, user } = setup({ accessStatus: "unknown" as User["accessStatus"] });
  assert.equal(isActiveUser(user), false);
  assert.equal(userAccountViews(data).find((view) => view.id === user.id)?.status, "DISABLED");
  updateUserAccount(data, admin.id, edit(user, { status: "DISABLED" }));
  assert.equal(user.sessionVersion, 1);
  updateUserAccount(data, admin.id, edit(user, { status: "ACTIVE" }));
  assert.equal(sessionVersionMatches(user), false);
});

test("rejected accounts can stay rejected, but other accounts cannot be changed to rejected", () => {
  const { data, user } = setup({ accessStatus: "REJECTED" });
  updateUserAccount(data, admin.id, edit(user, { name: "Synthetic Rejected" }));
  assert.equal(user.accessStatus, "REJECTED"); assert.equal(user.approvedAt, undefined); assert.equal(isActiveUser(user), false);
  for (const accessStatus of [undefined, "ACTIVE", "DISABLED"] as const) {
    const target = setup({ accessStatus });
    rejectsUnchanged(target.data, () => updateUserAccount(target.data, admin.id, edit(target.user, { status: "REJECTED" })), /申請却下/);
  }
});

test("reactivating rejected accounts fills missing approval metadata without replacing existing approvals", () => {
  for (const patch of [{}, { approvedAt: timestamp }, { approvedById: "test-original-admin" }, { approvedAt: timestamp, approvedById: "test-original-admin" }]) {
    const { data, user } = setup({ accessStatus: "REJECTED", ...patch });
    updateUserAccount(data, admin.id, edit(user, { status: "ACTIVE" }));
    assert.equal(isActiveUser(user), true);
    assert.equal(user.approvedAt, patch.approvedAt ?? user.updatedAt); assert.equal(user.approvedById, patch.approvedById ?? admin.id);
  }
});

test("ending sessions increments the version, preserves the password, is allowed on oneself, and rejects replay", () => {
  for (const self of [false, true]) {
    const { data } = setup({ sessionVersion: 7 });
    const user = data.users[self ? 0 : 1];
    const before = structuredClone(user);
    const input = { id: user.id, updatedAt: user.updatedAt };
    assert.deepEqual(endUserSessions(data, admin.id, input), { id: user.id, sessionsEnded: true });
    assert.equal(user.sessionVersion, (before.sessionVersion ?? 0) + 1);
    assert.equal(user.passwordHash, before.passwordHash); assert.equal(user.passwordChangedAt, before.passwordChangedAt);
    assert.ok(Date.parse(user.updatedAt) > Date.parse(before.updatedAt));
    assert.equal(sessionVersionMatches(user, before.sessionVersion), false);
    rejectsUnchanged(data, () => endUserSessions(data, admin.id, input), /再読み込み/);
  }
});

test("session ending also works for disabled and rejected targets", () => {
  for (const accessStatus of ["DISABLED", "REJECTED"] as const) {
    const { data, user } = setup({ accessStatus });
    endUserSessions(data, admin.id, user);
    assert.equal(user.sessionVersion, 1); assert.equal(user.accessStatus, accessStatus); assert.equal(isActiveUser(user), false);
  }
});

test("timestamps advance beyond a future previous version for both mutations", () => {
  const future = "2099-01-01T00:00:00.000Z";
  const { data, user } = setup({ updatedAt: future });
  updateUserAccount(data, admin.id, edit(user));
  assert.equal(Date.parse(user.updatedAt), Date.parse(future) + 1);
  endUserSessions(data, admin.id, user);
  assert.equal(Date.parse(user.updatedAt), Date.parse(future) + 2);
});

test("session comparison defaults missing values to zero and rejects mismatches and malformed claims", () => {
  assert.equal(sessionVersionMatches({}), true);
  assert.equal(sessionVersionMatches({}, 0), true);
  assert.equal(sessionVersionMatches({ sessionVersion: 0 }), true);
  assert.equal(sessionVersionMatches({ sessionVersion: 3 }, 3), true);
  assert.equal(sessionVersionMatches({}, 1), false);
  assert.equal(sessionVersionMatches({ sessionVersion: 1 }), false);
  assert.equal(sessionVersionMatches({ sessionVersion: 3 }, 2), false);
  for (const claim of ["0", null, false, {}, -1, 0.5, NaN, Infinity]) assert.equal(sessionVersionMatches({}, claim), false);
});

test("administrator passwords enforce both character length and the UTF-8 bcrypt byte limit", () => {
  for (const password of ["test-123", "x".repeat(72), "あ".repeat(24)]) assert.equal(userAccountPasswordSchema.safeParse(password).success, true);
  for (const password of ["", "short", "x".repeat(73), "あ".repeat(25), "😀".repeat(19)]) assert.equal(userAccountPasswordSchema.safeParse(password).success, false);
  const result = userAccountPasswordSchema.safeParse("あ".repeat(25));
  assert.ok(!result.success);
  assert.equal(result.error.issues[0].message, "パスワードはUTF-8で72バイト以内にしてください");
});
