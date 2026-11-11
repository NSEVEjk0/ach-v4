import { test } from "node:test";
import assert from "node:assert/strict";
import { ClearingClient } from "../dist/index.js";

const encode = (value) =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)));
function fixtureClient() {
  const client = new ClearingClient();
  const participants = ["alice", "bob"].map((accountId) => ({
    accountId,
    name: accountId,
    kind: "agent",
    bio: "",
    icon: "",
    createdAt: 1,
  }));
  const obligations = [
    {
      id: "out",
      debtor: "alice",
      creditor: "bob",
      amount: "10",
      memo: "research",
      status: "open",
      dueAt: null,
      createdAt: 1,
    },
    {
      id: "in",
      debtor: "bob",
      creditor: "alice",
      amount: "4",
      memo: "scheduled",
      status: "open",
      dueAt: Date.now() + 86400000,
      createdAt: 1,
    },
    {
      id: "disputed",
      debtor: "alice",
      creditor: "bob",
      amount: "99",
      memo: "disputed",
      status: "disputed",
      dueAt: null,
      createdAt: 1,
    },
  ];
  const data = {
    get_participants: participants,
    get_obligations: obligations.filter((o) => o.status === "open"),
    get_credit_limits: [{ accountId: "alice", creditLimit: "8" }],
    get_collateral_ratio: 2,
    get_stats: { openObligations: 2 },
    get_settlements: [
      {
        id: "round-1",
        timestamp: 1,
        grossVolume: "10",
        netVolume: "3",
        compression: 0.3,
        obligationCount: 1,
        obligationIds: ["out"],
        transfers: [{ from: "alice", to: "bob", amount: "3" }],
      },
      {
        id: "other-round",
        timestamp: 1,
        grossVolume: "9",
        netVolume: "9",
        compression: 1,
        obligationCount: 1,
        obligationIds: ["other"],
        transfers: [{ from: "carol", to: "dave", amount: "9" }],
      },
    ],
  };
  client.provider.query = async (params) => {
    if (params.method_name === "get_security_config")
      return { error: "MethodNotFound: get_security_config does not exist" };
    if (["get_risk", "get_statement"].includes(params.method_name))
      return {
        error: "wasm execution failed with error: HostError(GasLimitExceeded)",
      };
    const args = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(params.args_base64), (c) => c.charCodeAt(0)),
      ),
    );
    return {
      result: encode(
        params.method_name === "get_balance"
          ? args.account_id === "alice"
            ? "5"
            : "0"
          : data[params.method_name],
      ),
    };
  };
  return { client, data };
}

test("large-history risk views reconcile the active public ledger", async () => {
  const { client } = fixtureClient();
  const risk = await client.getRisk();
  assert.equal(risk[0].grossPayable, "10");
  assert.equal(risk[0].grossReceivable, "4");
  assert.equal(risk[0].netPosition, "-6");
  assert.equal(risk[0].collateralRequired, "12");
  assert.equal(risk[0].covered, false);
  assert.equal(risk[1].netPosition, "6");
  assert.equal(risk[1].covered, true);
});

test("large-history statements retain incoming, outgoing, and relevant settled transfers", async () => {
  const { client } = fixtureClient();
  const statement = await client.getStatement("alice");
  assert.deepEqual(
    statement.openOutgoing.map((o) => o.id),
    ["out"],
  );
  assert.deepEqual(
    statement.openIncoming.map((o) => o.id),
    ["in"],
  );
  assert.deepEqual(
    statement.settlements.map((s) => s.id),
    ["round-1"],
  );
  await assert.rejects(client.getStatement("unknown"), /Participant not found/);
});

test("a truncated active ledger cannot silently understate exposure", async () => {
  const { client, data } = fixtureClient();
  data.get_stats.openObligations = 3;
  await assert.rejects(client.getRisk(), /complete active ledger/);
});

test("public views decode Unicode without a browser Buffer global", async () => {
  const client = new ClearingClient();
  client.provider.query = async () => ({
    result: encode([{ name: "Zoë 東京", bio: "Data 🧪" }]),
  });
  const originalBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const participants = await client.getParticipants();
    assert.equal(participants[0].name, "Zoë 東京");
    assert.equal(participants[0].bio, "Data 🧪");
  } finally {
    globalThis.Buffer = originalBuffer;
  }
});

test("writes wait for finalized execution before returning a result", async () => {
  const client = new ClearingClient();
  client.provider.query = async () => ({
    error: "MethodNotFound: get_security_config does not exist",
  });
  client.account = {
    signAndSendTransaction: async (args) => {
      assert.equal(args.waitUntil, "FINAL");
      assert.equal(args.receiverId, "ach-clearing-v2.testnet");
      return {
        status: {
          SuccessValue: btoa(JSON.stringify({ id: "recorded-invoice" })),
        },
      };
    },
  };
  const id = await client.recordObligation({
    debtor: "alice",
    creditor: "bob",
    amount: "10",
    memo: "invoice",
  });
  assert.equal(id, "recorded-invoice");
});

const protectedConfig = {
  version: 3,
  ready: true,
  bilateralApproval: true,
  strictDueTimes: true,
  reservedCollateral: true,
  bilateralDisputes: true,
  registrationDeposit: "123",
  proposalDeposit: "456",
  withdrawalDeposit: "1",
};

test("protected writes attach storage deposits and approval signs only the stored reference", async () => {
  const client = new ClearingClient();
  client.provider.query = async () => ({ result: encode(protectedConfig) });
  const calls = [];
  client.account = {
    signAndSendTransaction: async (transaction) => {
      assert.equal(transaction.waitUntil, "FINAL");
      const call = transaction.actions[0].functionCall;
      calls.push({
        method: call.methodName,
        deposit: call.deposit,
        args: JSON.parse(new TextDecoder().decode(call.args)),
      });
      return {
        status: {
          SuccessValue: btoa(
            JSON.stringify({ id: "approved-reference", status: "pending" }),
          ),
        },
      };
    },
  };
  await client.join({ name: "Alice", kind: "agent", bio: "", icon: "" });
  await client.recordObligation({
    debtor: "alice",
    creditor: "bob",
    amount: "100",
    memo: "service",
    dueAt: 12345,
  });
  await client.acceptObligation("approved-reference");
  await client.withdraw("10");
  assert.deepEqual(
    calls.map((c) => [c.method, c.deposit]),
    [
      ["join", 123n],
      ["record_obligation", 456n],
      ["accept_obligation", 0n],
      ["withdraw", 1n],
    ],
  );
  assert.deepEqual(calls[2].args, { obligation_id: "approved-reference" });
  assert.equal(calls[1].args.due_at, 12345);
});

test("RPC failures and malformed security responses cannot downgrade the client to legacy writes", async () => {
  for (const response of [
    { error: "RPC temporarily unavailable" },
    { result: encode({ version: 3, ready: true }) },
  ]) {
    const client = new ClearingClient();
    let writes = 0;
    client.provider.query = async () => response;
    client.account = {
      signAndSendTransaction: async () => {
        writes++;
      },
    };
    await assert.rejects(client.withdraw("10"));
    assert.equal(writes, 0);
  }
});

function protectedFixture() {
  const client = new ClearingClient();
  const participants = ["alice", "bob"].map((accountId) => ({
    accountId,
    name: accountId,
    kind: "agent",
    bio: "",
    icon: "",
    createdAt: 1,
  }));
  const agreed = {
    createdAt: 1,
    memo: "service",
    dueAt: null,
    debtorApproved: true,
    creditorApproved: true,
    funded: true,
  };
  const obligations = [
    {
      ...agreed,
      id: "future-out",
      debtor: "alice",
      creditor: "bob",
      amount: "400",
      status: "open",
      dueAt: Date.now() + 86400000,
    },
    {
      ...agreed,
      id: "future-in",
      debtor: "bob",
      creditor: "alice",
      amount: "400",
      status: "open",
      dueAt: Date.now() + 86400000,
    },
    {
      ...agreed,
      id: "held",
      debtor: "alice",
      creditor: "bob",
      amount: "100",
      status: "disputed",
    },
    {
      ...agreed,
      id: "proposal",
      debtor: "alice",
      creditor: "bob",
      amount: "700",
      status: "pending",
      debtorApproved: false,
      funded: false,
    },
    {
      ...agreed,
      id: "unbacked",
      debtor: "alice",
      creditor: "bob",
      amount: "200",
      status: "pending",
      funded: false,
    },
  ];
  client.provider.query = async (query) => {
    if (["get_risk", "get_statement"].includes(query.method_name))
      return { error: "HostError(GasLimitExceeded)" };
    const args = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(query.args_base64), (c) => c.charCodeAt(0)),
      ),
    );
    let value;
    switch (query.method_name) {
      case "get_security_config":
        value = protectedConfig;
        break;
      case "get_participants":
        value = participants;
        break;
      case "get_obligations":
        value = obligations.filter((o) => o.status === args.status);
        break;
      case "get_credit_limits":
        value = [];
        break;
      case "get_collateral_ratio":
        value = 1;
        break;
      case "get_stats":
        value = {
          openObligations: 2,
          pendingObligations: 2,
          disputedObligations: 1,
        };
        break;
      case "get_settlements":
        value = [];
        break;
      case "get_available_balance":
        value = {
          accountId: args.account_id,
          balance: "1000",
          reservedPayable: args.account_id === "alice" ? "500" : "400",
          reservedCollateral: args.account_id === "alice" ? "500" : "400",
          availableBalance: args.account_id === "alice" ? "500" : "600",
          withdrawalsEnabled: true,
        };
        break;
      default:
        throw new Error(`Unexpected test query ${query.method_name}`);
    }
    return { result: encode(value) };
  };
  return client;
}

test("protected reconciliation keeps disputed collateral and does not offset it with future receipts", async () => {
  const rows = await protectedFixture().getRisk();
  assert.equal(rows[0].grossPayable, "500");
  assert.equal(rows[0].grossReceivable, "400");
  assert.equal(rows[0].netPosition, "-100");
  assert.equal(rows[0].collateralRequired, "500");
  assert.equal(rows[0].availableBalance, "500");
  assert.equal(rows[0].pendingPayable, "900");
});

test("protected statements separate proposals and unbacked bills from committed exposure", async () => {
  const statement = await protectedFixture().getStatement("alice");
  assert.deepEqual(
    statement.openOutgoing.map((o) => o.id),
    ["future-out", "held"],
  );
  assert.deepEqual(
    statement.pendingOutgoing.map((o) => o.id),
    ["proposal", "unbacked"],
  );
  assert.equal(statement.availableBalance, "500");
  assert.equal(statement.reservedCollateral, "500");
});
