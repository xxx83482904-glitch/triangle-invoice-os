import test from "node:test";
import assert from "node:assert/strict";
import { isActiveUser, registrationSchema, requestRegistration, reviewRegistration, approvalRoles } from "../src/lib/user-access";
import type { User } from "../src/lib/types";
import { fixture, timestamp } from "./document-fixture";

const account = { id: "admin", name: "Admin", email: "admin@example.invalid", passwordHash: "test-only", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp } satisfies User;

function pendingFixture() {
  const data = fixture(); data.users.push({ ...account });
  const result = requestRegistration(data, { name: "Applicant", email: "applicant@example.invalid", passwordHash: "test-only" });
  const user = data.users.find((item) => item.id === result.id)!;
  return { data, user };
}

test("public registration ignores injected roles and always remains pending", () => {
  const data = fixture();
  const parsed = registrationSchema.parse({ name: " Applicant ", email: "APPLICANT@example.invalid", password: "test-only-password", role: "ADMIN", accessStatus: "ACTIVE" });
  assert.equal(parsed.email, "applicant@example.invalid"); assert.equal(parsed.name, "Applicant"); assert.ok(!("role" in parsed));
  const result = requestRegistration(data, { ...parsed, passwordHash: "test-only", role: "ADMIN", accessStatus: "ACTIVE" } as Parameters<typeof requestRegistration>[1]);
  const user = data.users[0];
  assert.equal(user.role, "MAIL_EDITOR"); assert.equal(user.accessStatus, "PENDING"); assert.equal(isActiveUser(user), false);
  assert.ok(!("passwordHash" in result)); assert.ok(!("password" in user));
});

test("legacy active users remain usable, pending/rejected/deleted and unknown states fail closed", () => {
  assert.equal(isActiveUser(account), true);
  assert.equal(isActiveUser({ ...account, accessStatus: "ACTIVE" }), true);
  for (const accessStatus of ["PENDING", "REJECTED"] as const) assert.equal(isActiveUser({ ...account, accessStatus }), false);
  assert.equal(isActiveUser({ ...account, deletedAt: timestamp }), false);
  assert.equal(isActiveUser({ ...account, accessStatus: "unknown" as User["accessStatus"] }), false);
});

test("admin approval applies the chosen role, records the approver and rejects stale replay", () => {
  for (const role of approvalRoles) {
    const { data, user } = pendingFixture();
    const request = { id: user.id, updatedAt: user.updatedAt, decision: "APPROVE" as const, role };
    reviewRegistration(data, "admin", request);
    assert.equal(isActiveUser(user), true); assert.equal(user.role, role); assert.equal(user.approvedById, "admin"); assert.ok(user.approvedAt);
    const before = structuredClone(data);
    assert.throws(() => reviewRegistration(data, "admin", request));
    assert.deepEqual(data, before);
  }
});

test("non-admin, deleted and pending admins cannot approve or reject", () => {
  for (const role of ["ACCOUNTING", "PROJECT_MANAGER", "MAIL_EDITOR", "BILLING_EDITOR", "GUEST"] as const) {
    const { data, user } = pendingFixture(); data.users.find((item) => item.id === "admin")!.role = role;
    const before = structuredClone(data);
    assert.throws(() => reviewRegistration(data, "admin", { ...user, decision: "APPROVE", role: "ACCOUNTING" }), /権限/);
    assert.throws(() => reviewRegistration(data, "admin", { ...user, decision: "REJECT", role: "MAIL_EDITOR" }), /権限/);
    assert.deepEqual(data, before);
  }
  for (const patch of [{ accessStatus: "PENDING" as const }, { deletedAt: timestamp }]) {
    const { data, user } = pendingFixture(); Object.assign(data.users.find((item) => item.id === "admin")!, patch);
    assert.throws(() => reviewRegistration(data, "admin", { ...user, decision: "APPROVE", role: "MAIL_EDITOR" }), /権限/);
  }
});

test("rejection does not grant access, and forged roles or stale versions do not mutate", () => {
  const { data, user } = pendingFixture(); const before = structuredClone(data);
  assert.throws(() => reviewRegistration(data, "admin", { ...user, decision: "APPROVE", role: "ADMIN" as (typeof approvalRoles)[number] }));
  assert.throws(() => reviewRegistration(data, "admin", { ...user, decision: "APPROVE", role: "MAIL_EDITOR", updatedAt: "stale" }));
  assert.throws(() => reviewRegistration(data, "missing", { ...user, decision: "APPROVE", role: "MAIL_EDITOR" }));
  assert.deepEqual(data, before);
  reviewRegistration(data, "admin", { ...user, decision: "REJECT", role: "ACCOUNTING" });
  assert.equal(user.accessStatus, "REJECTED"); assert.equal(user.role, "MAIL_EDITOR"); assert.equal(isActiveUser(user), false);
});

test("duplicate and previously deleted emails cannot be reclaimed, and invalid input is rejected", () => {
  const { data, user } = pendingFixture();
  for (const deletedAt of [undefined, timestamp]) {
    user.deletedAt = deletedAt;
    assert.throws(() => requestRegistration(data, { name: "Other", email: user.email.toUpperCase(), passwordHash: "different" }));
    assert.equal(data.users.length, 2);
  }
  assert.equal(registrationSchema.safeParse({ name: "", email: "not-email", password: "short" }).success, false);
});
