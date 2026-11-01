import assert from "node:assert/strict";
import test from "node:test";
import { statusToneClass } from "../src/lib/status-tone";

test("each status family keeps one color meaning, and unknown statuses stay neutral", () => {
  for (const status of ["OVERDUE", "REJECTED", "DECLINED"]) assert.match(statusToneClass(status), /text-red-/, status);
  for (const status of ["APPROVAL_PENDING", "WAITING_PAYMENT", "PARTIALLY_PAID", "REVIEWING", "OCR_PENDING", "ON_HOLD"]) assert.match(statusToneClass(status), /text-amber-/, status);
  for (const status of ["PAID", "COMPLETED", "ACCEPTED", "CONVERTED"]) assert.match(statusToneClass(status), /text-emerald-/, status);
  for (const status of ["IN_PROGRESS", "ISSUED", "SENT", "SCHEDULED", "RECEIVED"]) assert.match(statusToneClass(status), /text-blue-/, status);
  assert.match(statusToneClass("PLANNING"), /text-violet-/);
  for (const status of ["DRAFT", "ARCHIVED", "CANCELED", "REISSUED", "SOMETHING_NEW"]) assert.match(statusToneClass(status), /text-foreground/, status);
});
