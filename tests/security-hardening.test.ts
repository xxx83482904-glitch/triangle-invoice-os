import assert from "node:assert/strict";
import test from "node:test";
import { compareSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import { applyReleaseUsers, releaseUserSeeds } from "../src/lib/release-users";
import { DeployFailureLimiter, deployEnabled, deployTokenMatches } from "../src/lib/deploy-auth";

const later = "2026-10-31T12:00:00.000Z";
const token = "local-test-only-deploy-token-0123456789abcdef";

test("release seeds come from the environment and need both an address and a usable password", () => {
  assert.deepEqual(releaseUserSeeds({}), []);
  assert.deepEqual(releaseUserSeeds({ RELEASE_ADMIN_EMAIL: "Admin@Example.invalid", RELEASE_ADMIN_PASSWORD: "short" }), []);
  const seeds = releaseUserSeeds({ RELEASE_ADMIN_EMAIL: "Admin@Example.invalid ", RELEASE_ADMIN_PASSWORD: "local-only-password", RELEASE_MAIL_EDITOR_EMAIL: "mail@example.invalid", RELEASE_MAIL_EDITOR_PASSWORD: "another-local-pw" });
  assert.deepEqual(seeds.map((seed) => [seed.id, seed.email, seed.role]), [["usr-admin", "admin@example.invalid", "ADMIN"], ["usr-mail-miyasaka", "mail@example.invalid", "MAIL_EDITOR"]]);
});

test("a release user is created only when missing; existing accounts are never reset and demo accounts retire", () => {
  const data = fixture();
  const seeds = releaseUserSeeds({ RELEASE_ADMIN_EMAIL: "admin@example.invalid", RELEASE_ADMIN_PASSWORD: "local-only-password" });
  data.users.push({ id: "demo", name: "Demo", email: "pm@triangle.local", passwordHash: "x", role: "PROJECT_MANAGER", createdAt: timestamp, updatedAt: timestamp });
  assert.equal(applyReleaseUsers(data, seeds, later), true);
  const admin = data.users.find((user) => user.email === "admin@example.invalid")!;
  assert.equal(admin.id, "usr-admin"); assert.ok(compareSync("local-only-password", admin.passwordHash));
  assert.equal(data.users.find((user) => user.id === "demo")!.deletedAt, later);
  // A second pass changes nothing, even if the stored password, name or role differ from the seed.
  admin.passwordHash = "changed-by-the-person"; admin.name = "Renamed"; admin.role = "ACCOUNTING";
  assert.equal(applyReleaseUsers(data, seeds, "2026-11-01T00:00:00.000Z"), false);
  assert.deepEqual([admin.passwordHash, admin.name, admin.role], ["changed-by-the-person", "Renamed", "ACCOUNTING"]);
  // A legacy admin address counts as the existing account and is kept as is.
  const legacy = fixture();
  legacy.users.push({ id: "old-admin", name: "Old", email: "admin@triangle.local", passwordHash: "keep", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp });
  assert.equal(applyReleaseUsers(legacy, seeds, later), false);
  assert.deepEqual([legacy.users[0].email, legacy.users[0].passwordHash, legacy.users[0].deletedAt], ["admin@triangle.local", "keep", undefined]);
  // Without seeds only demo retirement happens.
  const bare = fixture();
  bare.users.push({ id: "guest", name: "Guest", email: "guest@triangle.local", passwordHash: "x", role: "GUEST", createdAt: timestamp, updatedAt: timestamp });
  assert.equal(applyReleaseUsers(bare, [], later), true); assert.equal(bare.users[0].deletedAt, later);
  assert.equal(applyReleaseUsers(bare, [], later), false);
});

test("self deploy needs the opt-in flag and a long token, compares in constant time and brakes after repeated failures", () => {
  assert.equal(deployEnabled({}), false);
  assert.equal(deployEnabled({ ALLOW_SELF_DEPLOY: "true", DEPLOY_TOKEN: "short" }), false);
  assert.equal(deployEnabled({ ALLOW_SELF_DEPLOY: "false", DEPLOY_TOKEN: token }), false);
  assert.equal(deployEnabled({ ALLOW_SELF_DEPLOY: "true", DEPLOY_TOKEN: token }), true);
  assert.equal(deployTokenMatches(token, { DEPLOY_TOKEN: token }), true);
  assert.equal(deployTokenMatches(`${token}x`, { DEPLOY_TOKEN: token }), false);
  assert.equal(deployTokenMatches(token, {}), false);
  assert.equal(deployTokenMatches("short", { DEPLOY_TOKEN: "short" }), false);
  const limiter = new DeployFailureLimiter(3, 1000);
  assert.equal(limiter.locked(0), false);
  limiter.record(0); limiter.record(1); limiter.record(2);
  assert.equal(limiter.locked(3), true);
  assert.equal(limiter.locked(1500), false);
  limiter.record(1600); limiter.record(1601); limiter.record(1602);
  assert.equal(limiter.locked(1700), true);
  limiter.reset();
  assert.equal(limiter.locked(1701), false);
});
