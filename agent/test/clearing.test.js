import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClearingAgent, billingAuthorized } from "../src/index.js";
const result = (id, gross, net, remaining = 0) => ({
  roundId: id,
  grossVolume: String(gross),
  netVolume: String(net),
  compression: Number(net) / Number(gross),
  remaining,
  obligationCount: 3,
  transfers: net ? [{ from: "alice", to: "bob", amount: String(net) }] : [],
});
function agent(client) {
  const a = new ClearingAgent({ persist: false });
  a.client = client;
  return a;
}

test("the watcher settles a completely offset cycle without moving funds", async () => {
  let calls = 0;
  const a = agent({
    getObligations: async () => [{ id: "a" }, { id: "b" }, { id: "c" }],
    computeNetPositions: async () => ({
      grossVolume: "300",
      netVolume: "0",
      transfers: [],
    }),
    clear: async () => {
      calls++;
      return result("zero", 300, 0);
    },
  });
  await a.tick();
  assert.equal(calls, 1);
  assert.equal(a.stats.roundsSettled, 1);
  assert.equal(a.stats.netSettled, 0n);
  assert.equal(a.log.at(-1).compression, 100);
});
test("funding covers the sum of a payer's outgoing transfers", async () => {
  let calls = 0;
  const a = agent({
    getObligations: async () => [{ id: "a" }, { id: "b" }],
    computeNetPositions: async () => ({
      grossVolume: "100",
      netVolume: "12",
      transfers: [
        { from: "alice", to: "bob", amount: "6" },
        { from: "alice", to: "carol", amount: "6" },
      ],
    }),
    getBalance: async () => "8",
    clear: async () => {
      calls++;
      return result("bad", 100, 12);
    },
  });
  await a.tick();
  assert.equal(calls, 0);
  assert.equal(a.log.at(-1).kind, "defer");
  assert.deepEqual(a.log.at(-1).shortfalls, ["alice"]);
  assert.equal(a.stats.errors, 0);
});
test("every cleared batch is accounted for and retains the savings percentage", async () => {
  const queue = [result("first", 100, 20, 3), result("second", 200, 40)];
  const a = agent({
    getObligations: async () => [{ id: "a" }],
    computeNetPositions: async () => ({
      grossVolume: "300",
      netVolume: "60",
      transfers: [{ from: "alice", to: "bob", amount: "60" }],
    }),
    getBalance: async () => "100",
    clear: async () => queue.shift(),
  });
  await a.tick();
  assert.equal(a.stats.roundsSettled, 2);
  assert.equal(a.stats.grossSettled, 300n);
  assert.equal(a.stats.netSettled, 60n);
  assert.deepEqual(
    a.log.filter((e) => e.kind === "settle").map((e) => e.compression),
    [80, 80],
  );
});
test("a concurrent demo is rejected before it can record any obligations", async () => {
  const a = agent({});
  a.demoLock = true;
  await assert.rejects(a.runDemo(), /already running/);
});
test("the guided demo settles a zero-net cycle and retains its scheduled bill", async () => {
  let calls = 0;
  const bills = [];
  const a = agent({
    computeNetPositions: async () => ({
      grossVolume: "60000000000000000000000",
      netVolume: "0",
      compression: 0,
      transfers: [],
    }),
    clear: async () => {
      calls++;
      return result("demo-zero", 60000000000000000000000n, 0n);
    },
  });
  a.bill = async (b) => {
    bills.push(b);
    return { ...b, id: String(bills.length), amount: b.amountNear };
  };
  const r = await a._runDemoLocked();
  assert.equal(calls, 1);
  assert.equal(r.cleared.roundId, "demo-zero");
  assert.equal(r.compression, 0);
  assert.equal(bills.length, 6);
  assert.ok(bills[5].dueAt > Date.now());
  assert.equal(a.stats.roundsSettled, 1);
});

test("collateral and credit limits are checked before attempting settlement", async () => {
  const a = agent({
    getBalance: async () => "15",
    getCollateralRatio: async () => 2,
    getCreditLimits: async () => [],
  });
  assert.deepEqual(
    await a.fundingShortfalls([{ from: "alice", to: "bob", amount: "10" }]),
    ["alice"],
  );
  a.client.getCollateralRatio = async () => 1;
  a.client.getCreditLimits = async () => [
    { accountId: "alice", creditLimit: "9" },
  ];
  assert.deepEqual(
    await a.fundingShortfalls([{ from: "alice", to: "bob", amount: "10" }]),
    ["alice"],
  );
});

test("a later failed batch retains every already completed settlement", async () => {
  let calls = 0;
  const a = agent({
    clear: async () => {
      if (calls++ === 0) return result("recorded", 100, 20, 2);
      throw new Error("Risk check failed");
    },
  });
  const cleared = await a.clearBatches();
  assert.equal(cleared.partial, true);
  assert.equal(cleared.remaining, 2);
  assert.equal(cleared.grossVolume, "100");
  assert.deepEqual(cleared.roundIds, ["recorded"]);
  assert.equal(a.stats.roundsSettled, 1);
  assert.equal(a.log.at(-1).kind, "defer");
});

test("runtime totals and the audit trail survive a restart without double counting", () => {
  const statePath = join(
    mkdtempSync(join(tmpdir(), "ach-agent-history-")),
    "state.jsonl",
  );
  const original = new ClearingAgent({ statePath });
  original.recordSettlement(result("persisted", 100, 20));
  original.recordSettlement(result("persisted", 100, 20));
  original.logEvent("observe", { open: 2, note: "preserved observation" });
  const restored = new ClearingAgent({ statePath });
  restored.recordSettlement(result("persisted", 100, 20));
  assert.equal(restored.stats.roundsSettled, 1);
  assert.equal(restored.stats.grossSettled, 100n);
  assert.equal(restored.log.length, 2);
  assert.equal(restored.log.at(-1).note, "preserved observation");
  assert.equal(readFileSync(statePath, "utf8").trim().split("\n").length, 2);
});

test("general billing requires the configured bearer token", () => {
  assert.equal(billingAuthorized(undefined, "test-billing-token"), false);
  assert.equal(billingAuthorized("Bearer wrong", "test-billing-token"), false);
  assert.equal(
    billingAuthorized("Bearer test-billing-token", "test-billing-token"),
    true,
  );
  assert.equal(billingAuthorized("Bearer anything", ""), false);
});

test("security review pauses clearing and ambient billing without resetting history", async () => {
  let queries = 0;
  const a = agent({
    getSecurityConfig: async () => ({ version: 3, ready: false }),
    computeNetPositions: async () => {
      queries++;
    },
    getObligations: async () => {
      queries++;
    },
    clear: async () => {
      queries++;
    },
  });
  await a.tick();
  await a.ambientBills();
  assert.equal(queries, 0);
  assert.equal(a.stats.errors, 0);
  assert.equal(a.log.at(-1).reason, "legacy_review");
});

test("mutually approved unbacked cycles remain eligible to the protected watcher", async () => {
  let clears = 0;
  const a = agent({
    getSecurityConfig: async () => ({ version: 3, ready: true }),
    getClearingObligations: async () => [
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
    ],
    computeNetPositions: async () => ({
      grossVolume: "300",
      netVolume: "0",
      compression: 0,
      transfers: [],
    }),
    previewClear: async () => ({ ready: true, shortfalls: [] }),
    clear: async () => {
      clears++;
      return result("approved-zero", 300, 0);
    },
  });
  await a.tick();
  assert.equal(clears, 1);
  assert.equal(a.stats.netSettled, 0n);
});

test("the watcher uses the contract preview when a batch would spend another bill's reservation", async () => {
  let clears = 0;
  const a = agent({
    getSecurityConfig: async () => ({ version: 3, ready: true }),
    getClearingObligations: async () => [{ id: "approved" }],
    computeNetPositions: async () => ({
      grossVolume: "100",
      netVolume: "10",
      transfers: [{ from: "alice", to: "bob", amount: "10" }],
    }),
    previewClear: async () => ({
      ready: false,
      shortfalls: ["alice cannot settle without spending reserved collateral"],
    }),
    clear: async () => {
      clears++;
    },
  });
  await a.tick();
  assert.equal(clears, 0);
  assert.equal(a.log.at(-1).kind, "defer");
  assert.equal(a.stats.errors, 0);
});

test("legacy preflight still preserves a one-yocto collateral shortfall", async () => {
  const amount = 1000000000000000000000001n;
  const required = (amount * 1000001n + 999999n) / 1000000n;
  const a = agent({
    getBalance: async () => (required - 1n).toString(),
    getCollateralRatio: async () => 1.000001,
    getCreditLimits: async () => [],
  });
  assert.deepEqual(
    await a.fundingShortfalls([
      { from: "alice", to: "bob", amount: amount.toString() },
    ]),
    ["alice"],
  );
});

test("controlled demo billing requires the counterparty signature and retains failed approvals as proposals", async () => {
  const a = new ClearingAgent({
    persist: false,
    participantLoader: () => ({
      alice: { accountId: "alice.testnet" },
      bob: { accountId: "bob.testnet" },
    }),
  });
  const signatures = [];
  a.participantClient = (id) => ({
    getSecurityConfig: async () => ({ version: 3, ready: true }),
    recordObligation: async (terms) => {
      signatures.push([id, terms]);
      return "demo-proposal";
    },
    acceptObligation: async (reference) => {
      signatures.push([id, reference]);
      return { status: "open", creditorApproved: true, funded: true };
    },
  });
  const invoice = await a.bill({
    debtor: "alice",
    creditor: "bob",
    amountNear: "0.01",
    dueAt: 123456,
    memo: "test service",
  });
  assert.equal(signatures[0][0], "alice");
  assert.equal(signatures[0][1].amount, "10000000000000000000000");
  assert.equal(signatures[0][1].dueAt, 123456);
  assert.deepEqual(signatures[1], ["bob", "demo-proposal"]);
  assert.equal(invoice.creditorApproved, true);
  a.participantClient = (id) => ({
    getSecurityConfig: async () => ({ version: 3, ready: true }),
    recordObligation: async () => "retained-proposal",
    acceptObligation: async () => {
      throw new Error("Counterparty unavailable");
    },
  });
  const pending = await a.bill({
    debtor: "alice",
    creditor: "bob",
    amountNear: "0.01",
    memo: "test service",
  });
  assert.equal(pending.id, "retained-proposal");
  assert.equal(pending.status, "pending");
  assert.equal(pending.creditorApproved, false);
  assert.ok(pending.approvalError);
});
