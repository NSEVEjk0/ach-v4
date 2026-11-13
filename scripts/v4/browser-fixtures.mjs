import assert from 'node:assert/strict';

export async function navigateWorkspace(page, label) {
  const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await opener.isVisible()) await opener.click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: new RegExp('^' + label) }).click();
  await page.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor();
}

function snapshot(config) {
  const now = Date.now();
  const members = ['Research Desk', 'Visual Studio', 'Audit Desk'].map((name, n) => ({
    name, kind: ['research', 'visual', 'audit'][n], account_id: ['a', 'b', 'c'][n] + '.ui-fixture.testnet', public_key: 'a'.repeat(64),
  }));
  const [a, b, c] = members.map(p => p.account_id);
  const invoices = [[a, b, '100000000'], [b, c, '80000000'], [c, a, '60000000']].map(([buyer, seller, amount], n) => ({
    spec: { id: 'explicit-ui-fixture-' + n, purchase_id: 'ui-purchase-' + n, terms_version: 1, buyer, seller, amount, asset: config.token,
      service: ['chart', 'audit', 'references'][n], terms_hash: 'e'.repeat(64), artifact_hash: 'b'.repeat(64), ready_at_ms: now, expires_at_ms: now + 600000 },
    hash: 'c'.repeat(64), status: 'ACCEPTED', round_id: null,
  }));
  const positions = [{ account_id: a, net: '-40000000' }, { account_id: b, net: '20000000' }, { account_id: c, net: '20000000' }];
  const round = {
    input: { id: 'explicit-ui-round-fixture', positions, invoice_ids: invoices.map(i => i.spec.id), invoice_hashes: invoices.map(i => i.hash), deadline_ms: now + 300000, private: false },
    hash: 'd'.repeat(64), proposer: a, status: 'COLLECTING', approvals: [{ account_id: a, required: '40000000', expected_net: '-40000000', approved_at_ms: now }],
    gross_invoice_volume: '240000000', net_settlement_volume: '40000000', settled_at_ms: null, reason: null,
  };
  return {
    session: { id: 'explicit-ui-fixture-only', participants: members, initial_balance: '1000000', created_at_ms: now, expires_at_ms: now + 86400000, state: 'READY',clearing_policy:{mode:'manual'} },
    deployment: { ...config },
    balances: members.map((p, n) => ({ account_id: p.account_id, name: p.name, balance: n === 0 ? '90000000' : '0', reserved: n === 0 ? '40000000' : '0', available: n === 0 ? '50000000' : '0', pending_withdrawals: '0', gross_purchase_budget_used: '0',
      policy: { max_invoice: '100000000', gross_budget: '1000000000', max_net_commitment: '1000000000', expires_at_ms: now + 86400000, revoked: false } })),
    invoices, private_invoices: [], rounds: [round], jobs: [], events: [], last_sync_at_ms: now, financial_data_available: true,
    external_balances: members.map(p => ({ account_id: p.account_id, amount: '0' })), recovery_withdrawals: [], private_data_available: true, pending_actions: [],
    privacy: { enabled: true, verified: true, reason: 'Explicit local UI fixture. No transaction was created.' },
    intents: { enabled: true, network: 'mainnet', reason: 'Controlled quote fixture. No funds are sent.' },
  };
}

export async function uiFixtures({ browser, base, config, check, layout }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  let state = snapshot(config);
  const clearRequests = [], quoteRequests = [];
  const catalogue = [
    {assetId:'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',blockchain:'near',symbol:'USDC',decimals:6},
    {assetId:'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',blockchain:'base',symbol:'USDC',decimals:6},
    {assetId:'nep141:eth.omft.near',blockchain:'eth',symbol:'ETH',decimals:18,price:2000},
    {assetId:'nep141:sol.omft.near',blockchain:'sol',symbol:'SOL',decimals:9,price:150}
  ];
  const refresh = async () => { await page.getByRole('button', { name: 'Refresh confirmed state' }).click(); await page.waitForTimeout(250); };
  try {
    await page.route('**/api/v4/snapshot', route => route.fulfill({ json: state }));
    await page.route('**/api/v4/clear', route => {
      clearRequests.push(route.request().postDataJSON());
      return route.fulfill({ json: { state: 'WAITING', round: state.rounds[0] } });
    });
    await page.route('**/api/v4/intents/tokens', route=>route.fulfill({json:catalogue}));
    await page.route('**/api/v4/intents/quote', route => {
      const request = route.request().postDataJSON(); quoteRequests.push(request);
      return route.fulfill({ json: {
        id: request.request_id, direction: request.direction, network: 'mainnet', state: 'QUOTED', dry: true,
        request: { recipient: request.recipient, refundTo: request.refund_to, amount: request.amount, deadline: new Date(Date.now() + 300000).toISOString() },
        source: request.direction==='funding'?catalogue.find(t=>t.assetId===request.asset_id):catalogue[0], destination: request.direction==='funding'?catalogue[0]:catalogue.find(t=>t.assetId===request.asset_id),
        response: { quote: { amountOut: '9990000', minAmountOut: '9890000', timeEstimate: 20, deadline: new Date(Date.now() + (quoteRequests.length === 1 ? 1000 : 300000)).toISOString() } },
      } });
    });
    await page.goto(base + '/workspace', { waitUntil: 'domcontentloaded' });
    await page.locator('.wallet-summary').waitFor();
    await layout(page, 'fixture-overview', 1440, 1000);
    await layout(page, 'fixture-overview', 390, 844);

    await navigateWorkspace(page, 'Work');
    assert.equal(await page.locator('#wallet-scope').count(), 0, 'wallet selection must not imply another purchasing agent');
    await page.locator('#brief').fill('Keep this draft while I check the payment history.');
    await page.locator('#dataset').fill('Requests,91\nChecks,64');
    await navigateWorkspace(page, 'History');
    await page.getByLabel('History type').selectOption('payments');
    await page.getByLabel('Search history').fill('Chart');
    assert.equal(await page.locator('.history-surface a.history-row').count(), 1);
    assert.ok(new URL(page.url()).searchParams.get('q') === 'Chart');
    const historyUrl = page.url();
    await page.locator('.history-surface a.history-row').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close details');
    for (let n = 0; n < 8; n++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))); }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(page.url(), historyUrl);
    assert.ok(await page.locator('.history-surface a.history-row').evaluate(el => el === document.activeElement));
    check('ui-history-filter-drawer-and-keyboard-focus');

    await navigateWorkspace(page, 'Payments');
    await page.locator('.page-heading > .back-link').click();
    await page.getByRole('heading', { name: 'History', exact: true, level: 1 }).waitFor();
    assert.equal(await page.getByLabel('Search history').inputValue(), 'Chart');
    await page.goForward();
    await page.getByRole('heading', { name: 'Payments', exact: true, level: 1 }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'History', exact: true, level: 1 }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.history-surface').waitFor();
    assert.equal(await page.getByLabel('History type').inputValue(), 'payments');
    assert.equal(await page.getByLabel('Search history').inputValue(), 'Chart');
    check('ui-direct-history-url-back-and-forward');
    await navigateWorkspace(page, 'Work');
    await page.locator('#brief').fill('Preserve this brief across in-app navigation.');
    await page.locator('#dataset').fill('Requests,91\nChecks,64');
    await navigateWorkspace(page, 'Overview');
    await page.locator('.overview-work').getByRole('button', { name: 'Create a brief' }).click();
    assert.equal(await page.locator('#brief').inputValue(), 'Preserve this brief across in-app navigation.');
    assert.equal(await page.locator('#dataset').inputValue(), 'Requests,91\nChecks,64');
    await layout(page, 'fixture-work', 1440, 1000);
    await layout(page, 'fixture-work', 390, 844);
    check('ui-drafts-preserved-across-navigation');

    await navigateWorkspace(page, 'Clearing');
    const clear = page.getByRole('button', { name: 'Clear selected bills', exact: true });
    assert.match(await page.locator('.net-summary').innerText(), /40\.00/);
    assert.ok(await clear.isEnabled());
    await clear.click();
    assert.equal(clearRequests.length, 1); assert.equal(clearRequests[0].invoice_ids.length, 3);
    await page.getByRole('checkbox', { name: /Audit Desk/ }).uncheck();
    assert.match(await page.locator('.selection-notice').innerText(), /100\.00.*40\.00/);
    assert.ok(await clear.isDisabled());
    assert.match(await page.locator('.funding-error').innerText(), /100\.00.*50\.00/);
    check('ui-fixture-subgroup-and-insufficient-funds', { full_units: '40000000', subgroup_units: '100000000', excluded_bills: 2 });
    state.balances[0] = { ...state.balances[0], balance: '150000000', available: '110000000' };
    await refresh(); await clear.click();
    assert.equal(clearRequests.length, 2); assert.notEqual(clearRequests[0].request_id, clearRequests[1].request_id);
    assert.deepEqual(clearRequests[1].invoice_ids, ['explicit-ui-fixture-0']);
    assert.equal(clearRequests[1].selected_accounts.length, 2);
    assert.equal(state.invoices.filter(i => i.status === 'ACCEPTED').length, 3);
    check('ui-fixture-new-group-new-consent');
    await page.getByRole('checkbox', { name: /Audit Desk/ }).check();
    await page.getByRole('checkbox', { name: 'Include Reference packet payment explicit-ui-fixture-2', exact: true }).uncheck();
    assert.match(await page.locator('.net-summary').innerText(), /100\.00/);
    await page.getByRole('checkbox', { name: 'Include Reference packet payment explicit-ui-fixture-2', exact: true }).check();
    check('ui-exact-invoice-selection-recalculates-net');

    const roundButton = page.locator('.round-list-item').first();
    await roundButton.click();
    assert.equal(await roundButton.getAttribute('aria-expanded'), 'true');
    assert.ok(new URL(page.url()).searchParams.get('round') === state.rounds[0].input.id);
    const details = page.locator('.round-details');
    assert.match(await details.locator('.round-totals').innerText(), /240\.00[\s\S]*200\.00[\s\S]*40\.00/);
    const rows = await details.locator('.net-calculation-table tbody tr').allTextContents();
    assert.match(rows[0], /Research Desk.*60\.00.*100\.00.*Pays.*40\.00/);
    assert.match(rows[1], /Visual Studio.*100\.00.*80\.00.*Receives.*20\.00/);
    assert.match(rows[2], /Audit Desk.*80\.00.*60\.00.*Receives.*20\.00/);
    assert.equal(await details.locator('.approval-row').count(), 3);
    assert.equal(await details.getByText('Waiting', { exact: true }).count(), 2);
    const [download] = await Promise.all([page.waitForEvent('download'), details.getByRole('link', { name: 'Download round record' }).click()]);
    assert.equal(download.suggestedFilename(), 'ach-clearing-round.json');
    await layout(page, 'fixture-expanded-round', 1440, 1000);
    await layout(page, 'fixture-expanded-round', 390, 844);
    await layout(page, 'fixture-expanded-round', 320, 844);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.round-details').waitFor();
    assert.equal(await page.locator('.round-list-item').first().getAttribute('aria-expanded'), 'true');
    await page.locator('.round-list-item').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.round-list-item').first().getAttribute('aria-expanded'), 'false');
    check('ui-expandable-round-calculation-approvals-record-and-deep-link');

    await navigateWorkspace(page, 'Wallets');
    await page.getByRole('button', { name: 'Preview a route', exact: true }).click();
    await page.getByLabel('Receiving NEAR account').fill('owner.near');
    await page.getByLabel('Refund Base account').fill('0x' + '1'.repeat(40));
    await page.getByRole('button', { name: 'Get a mainnet quote', exact: true }).click();
    await page.getByText('Quote expired', { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Get a mainnet quote', exact: true }).click();
    await page.getByText('No transfer sent', { exact: true }).waitFor();
    assert.equal(quoteRequests.length, 2); assert.notEqual(quoteRequests[0].request_id, quoteRequests[1].request_id);
    assert.match(await page.locator('.route-review').innerText(), /9\.89 USDC/);
    check('ui-fixture-quote-expiry-and-refresh', { provider_deadline_precedes_request: true });
    await page.locator('.route-form').getByRole('combobox',{name:/^Chain/}).selectOption('eth');
    await page.getByLabel('Amount in ETH').fill('0.123456789012345678');
    await page.getByLabel('Refund Ethereum account').fill('0x'+'1'.repeat(40));
    await page.getByRole('button',{name:'Get a mainnet quote',exact:true}).click();
    await page.getByText('No transfer sent',{exact:true}).waitFor();
    assert.equal(quoteRequests.at(-1).amount,'123456789012345678');
    assert.equal(quoteRequests.at(-1).asset_id,catalogue[2].assetId);
    assert.match(await page.locator('.route-review h3').innerText(),/0\.123456789012345678 ETH/);
    await page.locator('.route-form').getByRole('combobox',{name:/^Direction/}).selectOption('payout');
    await page.getByLabel('Receiving Ethereum account').fill('0x'+'2'.repeat(40));
    await page.getByLabel('Refund NEAR account').fill('owner.near');
    await page.getByRole('button',{name:'Get a mainnet quote',exact:true}).click();
    await page.getByText('No transfer sent',{exact:true}).waitFor();
    assert.equal(quoteRequests.at(-1).direction,'payout');assert.equal(quoteRequests.at(-1).amount,'10000000');
    check('ui-live-catalogue-picker-preserves-eighteen-decimal-input-and-payout-direction');
    await layout(page, 'fixture-quote-review', 390, 844);

    const privateIds = ['1', '2', '3'].map(digit => digit.repeat(64));
    state.private_invoices = privateIds.map((nullifier, n) => ({ nullifier, commitment: 'b'.repeat(64), parties: [state.invoices[n].spec.buyer, state.invoices[n].spec.seller], status: 'SETTLED', ready_at_ms: Date.now() }));
    state.rounds.push({ ...state.rounds[0], input: { ...state.rounds[0].input, id: 'explicit-encrypted-round-fixture', private: true, invoice_ids: privateIds, invoice_hashes: privateIds.map(() => 'b'.repeat(64)) }, status: 'SETTLED', gross_invoice_volume: null, settled_at_ms: Date.now() });
    await refresh(); await navigateWorkspace(page, 'Clearing');
    await page.locator('.round-list-item').first().click();
    assert.equal(await page.locator('.round-details .round-totals').getByText('Encrypted', { exact: true }).count(), 2);
    assert.equal(await page.locator('.round-details .net-calculation-table th').getByText('Owes', { exact: true }).count(), 0);
    assert.match(await page.locator('.round-details .round-totals').innerText(), /40\.00/);
    await layout(page, 'fixture-private-missing-data', 390, 844);
    check('ui-encrypted-round-does-not-invent-gross-or-bills');

    const large = ((1n << 100n) - 1n).toString();
    state.balances[0] = { ...state.balances[0], balance: large, reserved: '0', available: large };
    for (let n = 3; n < 12; n++) {
      const p = { kind: 'external-' + n, name: ('Independent agent ' + n + ' with a long account label').padEnd(64, '.'), account_id: ('external-' + n + '-').padEnd(48, 'x') + '.fixture.testnet', public_key: 'a'.repeat(64) };
      state.session.participants.push(p); state.balances.push({ ...state.balances[1], account_id: p.account_id, name: p.name });
    }
    state.invoices = Array.from({ length: 48 }, (_, n) => ({ ...state.invoices[0], spec: { ...state.invoices[0].spec, id: ('explicit-maximum-ui-fixture-' + n).padEnd(96, 'i'), buyer: state.session.participants[n % 12].account_id, seller: state.session.participants[(n + 1) % 12].account_id, amount: '1' } }));
    await refresh();
    await page.locator('.round-list-item').first().click();
    await layout(page, 'fixture-maximum-ledger', 1440, 1000);
    await layout(page, 'fixture-maximum-ledger', 834, 1000);
    await layout(page, 'fixture-maximum-ledger', 320, 844);
    await navigateWorkspace(page, 'Wallets');
    await layout(page, 'fixture-maximum-wallet', 320, 844);
    check('ui-fixture-maximum-names-amounts-and-ledger', { participants: 12, invoices: 48 });

    const confirmed = await page.locator('.wallet-summary').innerText();
    await page.route('**/api/v4/snapshot', route => route.fulfill({ status: 503, json: { error: 'SERVICE_UNAVAILABLE' } }));
    await refresh(); await page.locator('.connection.stale').waitFor();
    assert.equal(await page.locator('.wallet-summary').innerText(), confirmed);
    assert.ok(await page.getByRole('button', { name: 'Withdraw test funds', exact: true }).isDisabled());
    await navigateWorkspace(page, 'Settings');
    assert.ok(await page.getByRole('button', { name: 'Revoke this agent', exact: true }).isDisabled());
    await navigateWorkspace(page, 'Work');
    assert.ok(await page.getByRole('button', { name: 'Run agents', exact: true }).isDisabled());
    await navigateWorkspace(page, 'Clearing');
    assert.ok(await clear.isDisabled());
    check('ui-stale-state-disables-money-and-work-actions');
    assert.deepEqual(runtimeErrors, []);
    check('ui-fixtures-no-browser-runtime-errors');
  } catch (error) {
    const size = page.viewportSize();
    await layout(page, 'fixture-failure', size.width, size.height).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
