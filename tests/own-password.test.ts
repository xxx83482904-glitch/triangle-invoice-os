import assert from "node:assert/strict";
import test from "node:test";
import { changeOwnPassword, checkNewOwnPassword } from "../src/lib/own-password";
import { expensesFixture } from "./expense-claims-fixture";

test("the new password must be valid, confirmed and different from the current one", () => {
  assert.throws(() => checkNewOwnPassword({ current: "", next: "new-pass-123", confirm: "new-pass-123" }), /今のパスワード/);
  assert.throws(() => checkNewOwnPassword({ current: "old-pass-123", next: "short", confirm: "short" }), /8文字以上/);
  assert.throws(() => checkNewOwnPassword({ current: "old-pass-123", next: "new-pass-123", confirm: "new-pass-124" }), /一致しません/);
  assert.throws(() => checkNewOwnPassword({ current: "same-pass-123", next: "same-pass-123", confirm: "same-pass-123" }), /今と違う/);
  assert.throws(() => checkNewOwnPassword({ current: "old-pass-123", next: "あ".repeat(30), confirm: "あ".repeat(30) }), /72バイト/);
  assert.equal(checkNewOwnPassword({ current: "old-pass-123", next: "new-pass-123", confirm: "new-pass-123" }), "new-pass-123");
});

test("changing one's own password stores the hash, and ends other sessions only when asked", () => {
  const data = expensesFixture(), user = data.users.find((row) => row.id === "des")!;
  user.passwordHash = "old-hash"; user.sessionVersion = 3;
  assert.throws(() => changeOwnPassword(data, "des", { passwordHash: "new-hash", signOutOthers: true, expectedHash: "stale" }), /ほかで変更/);
  changeOwnPassword(data, "des", { passwordHash: "new-hash", signOutOthers: false, expectedHash: "old-hash" }, "2026-11-12T05:00:00.000Z");
  assert.equal(user.passwordHash, "new-hash"); assert.equal(user.sessionVersion, 3); assert.equal(user.passwordChangedAt, "2026-11-12T05:00:00.000Z");
  changeOwnPassword(data, "des", { passwordHash: "newer-hash", signOutOthers: true, expectedHash: "new-hash" });
  assert.equal(user.sessionVersion, 4);
  user.accessStatus = "DISABLED";
  assert.throws(() => changeOwnPassword(data, "des", { passwordHash: "x", signOutOthers: true, expectedHash: "newer-hash" }), /見つかりません/);
});
