/**
 * Report-only adversarial workflow checks against the existing Wasm and services.
 * Assertions describe the current behavior; no protocol fixes are applied here.
 * The imported setup also registers its existing commerce regression tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../../services/test/commerce.test.mjs';
import { v4NetPlan } from '../../packages/client/dist/v4.js';
import { validateArtifact } from '../../services/agents/artifacts.mjs';

const request = digit => ({
  request_id: digit.repeat(32),
  brief: 'Create an audited chart of the supplied service workloads.',
  mode: 'report',
  privacy: 'public',
});

const clearRequest = (h, digit, invoices) => ({
  request_id: digit.repeat(32),
  selected_accounts: h.session.participants.map(p => p.account_id),
  invoice_ids: invoices.map(i => i.spec.id),
});

async function fund(h, kind, amount, id) {
  const account_id = h.identities.get(kind).account_id;
  await h.chain.invoke(h.config.token, 'mint', { account_id, amount }, {
    account: h.identities.get('coordinator').account_id, deposit: 1n,
  });
  await h.owners.get(kind).deposit(id, amount);
}

function spec(h, { id, purchase_id = id, seller = 'visual', amount = '100000' }) {
  return {
    id, purchase_id, terms_version: 1,
    buyer: h.identities.get('research').account_id,
    seller: h.identities.get(seller).account_id,
    asset: h.config.token, amount, service: 'chart',
    terms_hash: 'a'.repeat(64), artifact_hash: 'b'.repeat(64),
    ready_at_ms: h.chain.now, expires_at_ms: h.chain.now + 100000,
  };
}

test('AUDIT: an accepted invoice remains unpaid after its owner withdraws unreserved funds', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, { ...request('1'), mode: 'chart' });
    const before = await h.coordinator.snapshot(h.session);
    const buyer = h.identities.get('research');
    assert.equal(before.invoices[0].status, 'ACCEPTED');
    assert.equal((await buyer.client.balance()).reserved, '0');
    assert.equal((await buyer.client.balance()).gross_purchase_budget_used, '100000');
    await h.owners.get('research').withdraw('audit-remove-unreserved-funds', '1000000');
    assert.equal((await h.owners.get('research').withdrawal('audit-remove-unreserved-funds')).status, 'COMPLETED');
    const result = await h.coordinator.clear(h.session, clearRequest(h, '2', before.invoices));
    assert.equal(result.state, 'WAITING');
    assert.equal(result.reason, 'INSUFFICIENT_AVAILABLE_BALANCE');
    assert.equal(result.round, null);
    assert.equal((await buyer.client.invoice(before.invoices[0].spec.id)).status, 'ACCEPTED');
    assert.equal((await h.identities.get('visual').client.balance()).available, '0');
    assert.equal(await buyer.client.transport.view(h.config.token, 'ft_balance_of', { account_id: buyer.account_id }), '1000000');
  } finally { h.cleanup(); }
});

test('AUDIT: refusing the final invoice can leave honest subcontractors paid by the provider', async () => {
  const h = await setup();
  try {
    await fund(h, 'visual', '100000', 'audit-provider-own-capital');
    const buyer = h.actors.get('research');
    const dispatch = buyer.dispatch;
    let delivered;
    buyer.dispatch = async (...args) => {
      const result = await dispatch(...args);
      if (args[0] === 'visual') delivered = result;
      return result;
    };
    const accept = h.identities.get('research').client.acceptInvoice.bind(h.identities.get('research').client);
    h.identities.get('research').client.acceptInvoice = invoice => {
      if (invoice.spec.service === 'chart') throw new Error('BUYER_REFUSES_FINAL_INVOICE');
      return accept(invoice);
    };
    await assert.rejects(h.coordinator.run(h.session, request('3')), /BUYER_REFUSES_FINAL_INVOICE/);
    assert.equal(validateArtifact('chart', delivered.artifact), true, 'the buyer received usable work before acceptance');
    const before = await h.coordinator.snapshot(h.session);
    const final = before.invoices.find(i => i.spec.service === 'chart');
    assert.equal(final.status, 'PROPOSED');
    assert.equal(final.buyer_acceptance, null);
    assert.ok(final.seller_acceptance);
    assert.equal(before.invoices.filter(i => i.status === 'ACCEPTED').length, 2);
    h.chain.now += 31000;
    await h.coordinator.tick();
    const after = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(after.invoices.filter(i => i.status === 'SETTLED').length, 2);
    assert.equal((await h.identities.get('visual').client.balance()).available, '0');
    assert.equal((await h.identities.get('research').client.balance()).available, '1080000');
    assert.equal((await h.identities.get('audit').client.balance()).available, '20000');
    assert.equal(after.rounds[0].net_settlement_volume, '100000');
  } finally { h.cleanup(); }
});

test('AUDIT: an honest subgroup clears despite refusal, with fresh funding math and two bills outstanding', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, request('4'));
    const before = await h.coordinator.snapshot(h.session);
    assert.equal(v4NetPlan(before.invoices.map(i => i.spec)).net_settlement_volume, '20000');
    h.actors.get('research').approve = async () => { throw new Error('PARTICIPANT_REFUSES'); };
    const blocked = await h.coordinator.clear(h.session, clearRequest(h, '5', before.invoices));
    assert.equal(blocked.state, 'WAITING');
    assert.equal(blocked.reason, 'PARTICIPANT_REFUSES');
    const honest = before.invoices.filter(i => i.spec.buyer === h.identities.get('visual').account_id);
    const subgroup = {
      ...clearRequest(h, '6', honest),
      selected_accounts: ['visual', 'audit'].map(kind => h.identities.get(kind).account_id),
    };
    const unfunded = await h.coordinator.clear(h.session, subgroup);
    assert.equal(unfunded.reason, 'INSUFFICIENT_AVAILABLE_BALANCE');
    await fund(h, 'visual', '100000', 'audit-subgroup-funding');
    const settled = await h.coordinator.clear(h.session, subgroup);
    assert.equal(settled.round.status, 'SETTLED');
    assert.equal(settled.round.net_settlement_volume, '100000');
    assert.equal(settled.round.approvals.length, 2);
    assert.ok(settled.round.input.positions.every(p => p.account_id !== h.identities.get('research').account_id));
    const after = await h.coordinator.snapshot(h.session);
    assert.equal(after.invoices.filter(i => i.status === 'ACCEPTED').length, 2);
    assert.equal(after.invoices.filter(i => i.status === 'SETTLED').length, 1);
  } finally { h.cleanup(); }
});

test('AUDIT: bills excluded from a manual round are later cleared automatically under standing permissions', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, request('7'));
    const before = await h.coordinator.snapshot(h.session);
    const selected = before.invoices.filter(i => i.spec.service === 'chart');
    const first = await h.coordinator.clear(h.session, {
      ...clearRequest(h, '8', selected),
      selected_accounts: ['research', 'visual'].map(kind => h.identities.get(kind).account_id),
    });
    assert.equal(first.round.net_settlement_volume, '100000');
    assert.equal((await h.coordinator.snapshot(h.session)).invoices.filter(i => i.status === 'ACCEPTED').length, 2);
    h.chain.now += 31000;
    await h.coordinator.tick();
    const after = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.ok(after.invoices.every(i => i.status === 'SETTLED'));
    assert.equal(after.rounds.length, 2);
    assert.equal(after.rounds.reduce((sum, r) => sum + BigInt(r.net_settlement_volume), 0n), 200000n);
    assert.equal(after.rounds[1].net_settlement_volume, '100000');
  } finally { h.cleanup(); }
});

test('AUDIT: a selective debtor collects an accepted credit, withdraws it and leaves its accepted debt unpaid', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, request('a'));
    const before = await h.coordinator.snapshot(h.session);
    assert.equal(before.invoices.length, 3);
    assert.ok(before.invoices.every(i => i.status === 'ACCEPTED'));
    assert.equal(v4NetPlan(before.invoices.map(i => i.spec)).net_settlement_volume, '20000');
    const audit = h.identities.get('audit');
    const unpaid = before.invoices.find(i => i.spec.buyer === audit.account_id);
    const approve = h.actors.get('audit').approve.bind(h.actors.get('audit'));
    let refusedGroups = 0;
    let acceptedCredits = 0;
    h.actors.get('audit').approve = async (session, round) => {
      if (round.input.invoice_ids.includes(unpaid.spec.id)) {
        refusedGroups++;
        throw new Error('SELECTIVE_DEBTOR_REFUSES');
      }
      const position = round.input.positions.find(p => p.account_id === audit.account_id);
      assert.ok(position && BigInt(position.net) > 0n);
      acceptedCredits++;
      return approve(session, round);
    };

    h.chain.now += 31000;
    await h.coordinator.tick();
    const first = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(first.invoices.filter(i => i.status === 'SETTLED').length, 1);
    assert.equal((await h.identities.get('research').client.balance()).available, '900000');
    assert.equal((await h.identities.get('visual').client.balance()).available, '100000');

    await h.coordinator.tick();
    const collected = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(collected.invoices.filter(i => i.status === 'SETTLED').length, 2);
    assert.equal((await audit.client.balance()).available, '100000');
    assert.equal((await audit.client.balance()).reserved, '0');
    assert.equal((await audit.client.invoice(unpaid.spec.id)).status, 'ACCEPTED');
    assert.ok(refusedGroups >= 2);
    assert.equal(acceptedCredits, 1);

    await h.owners.get('audit').withdraw('audit-selective-credit-cashout', '100000');
    assert.equal((await h.owners.get('audit').withdrawal('audit-selective-credit-cashout')).status, 'COMPLETED');
    await h.coordinator.tick();
    const after = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(after.invoices.filter(i => i.status === 'SETTLED').length, 2);
    assert.equal((await audit.client.invoice(unpaid.spec.id)).status, 'ACCEPTED');
    assert.equal((await audit.client.balance()).available, '0');
    assert.equal((await h.identities.get('visual').client.balance()).available, '0');
    assert.equal((await h.identities.get('research').client.balance()).available, '900000');
    assert.equal(await audit.client.transport.view(h.config.token, 'ft_balance_of', { account_id: audit.account_id }), '100000');
    assert.equal(after.rounds.filter(r => r.status === 'SETTLED').reduce((sum, r) => sum + BigInt(r.net_settlement_volume), 0n), 200000n);
  } finally { h.cleanup(); }
});

test('AUDIT: a pending private purchase keeps allowance when only its buyer cancels', async () => {
  const h = await setup({ privateMode: true });
  try {
    const buyer = h.identities.get('research');
    const key = (await buyer.client.balance()).policy.key;
    await h.owners.get('research').setPolicy({
      key, max_invoice: '100000', gross_budget: '100000', max_net_commitment: '100000',
      expires_at_ms: h.chain.now + 86400000, counterparties: [], services: [],
    }, 'audit-private-limited-policy');
    const order = (await buyer.client.authorizePrivatePurchase({
      purchase_id: '9'.repeat(32), terms_version: 1,
      seller: h.identities.get('visual').account_id, order_commitment: 'a'.repeat(64),
    })).value;
    await h.owners.get('research').cancelPendingPrivatePurchase(order);
    h.chain.now += 600000;
    const pending = await buyer.client.privatePurchase(order.charge_id);
    assert.equal(pending.status, 'AUTHORIZED');
    assert.equal(pending.buyer_cancelled, true);
    assert.equal(pending.seller_cancelled, false);
    assert.equal((await buyer.client.balance()).gross_purchase_budget_used, '100000');
    assert.equal((await buyer.client.balance()).reserved, '0', 'allowance is stranded, not payment funds');
    await assert.rejects(buyer.client.authorizePrivatePurchase({
      purchase_id: 'b'.repeat(32), terms_version: 1,
      seller: h.identities.get('audit').account_id, order_commitment: 'b'.repeat(64),
    }), /GROSS_PURCHASE_BUDGET_EXCEEDED/);
    await h.owners.get('visual').cancelPendingPrivatePurchase(pending);
    assert.equal((await buyer.client.balance()).gross_purchase_budget_used, '0');
  } finally { h.cleanup(); }
});

test('AUDIT: automatic clearing overlooks a funded zero-net subgroup when the full set is underfunded', async () => {
  const h = await setup();
  try {
    await h.owners.get('research').withdraw('audit-isolate-empty-group', '1000000');
    const makeInvoice = async (id, buyerKind, sellerKind) => {
      const invoiceSpec = {
        ...spec(h, { id, seller: sellerKind }),
        buyer: h.identities.get(buyerKind).account_id,
      };
      const invoice = (await h.identities.get(sellerKind).client.proposeInvoice(invoiceSpec)).value;
      await h.identities.get(sellerKind).client.acceptInvoice(invoice);
      return (await h.identities.get(buyerKind).client.acceptInvoice(invoice)).value;
    };
    const va = await makeInvoice('audit-cycle-visual-audit', 'visual', 'audit');
    const av = await makeInvoice('audit-cycle-audit-visual', 'audit', 'visual');
    await makeInvoice('audit-underfunded-research-audit', 'research', 'audit');
    h.chain.now += 31000;
    await h.coordinator.tick();
    const automatic = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(automatic.rounds.length, 0, 'full-set and singleton attempts both miss the feasible subgroup');
    assert.equal(automatic.invoices.filter(i => i.status === 'ACCEPTED').length, 3);
    const manual = await h.coordinator.clear(h.session, {
      ...clearRequest(h, 'f', [va, av]),
      selected_accounts: ['visual', 'audit'].map(kind => h.identities.get(kind).account_id),
    });
    assert.equal(manual.round.status, 'SETTLED');
    assert.equal(manual.round.net_settlement_volume, '0');
    assert.equal(manual.round.approvals.length, 2);
    assert.equal((await h.coordinator.snapshot(h.session)).invoices.filter(i => i.status === 'ACCEPTED').length, 1);
  } finally { h.cleanup(); }
});

test('AUDIT: an unapproved seller can occupy a known buyer purchase ID despite the buyer allowlist', async () => {
  const h = await setup();
  try {
    const buyer = h.identities.get('research');
    await h.owners.get('research').setPolicy({
      key: (await buyer.client.balance()).policy.key,
      max_invoice: '100000', gross_budget: '1000000', max_net_commitment: '1000000',
      expires_at_ms: h.chain.now + 86400000,
      counterparties: [h.identities.get('visual').account_id], services: ['chart'],
    }, 'audit-buyer-allowlist');
    const purchase_id = 'c'.repeat(32);
    const poisoned = (await h.identities.get('audit').client.proposeInvoice(spec(h, {
      id: 'audit-poisoned-purchase', purchase_id, seller: 'audit', amount: '1',
    }))).value;
    assert.equal(poisoned.buyer_acceptance, null);
    await assert.rejects(buyer.client.acceptInvoice(poisoned), /COUNTERPARTY_NOT_ALLOWED/);
    await assert.rejects(h.identities.get('visual').client.proposeInvoice(spec(h, {
      id: 'audit-legitimate-purchase', purchase_id,
    })), /PURCHASE_ALREADY_INVOICED/);
    assert.equal((await buyer.client.balance()).gross_purchase_budget_used, '0');
    assert.equal((await buyer.client.balance()).available, '1000000');
  } finally { h.cleanup(); }
});

test('AUDIT: unaccepted invoice proposals consume shared sponsor storage until new business stops', async () => {
  const h = await setup();
  try {
    const storageBytes = () => [...h.chain.contracts.get(h.config.vault).storage]
      .reduce((sum, [k, value]) => sum + Buffer.byteLength(k) + value.length + 64, 0);
    const initialBytes = storageBytes();
    const native = BigInt(initialBytes) * 10n ** 19n + 300000000000000000000000n;
    const attacker = h.session.participants.find(p => p.kind === 'audit');
    let successful = 0;
    for (let n = 0; n < 100; n++) {
      try {
        await h.chain.invoke(h.config.vault, 'propose_invoice', {
          spec: spec(h, { id: 'audit-storage-spam-' + n, seller: 'audit', amount: '1' }),
        }, { account: attacker.account_id, key: attacker.public_key, checkKey: true, native });
        successful++;
      } catch (error) {
        assert.match(error.message, /SPONSOR_STORAGE_HEADROOM_REQUIRED/);
        break;
      }
    }
    assert.ok(successful > 0 && successful < 100);
    assert.ok(storageBytes() > initialBytes);
    assert.equal((await h.identities.get('research').client.balance()).gross_purchase_budget_used, '0');
    await assert.rejects(h.chain.invoke(h.config.vault, 'propose_invoice', {
      spec: spec(h, { id: 'audit-real-work-after-spam' }),
    }, {
      account: h.identities.get('visual').account_id,
      key: h.session.participants.find(p => p.kind === 'visual').public_key,
      checkKey: true, native,
    }), /SPONSOR_STORAGE_HEADROOM_REQUIRED/);
    const recovered = await h.chain.invoke(h.config.vault, 'request_recovery_withdrawal', {
      nonce: 1, expected_available: '1000000',
    }, { account: h.identities.get('research').account_id, key: 'f'.repeat(64), deposit: 1n, checkKey: true, native });
    assert.equal(recovered.value.status, 'PENDING');
    assert.equal((await h.identities.get('research').client.recoveryWithdrawal()).status, 'COMPLETED');
  } finally { h.cleanup(); }
});

test('AUDIT: funded final approvals prevent withdrawal, cancellation and repeat payment', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, request('d'));
    const before = await h.coordinator.snapshot(h.session);
    const client = h.identities.get('coordinator').client;
    let round = (await client.proposeRound('audit-final-commitment', before.invoices.map(i => i.spec.id), h.chain.now + 300000)).value;
    assert.throws(() => h.identities.get('research').client.authorizeRound(round, '-1'), /EXACT_NET_AUTHORIZATION_REQUIRED/);
    for (const participant of h.session.participants) round = (await h.actors.get(participant.kind).approve(h.session, round)).value;
    assert.equal(round.status, 'READY');
    assert.equal((await h.identities.get('research').client.balance()).reserved, '20000');
    await assert.rejects(h.owners.get('research').withdraw('audit-try-spend-reserved', '1000000'), /INSUFFICIENT_AVAILABLE_BALANCE/);
    await assert.rejects(h.owners.get('research').cancelRound(round), /ROUND_IS_IRREVOCABLE/);
    await h.owners.get('research').revokeAgent('audit-revoke-after-ready');
    await client.settleRound(round);
    await client.settleRound(round);
    assert.equal((await h.identities.get('research').client.balance()).available, '980000');
    assert.equal((await h.identities.get('audit').client.balance()).available, '20000');
    assert.equal((await client.transport.view(h.config.vault, 'get_config', {})).settled_rounds, 1);
  } finally { h.cleanup(); }
});

test('AUDIT: background settlement and owner transfers exist on chain but lack session receipt events', async () => {
  const h = await setup();
  try {
    await h.coordinator.run(h.session, request('e'));
    const before = await h.coordinator.snapshot(h.session);
    const client = h.identities.get('coordinator').client;
    let round = (await client.proposeRound('audit-background-ready', before.invoices.map(i => i.spec.id), h.chain.now + 300000)).value;
    h.coordinator.appendRound(h.session, round.input.id);
    for (const participant of h.session.participants) round = (await h.actors.get(participant.kind).approve(h.session, round)).value;
    assert.equal(round.status, 'READY');
    await h.coordinator.tick();
    await h.owners.get('audit').withdraw('audit-history-withdrawal', '20000');
    await h.owners.get('audit').revokeAgent('audit-history-revoke');
    const after = await h.coordinator.snapshot(h.store.session(h.session.id));
    assert.equal(after.rounds[0].status, 'SETTLED');
    assert.equal((await h.owners.get('audit').withdrawal('audit-history-withdrawal')).status, 'COMPLETED');
    assert.equal(after.events.filter(e => e.kind === 'round-settled').length, 0);
    assert.equal(after.events.filter(e => /withdraw|deposit|revoke/.test(e.kind)).length, 0);
    const activity = await h.identities.get('audit').client.listActivity();
    assert.ok(activity.items.some(e => e.kind === 'round-settled'));
    assert.ok(activity.items.some(e => e.kind === 'withdrawal-completed'));
    assert.ok(activity.items.some(e => e.kind === 'agent-revoked'));
  } finally { h.cleanup(); }
});

test('AUDIT: a snapshot exposes the first 100 session events and omits later events', async () => {
  const h = await setup();
  try {
    for (let n = 0; n < 105; n++) h.store.event(h.session.id, 'audit-only-event', 'fixture-' + n);
    const snapshot = await h.coordinator.snapshot(h.session);
    assert.equal(snapshot.events.length, 100);
    assert.equal(snapshot.events[0].reference, 'fixture-0');
    assert.equal(snapshot.events.at(-1).reference, 'fixture-99');
    assert.equal(h.store.events(h.session.id, snapshot.events.at(-1).sequence).length, 5);
  } finally { h.cleanup(); }
});
