import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Worker, type NearAccount } from "near-workspaces";
import { requiredCollateral } from "../../../packages/client/src/amounts";

const WASM = new URL("../build/clearing-v3.wasm", import.meta.url).pathname;
const LEGACY = new URL("../build/clearing.wasm", import.meta.url).pathname;
const WITHDRAWAL_FAILURE_DRIVER = new URL(
  "../build/withdrawal-failure.wasm",
  import.meta.url,
).pathname;
const GAS = "300000000000000";
const NEAR = 10n ** 24n;

describe("ACH security and protected clearing", () => {
  let worker: Worker;
  let root: NearAccount;
  let sequence = 0;
  beforeAll(async () => {
    worker = await Worker.init({ network: "sandbox", rm: false });
    root = worker.rootAccount;
    expect(worker.provider.connection.url.startsWith("http://127.0.0.1:")).toBe(
      true,
    );
  });
  afterAll(async () => {
    if (worker) await worker.tearDown();
  });
  const call = (
    account: NearAccount,
    contract: NearAccount,
    method: string,
    args: object = {},
    attachedDeposit = "0",
  ) => account.call<any>(contract, method, args, { gas: GAS, attachedDeposit });
  async function fixture(count = 2, legacy = false) {
    const contract = await root.devDeploy(legacy ? LEGACY : WASM);
    await call(contract, contract, "init", { owner_id: root.accountId });
    const config: any = legacy
      ? { registrationDeposit: "0", proposalDeposit: "0" }
      : await contract.view("get_security_config");
    const accounts: NearAccount[] = [];
    const prefix = `secure-${++sequence}`;
    for (let i = 0; i < count; i++) {
      const account = await root.createSubAccount(`${prefix}-${i}`);
      await call(
        account,
        contract,
        "join",
        {
          name: `Agent ${i}`,
          kind: "agent",
          bio: "isolated security check",
          icon: "🤖",
        },
        config.registrationDeposit,
      );
      accounts.push(account);
    }
    return { contract, accounts, config };
  }
  async function deposit(
    contract: NearAccount,
    account: NearAccount,
    amount: bigint,
  ) {
    await call(account, contract, "deposit", {}, amount.toString());
  }
  async function propose(
    contract: NearAccount,
    proposer: NearAccount,
    debtor: NearAccount,
    creditor: NearAccount,
    amount: bigint,
    dueAt: number | null = null,
    legacy = false,
  ) {
    const config: any = legacy
      ? { proposalDeposit: "0" }
      : await contract.view("get_security_config");
    return call(
      proposer,
      contract,
      "record_obligation",
      {
        debtor: debtor.accountId,
        creditor: creditor.accountId,
        amount: amount.toString(),
        memo: "agreed service",
        due_at: dueAt,
      },
      config.proposalDeposit,
    );
  }
  const bill = (contract: NearAccount, id: string) =>
    contract.view<any>("get_obligation", { obligation_id: id });
  const balance = (contract: NearAccount, account: NearAccount) =>
    contract.view<string>("get_balance", { account_id: account.accountId });
  const available = (contract: NearAccount, account: NearAccount) =>
    contract.view<any>("get_available_balance", {
      account_id: account.accountId,
    });
  async function accepted(
    contract: NearAccount,
    debtor: NearAccount,
    creditor: NearAccount,
    amount: bigint,
    dueAt: number | null = null,
  ) {
    const invoice = await propose(
      contract,
      debtor,
      debtor,
      creditor,
      amount,
      dueAt,
    );
    await call(creditor, contract, "accept_obligation", {
      obligation_id: invoice.id,
    });
    return invoice;
  }

  it("starts new deployments with every protection enabled", async () => {
    const { config } = await fixture();
    expect(config).toMatchObject({
      version: 3,
      ready: true,
      bilateralApproval: true,
      strictDueTimes: true,
      reservedCollateral: true,
      bilateralDisputes: true,
    });
  });

  it("a creditor's proposal cannot create a debit without the debtor's approval", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, NEAR);
    const proposal = await propose(
      contract,
      creditor,
      debtor,
      creditor,
      NEAR / 10n,
    );
    expect(await bill(contract, proposal.id)).toMatchObject({
      status: "pending",
      debtorApproved: false,
      creditorApproved: true,
      funded: false,
    });
    expect(
      (await contract.view<any>("compute_net_positions", {})).obligationCount,
    ).toBe(0);
    expect((await available(contract, debtor)).reservedCollateral).toBe("0");
    await expect(call(creditor, contract, "clear")).rejects.toThrow(
      /Nothing to clear/,
    );
    expect(await balance(contract, debtor)).toBe(NEAR.toString());
  });

  it("debtor-originated terms also require the creditor's approval", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, NEAR);
    const proposal = await propose(
      contract,
      debtor,
      debtor,
      creditor,
      NEAR / 10n,
      Date.now() + 86400000,
    );
    expect(await bill(contract, proposal.id)).toMatchObject({
      debtorApproved: true,
      creditorApproved: false,
      status: "pending",
    });
    await expect(
      call(debtor, contract, "accept_obligation", {
        obligation_id: proposal.id,
      }),
    ).rejects.toThrow(/already approved/);
    expect((await available(contract, debtor)).reservedCollateral).toBe("0");
  });

  it("an unrelated account cannot approve or reject another party's bill", async () => {
    const {
      contract,
      accounts: [debtor, creditor, outsider],
    } = await fixture(3);
    const proposal = await propose(contract, creditor, debtor, creditor, 100n);
    await expect(
      call(outsider, contract, "accept_obligation", {
        obligation_id: proposal.id,
      }),
    ).rejects.toThrow(/bill's parties/);
    await expect(
      call(outsider, contract, "reject_obligation", {
        obligation_id: proposal.id,
      }),
    ).rejects.toThrow(/bill's parties/);
    expect((await bill(contract, proposal.id)).debtorApproved).toBe(false);
  });

  it("approval binds the stored amount and due time without accepting replacement terms", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, NEAR);
    const dueAt = Date.now() + 86400000;
    const proposal = await propose(
      contract,
      creditor,
      debtor,
      creditor,
      123n,
      dueAt,
    );
    await call(debtor, contract, "accept_obligation", {
      obligation_id: proposal.id,
      amount: "999999999",
      due_at: 1,
    });
    expect(await bill(contract, proposal.id)).toMatchObject({
      amount: "123",
      dueAt,
      status: "open",
      funded: true,
    });
  });

  it("unapproved proposals can be declined without deleting the audit record", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    const proposal = await propose(contract, creditor, debtor, creditor, 100n);
    await call(debtor, contract, "reject_obligation", {
      obligation_id: proposal.id,
    });
    expect((await bill(contract, proposal.id)).status).toBe("voided");
    expect((await contract.view<any>("get_stats")).obligationCount).toBe(1);
  });

  it("a replayed approval cannot change a funded or settled bill", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 100n);
    await expect(
      call(creditor, contract, "accept_obligation", {
        obligation_id: invoice.id,
      }),
    ).rejects.toThrow(/Only pending/);
    await call(creditor, contract, "clear");
    await expect(
      call(debtor, contract, "accept_obligation", {
        obligation_id: invoice.id,
      }),
    ).rejects.toThrow(/Only pending/);
    expect(await balance(contract, debtor)).toBe("900");
    await expect(
      call(debtor, contract, "fund_obligation", { obligation_id: invoice.id }),
    ).rejects.toThrow(/terminal/);
    expect((await bill(contract, invoice.id)).status).toBe("settled");
  });

  it("future bills cannot be settled through the old override argument", async () => {
    const {
      contract,
      accounts: [debtor, creditor, outsider],
    } = await fixture(3);
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(
      contract,
      debtor,
      creditor,
      100n,
      Date.now() + 86400000,
    );
    for (const value of [true, "true", 1, null]) {
      await expect(
        call(outsider, contract, "clear", { include_not_due: value }),
      ).rejects.toThrow(/cannot be cleared before/);
    }
    await expect(
      call(outsider, contract, "clear", { obligation_ids: [invoice.id] }),
    ).rejects.toThrow(/Only due/);
    expect(await balance(contract, debtor)).toBe("1000");
  });

  it("a read-only future projection does not authorize early settlement", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    await accepted(contract, debtor, creditor, 100n, Date.now() + 86400000);
    expect(
      (
        await contract.view<any>("compute_net_positions", {
          include_not_due: true,
        })
      ).obligationCount,
    ).toBe(1);
    expect(
      (await contract.view<any>("compute_net_positions", {})).obligationCount,
    ).toBe(0);
    expect((await contract.view<any>("get_clear_preview", {})).ready).toBe(
      false,
    );
  });

  it("matured bills become eligible and can be settled normally", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const block = await worker.provider.block({ finality: "final" });
    const dueAt =
      Number(BigInt(block.header.timestamp_nanosec) / 1000000n) + 60000;
    const invoice = await accepted(contract, debtor, creditor, 100n, dueAt);
    expect(
      (await contract.view<any>("compute_net_positions", {})).obligationCount,
    ).toBe(0);
    await worker.provider.fastForward(1000);
    await call(creditor, contract, "clear");
    expect((await bill(contract, invoice.id)).status).toBe("settled");
    expect(await balance(contract, debtor)).toBe("900");
  });

  it("only the free balance can be withdrawn while scheduled collateral stays locked", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    await accepted(contract, debtor, creditor, 400n, Date.now() + 86400000);
    expect(await available(contract, debtor)).toMatchObject({
      reservedCollateral: "400",
      availableBalance: "600",
    });
    await expect(
      call(debtor, contract, "withdraw", { amount: "1000" }, "1"),
    ).rejects.toThrow(/reserved collateral/);
    const withdrawn = await call(
      debtor,
      contract,
      "withdraw",
      { amount: "600" },
      "1",
    );
    expect(withdrawn).toMatchObject({
      withdrawn: "600",
      refunded: false,
      balance: "400",
    });
    expect((await available(contract, debtor)).availableBalance).toBe("0");
  });

  it("a future receivable cannot release collateral pledged to a different bill", async () => {
    const {
      contract,
      accounts: [alice, bob, carol],
    } = await fixture(3);
    await deposit(contract, alice, 1000n);
    await deposit(contract, carol, 400n);
    const dueAt = Date.now() + 86400000;
    await accepted(contract, alice, bob, 400n, dueAt);
    await accepted(contract, carol, alice, 400n, dueAt);
    const risk: any[] = await contract.view("get_risk");
    expect(risk.find((r) => r.accountId === alice.accountId)).toMatchObject({
      netPosition: "0",
      collateralRequired: "400",
      availableBalance: "600",
    });
    await expect(
      call(alice, contract, "withdraw", { amount: "1000" }, "1"),
    ).rejects.toThrow(/reserved collateral/);
  });

  it("settling a different due bill cannot spend scheduled collateral", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const future = await accepted(
      contract,
      debtor,
      creditor,
      800n,
      Date.now() + 86400000,
    );
    const due = await accepted(contract, debtor, creditor, 500n);
    expect(await bill(contract, due.id)).toMatchObject({
      status: "pending",
      debtorApproved: true,
      creditorApproved: true,
      funded: false,
    });
    const preview: any = await contract.view("get_clear_preview", {
      obligation_ids: [due.id],
    });
    expect(preview.ready).toBe(false);
    await expect(
      call(creditor, contract, "clear", { obligation_ids: [due.id] }),
    ).rejects.toThrow(/Risk check failed/);
    await deposit(contract, debtor, 300n);
    await call(creditor, contract, "clear", { obligation_ids: [due.id] });
    expect(await balance(contract, debtor)).toBe("800");
    expect((await bill(contract, future.id)).status).toBe("open");
    expect((await available(contract, debtor)).reservedCollateral).toBe("800");
  });

  it("disputed collateral remains locked and is excluded from clearing", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 400n);
    await call(creditor, contract, "dispute", { obligation_id: invoice.id });
    expect((await available(contract, debtor)).reservedCollateral).toBe("400");
    await expect(
      call(debtor, contract, "withdraw", { amount: "1000" }, "1"),
    ).rejects.toThrow(/reserved collateral/);
    await expect(call(creditor, contract, "clear")).rejects.toThrow(
      /Nothing to clear/,
    );
  });

  it("one party cannot cancel or resume its own dispute", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 400n);
    await call(debtor, contract, "dispute", { obligation_id: invoice.id });
    const vote = await call(debtor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "void",
    });
    expect(vote.awaitingCounterparty).toBe(true);
    expect((await bill(contract, invoice.id)).status).toBe("disputed");
    expect((await available(contract, debtor)).reservedCollateral).toBe("400");
    await call(debtor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "keep",
    });
    expect((await bill(contract, invoice.id)).status).toBe("disputed");
  });

  it("conflicting votes stay held; matching cancellation releases collateral once", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 400n);
    await call(debtor, contract, "dispute", { obligation_id: invoice.id });
    await call(debtor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "void",
    });
    await call(creditor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "keep",
    });
    expect((await bill(contract, invoice.id)).status).toBe("disputed");
    await call(creditor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "void",
    });
    expect((await bill(contract, invoice.id)).status).toBe("voided");
    expect((await available(contract, debtor)).reservedCollateral).toBe("0");
    await expect(
      call(debtor, contract, "resolve_dispute", {
        obligation_id: invoice.id,
        outcome: "void",
      }),
    ).rejects.toThrow(/Only disputed/);
  });

  it("matching resume votes allow settlement while stale votes cannot resolve a new dispute", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 400n);
    await call(debtor, contract, "dispute", { obligation_id: invoice.id });
    for (const party of [debtor, creditor])
      await call(party, contract, "resolve_dispute", {
        obligation_id: invoice.id,
        outcome: "keep",
      });
    expect((await bill(contract, invoice.id)).status).toBe("open");
    await call(creditor, contract, "dispute", { obligation_id: invoice.id });
    await call(debtor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "keep",
    });
    expect((await bill(contract, invoice.id)).status).toBe("disputed");
    await call(creditor, contract, "resolve_dispute", {
      obligation_id: invoice.id,
      outcome: "keep",
    });
    await call(creditor, contract, "clear");
    expect(await balance(contract, creditor)).toBe("400");
  });

  it("mutually approved zero-net cycles settle with no deposits or transfers", async () => {
    const { contract, accounts } = await fixture(3);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (await accepted(contract, accounts[i], accounts[(i + 1) % 3], 100n)).id,
      );
    const preview: any = await contract.view("get_clear_preview", {
      obligation_ids: ids,
    });
    expect(preview).toMatchObject({
      ready: true,
      netVolume: "0",
      obligationCount: 3,
      shortfalls: [],
    });
    const cleared = await call(accounts[0], contract, "clear", {
      obligation_ids: ids,
    });
    expect(cleared.transfers).toEqual([]);
    expect(cleared.obligationCount).toBe(3);
    for (const actor of accounts)
      expect(await balance(contract, actor)).toBe("0");
  });

  it("the standard five-bill example keeps its three-transfer settlement and conserves funds", async () => {
    const {
      contract,
      accounts: [alice, bob, carol, dave],
    } = await fixture(4);
    for (const actor of [alice, bob, carol, dave])
      await deposit(contract, actor, NEAR / 10n);
    for (const [debtor, creditor, amount] of [
      [alice, bob, 200n],
      [bob, carol, 150n],
      [carol, alice, 100n],
      [dave, bob, 60n],
      [alice, dave, 90n],
    ] as const)
      await accepted(contract, debtor, creditor, amount * 10n ** 20n);
    const preview: any = await contract.view("compute_net_positions", {});
    expect(preview.grossVolume).toBe((600n * 10n ** 20n).toString());
    expect(preview.netVolume).toBe((190n * 10n ** 20n).toString());
    expect(preview.transfers).toHaveLength(3);
    await call(carol, contract, "clear");
    const balances = await Promise.all(
      [alice, bob, carol, dave].map((actor) => balance(contract, actor)),
    );
    expect(balances.reduce((sum, value) => sum + BigInt(value), 0n)).toBe(
      4n * (NEAR / 10n),
    );
  });

  it("collateral arithmetic preserves one yocto and rounds fractional ratios upward", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await call(root, contract, "set_collateral_ratio", { ratio: 1.000001 });
    await deposit(contract, debtor, 2n);
    await accepted(contract, debtor, creditor, 1n);
    expect((await available(contract, debtor)).reservedCollateral).toBe("2");
    await expect(
      call(debtor, contract, "withdraw", { amount: "1" }, "1"),
    ).rejects.toThrow(/reserved collateral/);
    await call(creditor, contract, "clear");
    expect(await balance(contract, debtor)).toBe("1");
    expect(await balance(contract, creditor)).toBe("1");
  });

  it("normal NEAR amounts retain all 24 decimals in collateral calculations", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    const amount = NEAR + 1n;
    const collateral = requiredCollateral(amount, 1.333333);
    await call(root, contract, "set_collateral_ratio", { ratio: 1.333333 });
    await deposit(contract, debtor, collateral);
    await accepted(contract, debtor, creditor, amount);
    expect((await available(contract, debtor)).reservedCollateral).toBe(
      collateral.toString(),
    );
    await call(creditor, contract, "clear");
    expect(await balance(contract, debtor)).toBe(
      (collateral - amount).toString(),
    );
    expect(await balance(contract, creditor)).toBe(amount.toString());
  });

  it("collateral policies cannot authorize unfunded or negative-balance settlement", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    for (const ratio of [0, 0.5, -1, 11, 1.00000001])
      await expect(
        call(root, contract, "set_collateral_ratio", { ratio }),
      ).rejects.toThrow();
    await deposit(contract, debtor, 50n);
    await accepted(contract, debtor, creditor, 100n);
    await expect(call(creditor, contract, "clear")).rejects.toThrow(
      /Risk check failed/,
    );
    expect(await balance(contract, debtor)).toBe("50");
    expect(await balance(contract, creditor)).toBe("0");
  });

  it("credit limits remain independent of collateral and only the owner can change them", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    await accepted(contract, debtor, creditor, 100n);
    await expect(
      call(debtor, contract, "set_credit_limit", {
        account_id: debtor.accountId,
        limit: "1000",
      }),
    ).rejects.toThrow(/Only the owner/);
    await call(root, contract, "set_credit_limit", {
      account_id: debtor.accountId,
      limit: "99",
    });
    await expect(call(creditor, contract, "clear")).rejects.toThrow(
      /credit limit/,
    );
    await call(root, contract, "set_credit_limit", {
      account_id: debtor.accountId,
      limit: "100",
    });
    await call(creditor, contract, "clear");
    expect(await balance(contract, creditor)).toBe("100");
  });

  it("duplicate references and malformed clearing limits cannot double-spend a bill", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const invoice = await accepted(contract, debtor, creditor, 100n);
    await expect(
      call(creditor, contract, "clear", {
        obligation_ids: [invoice.id, invoice.id],
      }),
    ).rejects.toThrow(/duplicate/);
    for (const max of [0, -1, 1.5, "1", 201])
      await expect(
        call(creditor, contract, "clear", { max_obligations: max }),
      ).rejects.toThrow();
    expect(await balance(contract, debtor)).toBe("1000");
  });

  it("withdrawals require one yocto and private callbacks reject public spoofing", async () => {
    const {
      contract,
      accounts: [debtor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    await expect(
      call(debtor, contract, "withdraw", { amount: "100" }),
    ).rejects.toThrow(/one yocto/);
    await expect(
      call(debtor, contract, "on_withdrawal_complete", { withdrawal_id: 1 }),
    ).rejects.toThrow(/private|Private/i);
    expect(await balance(contract, debtor)).toBe("1000");
  });

  it("failed transfers restore the debited balance without unlocking bill collateral", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, NEAR);
    await accepted(
      contract,
      debtor,
      creditor,
      NEAR / 10n,
      Date.now() + 86400000,
    );
    const deployment = await debtor.deploy(WITHDRAWAL_FAILURE_DRIVER);
    expect(deployment.succeeded).toBe(true);
    const withdrawal = await debtor.callRaw(
      debtor,
      "withdraw_and_delete",
      {
        contract_id: contract.accountId,
        amount: (NEAR / 2n).toString(),
        beneficiary_id: root.accountId,
      },
      { gas: GAS },
    );
    expect(await debtor.exists()).toBe(false);
    expect(withdrawal.receiptFailureMessages.join("\n")).toMatch(
      /AccountDoesNotExist/,
    );
    expect(withdrawal.succeeded).toBe(true);
    expect(withdrawal.parseResult()).toMatchObject({
      withdrawn: "0",
      refunded: true,
      balance: NEAR.toString(),
    });
    expect(await balance(contract, debtor)).toBe(NEAR.toString());
    expect((await available(contract, debtor)).reservedCollateral).toBe(
      (NEAR / 10n).toString(),
    );
  });

  it("malformed amounts and timestamps do not create obligations", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
      config,
    } = await fixture();
    for (const amount of ["0", "-1", "0x10", "1.5", "1e24", "9".repeat(40)])
      await expect(
        call(
          debtor,
          contract,
          "record_obligation",
          {
            debtor: debtor.accountId,
            creditor: creditor.accountId,
            amount,
            memo: "bad",
            due_at: null,
          },
          config.proposalDeposit,
        ),
      ).rejects.toThrow();
    for (const due_at of [-1, 1.5, "123", 253402300800000])
      await expect(
        call(
          debtor,
          contract,
          "record_obligation",
          {
            debtor: debtor.accountId,
            creditor: creditor.accountId,
            amount: "100",
            memo: "bad",
            due_at,
          },
          config.proposalDeposit,
        ),
      ).rejects.toThrow(/Invalid due_at/);
    expect((await contract.view<any>("get_stats")).obligationCount).toBe(0);
  });

  it("storage spam cannot register accounts or proposals at the deposit pool's expense", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    const outsider = await root.createSubAccount(`storage-${++sequence}`);
    await expect(
      call(outsider, contract, "join", {
        name: "Outsider",
        kind: "agent",
        bio: "",
        icon: "",
      }),
    ).rejects.toThrow(/storage deposit/);
    await expect(
      call(debtor, contract, "record_obligation", {
        debtor: debtor.accountId,
        creditor: creditor.accountId,
        amount: "100",
        memo: "spam",
        due_at: null,
      }),
    ).rejects.toThrow(/storage deposit/);
    expect((await contract.view<any>("get_stats")).obligationCount).toBe(0);
  });

  it("history maintenance preserves pending and disputed claims and their collateral", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture();
    await deposit(contract, debtor, 1000n);
    const held = await accepted(contract, debtor, creditor, 400n);
    await call(debtor, contract, "dispute", { obligation_id: held.id });
    const pending = await propose(contract, creditor, debtor, creditor, 100n);
    await call(root, contract, "purge_history", { keep_settlements: 1 });
    expect((await bill(contract, held.id)).status).toBe("disputed");
    expect((await bill(contract, pending.id)).status).toBe("pending");
    expect((await available(contract, debtor)).reservedCollateral).toBe("400");
  });

  it("upgrades preserve balances, terms, identifiers, history and disputed collateral", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture(2, true);
    await deposit(contract, debtor, 1000n);
    await propose(contract, debtor, debtor, creditor, 100n, null, true);
    await call(creditor, contract, "clear");
    const scheduled = await propose(
      contract,
      debtor,
      debtor,
      creditor,
      300n,
      Date.now() + 86400000,
      true,
    );
    const held = await propose(
      contract,
      debtor,
      debtor,
      creditor,
      200n,
      null,
      true,
    );
    await call(creditor, contract, "dispute", { obligation_id: held.id });
    const beforeRounds: any = await contract.view("get_settlements", {});
    const beforeBalance = await balance(contract, debtor);
    const beforeRecords: any[] = await contract.view("get_obligations", {
      limit: 100,
    });
    await contract.deploy(WASM);
    await expect(
      call(debtor, contract, "withdraw", { amount: "1" }, "1"),
    ).rejects.toThrow(/legacy review/);
    await expect(call(creditor, contract, "clear")).rejects.toThrow(
      /legacy review/,
    );
    await call(root, contract, "start_security_upgrade");
    await expect(
      call(debtor, contract, "migrate_security_batch", { limit: 1 }),
    ).rejects.toThrow(/Only the owner/);
    await call(root, contract, "migrate_security_batch", { limit: 1 });
    await expect(
      call(root, contract, "finish_security_upgrade"),
    ).rejects.toThrow(/scan is incomplete/);
    await call(root, contract, "migrate_security_batch", { limit: 50 });
    await expect(
      call(root, contract, "finish_security_upgrade"),
    ).rejects.toThrow(/bilateral approval/);
    for (const id of [scheduled.id, held.id]) {
      await call(debtor, contract, "accept_obligation", { obligation_id: id });
      await call(creditor, contract, "accept_obligation", {
        obligation_id: id,
      });
    }
    await call(root, contract, "finish_security_upgrade");
    expect(await balance(contract, debtor)).toBe(beforeBalance);
    expect(await contract.view("get_settlements", {})).toEqual(beforeRounds);
    for (const original of beforeRecords) {
      const current = await bill(contract, original.id);
      for (const field of [
        "id",
        "debtor",
        "creditor",
        "amount",
        "memo",
        "createdAt",
        "dueAt",
      ])
        expect(current[field]).toEqual(original[field]);
    }
    expect((await bill(contract, held.id)).status).toBe("disputed");
    expect((await available(contract, debtor)).reservedCollateral).toBe("500");
    await expect(
      call(creditor, contract, "clear", { include_not_due: true }),
    ).rejects.toThrow(/cannot be cleared before/);
    const fresh = await accepted(contract, debtor, creditor, 100n);
    expect(fresh.id).not.toBe(scheduled.id);
    await call(creditor, contract, "clear");
    expect((await contract.view<any>("get_stats")).settlementCount).toBe(2);
    expect((await bill(contract, held.id)).status).toBe("disputed");
    expect((await available(contract, debtor)).reservedCollateral).toBe("500");
    await expect(
      call(debtor, contract, "fund_obligation", { obligation_id: fresh.id }),
    ).rejects.toThrow(/terminal/);
    expect((await bill(contract, fresh.id)).status).toBe("settled");
  });

  it("an underfunded legacy bill keeps the migration locked until backed and approved", async () => {
    const {
      contract,
      accounts: [debtor, creditor],
    } = await fixture(2, true);
    const invoice = await propose(
      contract,
      debtor,
      debtor,
      creditor,
      100n,
      null,
      true,
    );
    await contract.deploy(WASM);
    await call(root, contract, "start_security_upgrade");
    await call(root, contract, "migrate_security_batch", { limit: 50 });
    for (const actor of [debtor, creditor])
      await call(actor, contract, "accept_obligation", {
        obligation_id: invoice.id,
      });
    await expect(
      call(root, contract, "finish_security_upgrade"),
    ).rejects.toThrow(/bilateral approval/);
    await deposit(contract, debtor, 100n);
    await call(debtor, contract, "fund_obligation", {
      obligation_id: invoice.id,
    });
    await call(root, contract, "finish_security_upgrade");
    await call(creditor, contract, "clear");
    expect(await balance(contract, debtor)).toBe("0");
    expect(await balance(contract, creditor)).toBe("100");
    await expect(
      call(debtor, contract, "fund_obligation", { obligation_id: invoice.id }),
    ).rejects.toThrow(/terminal/);
    expect((await bill(contract, invoice.id)).status).toBe("settled");
  });
});
