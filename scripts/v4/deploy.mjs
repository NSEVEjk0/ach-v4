import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, SignedTransaction, actions, baseEncode } from '../../packages/client/dist/near.js';
import { AchV4Client, V4NearTransport } from '../../packages/client/dist/v4.js';
import { StateStore } from '../../services/lib/store.mjs';
import { durableActions } from '../../services/lib/transactions.mjs';
import {privateRoot,manifestPath,outlayerPath} from '../../services/lib/paths.mjs';
import {sourceFingerprint} from './source.mjs';
import {requireFreshAccounts,requireCurrentWorkflow,serviceLayout,requireServiceLayout,requireIdentityAccount,deploymentStorageShortfall,storageFundedDeploymentId}from '../../services/lib/workflow.mjs';

const json = (filename) => JSON.parse(readFileSync(filename, 'utf8'));
const encode = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
const accounts = json(path.join(privateRoot, 'accounts.json'));
requireFreshAccounts(accounts);
const layout=serviceLayout(accounts);
const build = json('docs/v4/build.json');
requireCurrentWorkflow(build);
const previousManifest = existsSync(manifestPath) ? json(manifestPath) : null;
if (previousManifest && (previousManifest.vault !== accounts.vault || previousManifest.token !== accounts.token)) throw new Error('EXISTING_DEPLOYMENT_CONFLICT');
if(previousManifest)requireServiceLayout(previousManifest);
const contextIndex=process.argv.indexOf('--git-context');
const gitContext=contextIndex<0?undefined:json(process.argv[contextIndex+1]);
const verifiedSource=sourceFingerprint(gitContext);
const provider = new JsonRpcProvider({ url: accounts.rpc_url });
const journal = new StateStore(path.join(privateRoot, 'deployment.sqlite'));
const evidence = [];
let coordinator;
let root;
let storagePrice;

function saveIdentity(filename, accountId, role) {
  if (existsSync(filename)) { const identity = json(filename); if (identity.account_id !== accountId) throw new Error('IDENTITY_CONFLICT'); return identity; }
  const key = KeyPair.fromRandom('ed25519');
  const identity = { account_id: accountId, secret_key: key.toString(), public_key: key.getPublicKey().toString(), role };
  writeFileSync(filename, encode(identity), { mode: 0o600, flag: 'wx' });
  return identity;
}
async function deploy(role) {
  const identity = json(path.join(privateRoot, `${role}.json`));
  if (identity.account_id !== accounts[role]) throw new Error('DEPLOYMENT_ACCOUNT_CONFLICT');
  const artifact = build.artifacts[role];
  const bytes = readFileSync(artifact.path);
  if (digest(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) throw new Error('ARTIFACT_HASH_MISMATCH');
  const account = new Account(identity.account_id, provider, identity.secret_key);
  const prior=await provider.viewAccount({accountId:identity.account_id,blockQuery:{finality:'final'}});
  let operationId=`deploy:${role}:${artifact.sha256}`;
  const old=await journal.get(operationId);
  if(old?.state==='FAILED'){
    if(prior.code_hash!=='11111111111111111111111111111111')throw new Error('FAILED_DEPLOYMENT_ACCOUNT_CHANGED');
    const status=await provider.viewTransactionStatus({txHash:old.tx_hash,accountId:identity.account_id,waitUntil:'FINAL'});
    operationId=storageFundedDeploymentId(old,status,identity.account_id);
  }
  if(prior.code_hash==='11111111111111111111111111111111'){
    const shortage=deploymentStorageShortfall(prior,bytes.length,storagePrice),funding=1_000_000_000_000_000_000_000_000n;
    if(shortage>funding)throw new Error('DEPLOYMENT_NATIVE_STORAGE_BUDGET_REQUIRED');
    if(shortage){
      evidence.push({kind:`fund-${role}-deployment-storage`,...await durableActions(root,journal,`fund-deployment:${role}:${artifact.sha256}`,identity.account_id,[actions.transfer(funding)])});
      const funded=await provider.viewAccount({accountId:identity.account_id,blockQuery:{finality:'final'}});
      if(deploymentStorageShortfall(funded,bytes.length,storagePrice))throw new Error('DEPLOYMENT_NATIVE_STORAGE_FUNDING_UNCONFIRMED');
    }
  }
  const result = await durableActions(account, journal, operationId, identity.account_id, [actions.deployContract(bytes)]);
  evidence.push({ kind: `deploy-${role}`, ...result });
  const chain = await provider.viewAccount({ accountId: identity.account_id, blockQuery: { finality: 'final' } });
  const codeHash = baseEncode(createHash('sha256').update(bytes).digest());
  if (chain.code_hash !== codeHash) throw new Error('DEPLOYED_CODE_HASH_MISMATCH');
  return { identity, account, code_hash: codeHash, transport: new V4NearTransport(identity.account_id, accounts.rpc_url, identity.secret_key, journal) };
}
try {
  // Check before any funding, account creation or code replacement. Never
  // apply this workflow to a historical vault with unsecured accepted bills.
  const existing=await provider.viewAccount({accountId:accounts.vault,blockQuery:{finality:'final'}});
  if(existing.code_hash!=='11111111111111111111111111111111'){
    const current=await provider.callFunction({contractId:accounts.vault,method:'get_config',args:{},blockQuery:{finality:'final'}});
    requireCurrentWorkflow(current);
    if(current.vault!==accounts.vault||current.token!==accounts.token)throw new Error('ONCHAIN_CONFIGURATION_MISMATCH');
  }
  const rootIdentity = json(path.join(privateRoot, 'root.json'));
  requireIdentityAccount(accounts,'root',rootIdentity);
  root = new Account(rootIdentity.account_id, provider, rootIdentity.secret_key);
  const protocol=await provider.sendJsonRpc('EXPERIMENTAL_protocol_config',{finality:'final'});
  storagePrice=protocol.runtime_config?.storage_amount_per_byte;
  const owner = saveIdentity(path.join(privateRoot, 'coordinator-owner.json'), `desk.${rootIdentity.account_id}`, 'sponsor');
  coordinator = saveIdentity(path.join(privateRoot, 'coordinator.json'), owner.account_id, 'agent');
  const coordinatorMethods = ['propose_round', 'settle_round', 'expire_round', 'release_stale_round', 'expire_private_request','expire_purchase_group'];
  const created = await durableActions(root, journal, 'create-coordinator', coordinator.account_id, [actions.createAccount(), actions.transfer(300_000_000_000_000_000_000_000n), actions.addFullAccessKey(KeyPair.fromString(owner.secret_key).getPublicKey()), actions.addFunctionCallAccessKey(KeyPair.fromString(coordinator.secret_key).getPublicKey(), accounts.vault, coordinatorMethods, 100_000_000_000_000_000_000_000n)]);
  evidence.push({ kind: 'create-coordinator', ...created });
  const token = await deploy('token');
  evidence.push({ kind: 'init-token', ...await token.transport.call(accounts.token, 'init', { owner_id: accounts.root }, { operation_id: 'init-token', deposit: 0n }) });
  const vault = await deploy('vault');
  const privateConfig = existsSync(outlayerPath) ? json(outlayerPath) : null;
  const worker = privateConfig?.enabled ? { outlayer_account: privateConfig.outlayer_account, url: privateConfig.url, hash: privateConfig.hash, profile: privateConfig.profile } : null;
  evidence.push({ kind: 'init-vault', ...await vault.transport.call(accounts.vault, 'init', { network: 'testnet', token: accounts.token, owner_id: accounts.root, coordinator_id: coordinator.account_id, private_worker: null }, { operation_id: 'init-vault', deposit: 0n }) });
  let reserveId='sponsor-vault-native-reserve';
  const oldReserve=await journal.get(reserveId),confirmedInit=await journal.get('init-token');
  if(oldReserve && confirmedInit?.state==='CONFIRMED' && oldReserve.tx_hash!==confirmedInit.tx_hash){
    const candidate=SignedTransaction.decode(Buffer.from(oldReserve.signed_transaction,'base64')).transaction;
    const consumed=SignedTransaction.decode(Buffer.from(confirmedInit.signed_transaction,'base64')).transaction;
    if(candidate.signerId===consumed.signerId && candidate.publicKey.toString()===consumed.publicKey.toString() && candidate.nonce===consumed.nonce){
      const actualInit=await provider.viewTransactionStatus({txHash:confirmedInit.tx_hash,accountId:accounts.token,waitUntil:'FINAL'});
      if(actualInit.status?.SuccessValue===undefined)throw new Error('NONCE_COLLISION_NOT_INDEPENDENTLY_PROVEN');
      oldReserve.state='FAILED';oldReserve.error='NONCE_USED_BY_DIFFERENT_CONFIRMED_INITIALIZATION';await journal.put(oldReserve);reserveId='sponsor-vault-native-reserve-reconciled';
    }
  }
  const tokenReserve = await durableActions(token.transport.account, journal, reserveId, accounts.vault, [actions.transfer(6_000_000_000_000_000_000_000_000n)]);
  evidence.push({ kind: 'native-storage-sponsorship', ...tokenReserve });
  const config = { protocol_version: 4, workflow_revision:2, network: 'testnet', root:accounts.root, vault: accounts.vault, token: accounts.token, decimals: 6, rpc_url: accounts.rpc_url, code_hash: vault.code_hash };
  const coordinatorOwner = new AchV4Client(config, new V4NearTransport(owner.account_id, accounts.rpc_url, owner.secret_key, journal), 'owner');
  await coordinatorOwner.register('Clearing coordinator');
  const coordinatorPolicy=(await coordinatorOwner.balance()).policy;
  if(!coordinatorPolicy)await coordinatorOwner.setPolicy({ key: Buffer.from(KeyPair.fromString(coordinator.secret_key).getPublicKey().data).toString('hex'), max_invoice: '100000', gross_budget: '0', max_net_commitment: '0', expires_at_ms: Date.now() + 29 * 86_400_000, counterparties: [], services: [] }, 'coordinator-policy');
  else if(coordinatorPolicy.key!==Buffer.from(KeyPair.fromString(coordinator.secret_key).getPublicKey().data).toString('hex')||coordinatorPolicy.gross_budget!=='0'||coordinatorPolicy.max_net_commitment!=='0'||coordinatorPolicy.revoked)throw new Error('COORDINATOR_POLICY_MISMATCH');
  const rootTransport = new V4NearTransport(accounts.root, accounts.rpc_url, rootIdentity.secret_key, journal);
  await rootTransport.call(accounts.token, 'storage_deposit', { account_id: accounts.vault }, { operation_id: 'register-vault-token', deposit: 0n });
  const onchainConfig = await vault.transport.view(accounts.vault, 'get_config', {});
  if (onchainConfig.token !== config.token || onchainConfig.protocol_version !== 4 || onchainConfig.workflow_revision!==2 || onchainConfig.coordinator_id !== coordinator.account_id) throw new Error('ONCHAIN_CONFIGURATION_MISMATCH');
  const metadata = await rootTransport.view(accounts.token, 'ft_metadata', {});
  if (metadata.decimals !== 6 || metadata.symbol !== 'tUSDC') throw new Error('SETTLEMENT_TOKEN_METADATA_MISMATCH');
  const keys = await provider.viewAccessKeyList({ accountId: accounts.vault, finalityQuery: { finality: 'final' } });
  const backing = await vault.transport.view(accounts.vault, 'get_backing_status', {});
  const custody = await rootTransport.view(accounts.token, 'ft_balance_of', { account_id: accounts.vault });
  if (custody !== backing.tracked_token_custody || !backing.claims_equal_tracked_custody) throw new Error('INDEPENDENT_TOKEN_BACKING_MISMATCH');
  const manifest = {
    ...config, status: 'deployed', deployed_at: new Date().toISOString(), symbol: 'tUSDC', token_has_monetary_value: false,
    source: verifiedSource, artifacts: build.artifacts, coordinator_id: coordinator.account_id,
    verification: { code_hash_verified: true, token_metadata_verified: true, token_backing_verified: true },
    custody: { vault_access_keys: keys.keys, upgrade_authority_remaining: keys.keys.some(k => k.access_key.permission === 'FullAccess'), test_accounts: 'Hosted demo identities; external agents keep their own signers.' },
    service_layout:{unit:layout.unit,ports:layout.ports},services:layout.services,
    sponsor_limits: { maxNative: '26000000000000000000000000', perSessionNative: '2000000000000000000000000', vaultStorageNative:'800000000000000000000000', maxPlannerCallsPerDay:2000, ...(previousManifest?.sponsor_limits ?? {}), dailyLimit:null, ipLimit:null, intervalMs:10000 },
    limits: { round_participants: 12, round_invoices: 48, private_round_invoices:6, private_invoice_padding_bytes:2048, gas_verified: false },
    private: privateConfig ?? { enabled: false, state: 'pending-live-verification' },
    intents: previousManifest?.intents ?? { dry_quotes_enabled: false, mainnet_routes_exercised: false },
    ...(previousManifest?.gateway ? { gateway: previousManifest.gateway } : {}),
    transactions: [...new Map([...(previousManifest?.transactions ?? []), ...evidence.map(({ value, ...result }) => result)].map(record => [record.tx_hash, record])).values()],
  };
  mkdirSync('docs/v4', { recursive: true });
  writeFileSync(manifestPath, encode(manifest));
  const serviceEnv = path.join(privateRoot, 'services.env');
  if (!existsSync(serviceEnv)) writeFileSync(serviceEnv, `ACH_V4_MANIFEST=${manifestPath}\nACH_V4_PRIVATE_ROOT=${privateRoot}\nACH_V4_SERVICE_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  console.log(encode({ status: manifest.status, vault: config.vault, token: config.token, code_hash: config.code_hash, independent_backing_verified: true, private_enabled: Boolean(worker), repository_pushed: false }));
} finally { journal.close(); }
