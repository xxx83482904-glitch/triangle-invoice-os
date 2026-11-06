import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, yen } from "../src/lib/format";

test("money formats positive yen and uses a mathematical minus for negatives", () => {
  assert.equal(formatMoney(1234), yen.format(1234));
  assert.equal(formatMoney(-1234), `−${yen.format(1234)}`);
});

test("zero and negative zero never have a sign", () => {
  for (const sign of ["negative", "always", "never"] as const) {
    for (const value of [0, -0]) assert.equal(formatMoney(value, { sign }), yen.format(0));
  }
});

test("always signs positive and negative amounts", () => {
  assert.equal(formatMoney(12, { sign: "always" }), `+${yen.format(12)}`);
  assert.equal(formatMoney(-12, { sign: "always" }), `−${yen.format(12)}`);
});

test("never shows the magnitude without a sign", () => {
  assert.equal(formatMoney(-12, { sign: "never" }), yen.format(12));
  assert.equal(formatMoney(12, { sign: "never" }), yen.format(12));
});

test("large amounts retain grouped yen formatting", () => {
  assert.equal(formatMoney(1234567890123), "￥1,234,567,890,123");
});

test("non-finite amounts are unavailable", () => {
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(formatMoney(value, { sign: "always" }), "—");
});
