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

test("fractional monetary displays keep their previous precision without forcing trailing zeroes", () => {
  assert.equal(formatMoney(1234.567, { maximumFractionDigits: 2 }), "￥1,234.57");
  assert.equal(formatMoney(-1234.5, { maximumFractionDigits: 2 }), "−￥1,234.5");
  assert.equal(formatMoney(12, { maximumFractionDigits: 2, sign: "always" }), "+￥12");
  assert.equal(formatMoney(12.3456, { maximumFractionDigits: 3 }), "￥12.346");
  assert.equal(formatMoney(12.3456), "￥12");
  assert.equal(formatMoney(-0, { maximumFractionDigits: 2, sign: "always" }), "￥0");
});

test("compact chart scales keep their one-digit precision and monetary sign", () => {
  assert.equal(formatMoney(12345, { notation: "compact", maximumFractionDigits: 1 }), "￥1.2万");
  assert.equal(formatMoney(-12345, { notation: "compact", maximumFractionDigits: 1 }), "−￥1.2万");
  assert.equal(formatMoney(12345), "￥12,345");
});
