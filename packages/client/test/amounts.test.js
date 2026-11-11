import { test } from "node:test";
import assert from "node:assert/strict";
import { nearToYocto, formatNear, ClearingClient } from "../dist/index.js";

test("the client defaults to the active v2 clearing contract", () => {
  assert.equal(new ClearingClient().contractId, "ach-clearing-v2.testnet");
});

test("service invoice amounts convert exactly", () => {
  assert.equal(nearToYocto("0.02"), "20000000000000000000000");
  assert.equal(nearToYocto(0.006), "6000000000000000000000");
  assert.equal(nearToYocto(".5"), "500000000000000000000000");
  assert.equal(
    nearToYocto("123456789.123456789012345678901234"),
    "123456789123456789012345678901234",
  );
});

test("the smallest supported amount and scientific notation remain exact", () => {
  assert.equal(nearToYocto("0.000000000000000000000001"), "1");
  assert.equal(nearToYocto(1e-24), "1");
  assert.equal(nearToYocto("2.50e-3"), "2500000000000000000000");
  assert.equal(nearToYocto("0.0000000000000000000000010"), "1");
  assert.equal(nearToYocto("0"), "0");
});

test("invalid or unrepresentable amounts are rejected before signing", () => {
  for (const amount of ["", "abc", "NaN", Infinity, -1, "1e-25", "1e1001"]) {
    assert.throws(() => nearToYocto(amount));
  }
});

test("reconciliation exports retain exact ledger precision", () => {
  assert.equal(formatNear("1", 6), "0.000000000000000000000001");
  assert.equal(
    formatNear("212926350779972003830476", 6),
    "0.212926350779972003830476",
  );
  assert.equal(
    formatNear("-212926350779972003830476", 6),
    "-0.212926350779972003830476",
  );
  assert.equal(formatNear("6000000000000000000000", 6), "0.006000");
  assert.equal(formatNear("0", 6), "0.000000");
});
