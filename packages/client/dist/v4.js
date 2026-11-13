import { createHash, createPublicKey, verify as cryptoVerify, randomBytes, generateKeyPairSync, diffieHellman, hkdfSync, createCipheriv } from "node:crypto";
import { Account, JsonRpcProvider, SignedTransaction, actions, baseEncode } from "near-api-js";
import { RpcError } from "near-api-js/rpc-errors";
export class V4MemoryJournal {
    operations = new Map();
    async get(id) { return this.operations.get(id); }
    async put(op) { this.operations.set(op.id, structuredClone(op)); }
}
export const V4_MAX_AMOUNT = (1n << 100n) - 1n;
export const V4_MAX_PRIVATE_INVOICES = 6;
export const V4_PRIVATE_INVOICE_PADDING_BYTES = 2048;
export function v4Units(value) {
    if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 31)
        throw new Error("INVALID_AMOUNT");
    const amount = BigInt(value);
    if (amount > V4_MAX_AMOUNT)
        throw new Error("AMOUNT_OVERFLOW");
    return amount;
}
export function parseTestUSD(value) {
    if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
        throw new Error("Enter a nonnegative amount with at most six decimal places.");
    const [whole, fraction = ""] = value.split(".");
    const units = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
    return v4Units(units.toString()).toString();
}
export function formatTestUSD(units, minimumDecimals = 2) {
    const n = v4Units(units);
    const whole = n / 1000000n;
    let fraction = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    fraction = fraction.padEnd(minimumDecimals, "0");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}
function id(s) { if (!/^[a-zA-Z0-9_.-]{1,96}$/.test(s))
    throw new Error("INVALID_ID"); }
function account(s) { if (!/^[a-z\d]+(?:[._-][a-z\d]+)*$/.test(s) || s.length < 2 || s.length > 64)
    throw new Error("INVALID_ACCOUNT"); }
function hash(s) { if (!/^[a-f\d]{64}$/.test(s))
    throw new Error("INVALID_HASH"); }
function integer(n) { if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("INVALID_INTEGER"); }
export function validateV4Deployment(c) {
    if (c.protocol_version !== 4 || !["testnet", "mainnet"].includes(c.network) || c.decimals !== 6)
        throw new Error("INVALID_V4_DEPLOYMENT");
    account(c.vault);
    account(c.token);
    if (c.vault === "ach-clearing-v2.testnet" || c.vault === "ach-clearing.testnet")
        throw new Error("LEGACY_VAULT_REFUSED");
    if ((c.network === "testnet") !== c.vault.endsWith(".testnet") || (c.network === "testnet") !== c.token.endsWith(".testnet"))
        throw new Error("NETWORK_ACCOUNT_MISMATCH");
    if (c.workflow_revision !== undefined && c.workflow_revision !== 2)
        throw new Error("INVALID_WORKFLOW_REVISION");
    validateRpcUrl(c.rpc_url);
    return c;
}
function validateRpcUrl(endpoint) { const url = new URL(endpoint); if (url.username || url.password || !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
    throw new Error("INVALID_RPC_URL"); }
export function v4Digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function canonicalV4(purpose, network, vault, fields) {
    return Buffer.concat(["ACH", "4", purpose, network, vault, ...fields].map(field => {
        const bytes = Buffer.from(field, "utf8");
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        return Buffer.concat([length, bytes]);
    }));
}
export function canonicalV4Invoice(c, i) {
    id(i.id);
    id(i.purchase_id);
    id(i.service);
    account(i.buyer);
    account(i.seller);
    hash(i.terms_hash);
    hash(i.artifact_hash);
    integer(i.terms_version);
    integer(i.ready_at_ms);
    integer(i.expires_at_ms);
    if (i.buyer === i.seller || i.asset !== c.token || v4Units(i.amount) === 0n || !i.terms_version || i.ready_at_ms > i.expires_at_ms)
        throw new Error("INVALID_INVOICE");
    return canonicalV4("invoice", c.network, c.vault, [i.id, i.purchase_id, String(i.terms_version), i.buyer, i.seller, i.asset, i.amount, i.service, i.terms_hash, i.artifact_hash, String(i.ready_at_ms), String(i.expires_at_ms)]);
}
export function v4InvoiceHash(c, i) { return v4Digest(canonicalV4Invoice(c, i)); }
export function v4ChargeId(c, i) {
    return v4Digest(canonicalV4("purchase-charge", c.network, c.vault, [i.buyer, i.purchase_id, String(i.terms_version)]));
}
export function v4FundedInvoiceId(c, order) {
    return `bill-${v4ChargeId(c, order)}`;
}
export function v4PurchaseGroupId(c, proposer, requestId) {
    account(proposer);
    id(requestId);
    const prefix = v4Digest(canonicalV4("purchase-group-proposer", c.network, c.vault, [proposer])).slice(0, 32);
    const result = `pg-${prefix}-${requestId}`;
    id(result);
    return result;
}
export function v4FundingGroupHash(c, input) {
    id(input.id);
    integer(input.deadline_ms);
    const limit = input.private ? V4_MAX_PRIVATE_INVOICES : 48;
    if (!input.orders.length || input.orders.length > limit)
        throw new Error("PURCHASE_GROUP_LIMIT");
    const orders = [...input.orders].sort((a, b) => { const x = v4ChargeId(c, a), y = v4ChargeId(c, b); return x < y ? -1 : x > y ? 1 : 0; });
    const members = new Set(), charges = new Set();
    const fields = [input.id, String(input.deadline_ms), input.private ? "private" : "public", String(orders.length)];
    for (const o of orders) {
        id(o.purchase_id);
        integer(o.terms_version);
        account(o.buyer);
        account(o.seller);
        hash(o.order_commitment);
        if (!o.terms_version || o.buyer === o.seller || charges.has(v4ChargeId(c, o)))
            throw new Error("INVALID_PURCHASE_ORDER");
        charges.add(v4ChargeId(c, o));
        members.add(o.buyer);
        members.add(o.seller);
        fields.push(o.purchase_id, String(o.terms_version), o.buyer, o.seller, o.order_commitment);
        if (input.private) {
            if (o.public_terms !== null || o.purchase_id.length < 32)
                throw new Error("PRIVATE_ORDER_DISCLOSURE");
        }
        else {
            const t = o.public_terms;
            if (!t || v4Units(t.amount) === 0n)
                throw new Error("PUBLIC_PURCHASE_TERMS_REQUIRED");
            id(t.service);
            hash(t.terms_hash);
            hash(t.artifact_hash);
            fields.push(t.amount, t.service, t.terms_hash, t.artifact_hash);
        }
    }
    const ps = [...input.positions].sort((a, b) => a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0);
    if (ps.length < 2 || ps.length > 12 || new Set(ps.map(p => p.account_id)).size !== ps.length || JSON.stringify([...members].sort()) !== JSON.stringify(ps.map(p => p.account_id)))
        throw new Error("PURCHASE_GROUP_MEMBER_MISMATCH");
    let sum = 0n;
    for (const p of ps) {
        if (!/^(0|[1-9]\d*|-[1-9]\d*)$/.test(p.net))
            throw new Error("INVALID_NET");
        v4Units(p.net.replace('-', ''));
        sum += BigInt(p.net);
    }
    if (sum !== 0n)
        throw new Error("UNBALANCED_ROUND");
    fields.push(String(ps.length));
    for (const p of ps)
        fields.push(p.account_id, p.net);
    return v4Digest(canonicalV4("purchase-group", c.network, c.vault, fields));
}
export function v4PrivateInvoiceCommitment(c, spec, salt) {
    hash(salt);
    return v4Digest(canonicalV4("private-invoice", c.network, c.vault, [v4InvoiceHash(c, spec), salt]));
}
export function v4PrivateInputCommitment(c, requestId, deadline, workerHash, envelopes) {
    id(requestId);
    integer(deadline);
    hash(workerHash);
    if (!envelopes.length || envelopes.length > V4_MAX_PRIVATE_INVOICES || new Set(envelopes.map(e => e.nullifier)).size !== envelopes.length)
        throw new Error("PRIVATE_INVOICE_LIMIT");
    const commitments = envelopes.map(e => { hash(e.commitment); hash(e.nullifier); return e.commitment; }).sort();
    return v4Digest(canonicalV4("private-input", c.network, c.vault, [requestId, String(deadline), workerHash, String(commitments.length), ...commitments]));
}
export function v4PrivateDisclosureHash(c, inputCommitment, members) {
    hash(inputCommitment);
    const sorted = [...members].sort();
    if (sorted.length < 2 || sorted.length > 12 || new Set(sorted).size !== sorted.length)
        throw new Error("PRIVATE_MEMBER_MISMATCH");
    sorted.forEach(account);
    return v4Digest(canonicalV4("private-net-disclosure", c.network, c.vault, [inputCommitment, String(sorted.length), ...sorted]));
}
export function encryptV4Invoice(c, key, contribution) {
    if (key.protocol_version !== 4 || key.algorithm !== "X25519-HKDF-SHA256-AES-256-GCM")
        throw new Error("PRIVATE_KEY_BINDING_MISMATCH");
    hash(key.public_key);
    hash(key.worker_hash);
    const commitment = v4PrivateInvoiceCommitment(c, contribution.spec, contribution.salt);
    if (contribution.signatures.length !== 2 || new Set(contribution.signatures.map(s => s.account_id)).size !== 2 || contribution.signatures.some(s => ![contribution.spec.buyer, contribution.spec.seller].includes(s.account_id)))
        throw new Error("PRIVATE_SIGNATURE_PARTY");
    const clear = Buffer.from(JSON.stringify(contribution), "utf8");
    if (clear.length > V4_PRIVATE_INVOICE_PADDING_BYTES)
        throw new Error("PRIVATE_INPUT_TOO_LARGE");
    const padded = Buffer.alloc(V4_PRIVATE_INVOICE_PADDING_BYTES, 0x20);
    clear.copy(padded);
    const peer = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(key.public_key, "hex")]), format: "der", type: "spki" });
    const ephemeral = generateKeyPairSync("x25519");
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: peer });
    if (shared.every(b => b === 0))
        throw new Error("PRIVATE_KEY_INVALID");
    const aesKey = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("ach-private-invoices-v4"), 32));
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
    cipher.setAAD(canonicalV4("private-envelope", c.network, c.vault, [key.worker_hash, commitment]));
    const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
    const envelope = { nullifier: v4ChargeId(c, contribution.spec), commitment, ephemeral_public_key: ephemeral.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"), nonce: nonce.toString("hex"), ciphertext: ciphertext.toString("base64") };
    if (envelope.ciphertext.length > 4096)
        throw new Error("PRIVATE_INPUT_TOO_LARGE");
    return envelope;
}
export function v4NetPlan(invoices) {
    if (!invoices.length || invoices.length > 48)
        throw new Error("ROUND_INVOICE_LIMIT");
    const ids = new Set();
    const charges = new Set();
    const nets = new Map();
    let gross = 0n;
    for (const i of invoices) {
        const n = v4Units(i.amount);
        if (!n || i.buyer === i.seller || ids.has(i.id))
            throw new Error("INVALID_INVOICE");
        const purchase = `${i.buyer}\0${i.purchase_id}\0${i.terms_version}`;
        if (charges.has(purchase))
            throw new Error("DUPLICATE_PURCHASE");
        charges.add(purchase);
        ids.add(i.id);
        gross += n;
        nets.set(i.buyer, (nets.get(i.buyer) ?? 0n) - n);
        nets.set(i.seller, (nets.get(i.seller) ?? 0n) + n);
    }
    if (nets.size > 12 || gross > V4_MAX_AMOUNT)
        throw new Error("ROUND_LIMIT");
    const positions = [...nets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([account_id, net]) => ({ account_id, net: net.toString() }));
    const net = [...nets.values()].filter(n => n < 0n).reduce((sum, n) => sum - n, 0n);
    return { positions, gross_invoice_volume: gross.toString(), net_settlement_volume: net.toString(), settlement_ratio: gross ? Number(net) / Number(gross) : 0, volume_reduction: gross ? 1 - Number(net) / Number(gross) : 0 };
}
export function v4RoundHash(c, r) {
    id(r.id);
    integer(r.deadline_ms);
    if (!r.invoice_ids.length || r.invoice_ids.length > 48 || r.invoice_ids.length !== r.invoice_hashes.length)
        throw new Error("INVALID_ROUND_INPUT");
    if (r.positions.length < 2 || r.positions.length > 12 || new Set(r.positions.map(p => p.account_id)).size !== r.positions.length)
        throw new Error("INVALID_MEMBERS");
    const positions = [...r.positions].sort((a, b) => a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0);
    let sum = 0n;
    for (const p of positions) {
        account(p.account_id);
        const negative = p.net.startsWith("-");
        const n = v4Units(negative ? p.net.slice(1) : p.net);
        if (negative && !n)
            throw new Error("INVALID_NET");
        sum += negative ? -n : n;
    }
    if (sum !== 0n)
        throw new Error("UNBALANCED_ROUND");
    const pairs = r.invoice_ids.map((id, n) => [id, r.invoice_hashes[n]]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (new Set(r.invoice_ids).size !== r.invoice_ids.length)
        throw new Error("DUPLICATE_INVOICE");
    for (const [, h] of pairs)
        hash(h);
    return v4Digest(canonicalV4("round", c.network, c.vault, [r.id, String(r.deadline_ms), r.private ? "private" : "public", r.input_commitment, r.worker_hash, String(pairs.length), ...pairs.flat(), String(positions.length), ...positions.flatMap(p => [p.account_id, p.net])]));
}
export function verifyV4InvoiceSignature(keyHex, hashHex, signatureBase64) {
    try {
        hash(keyHex);
        hash(hashHex);
        const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(keyHex, "hex")]), format: "der", type: "spki" });
        return cryptoVerify(null, Buffer.from(hashHex, "hex"), key, Buffer.from(signatureBase64, "base64"));
    }
    catch {
        return false;
    }
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
    return JSON.stringify(value);
}
export class V4BroadcastUnknown extends Error {
    operation_id;
    tx_hash;
    constructor(operation_id, tx_hash) {
        super("Transaction confirmation is unknown. Reconcile this operation before sending again.");
        this.operation_id = operation_id;
        this.tx_hash = tx_hash;
    }
}
export function v4UnknownTransaction(error) {
    const e = error;
    return /UNKNOWN_TRANSACTION|UnknownTransaction|TransactionDoesNotExist|transaction.*(?:does not|doesn't) exist/i.test(`${e?.type ?? ''} ${e?.name ?? ''} ${e?.message ?? ''}`);
}
const rpcCooldowns = new Map();
const rpcRetryWaitMs = 2000;
/** Retry transport failures with the same RPC payload. Contract errors are final. */
export class V4RpcProvider extends JsonRpcProvider {
    connections;
    constructor(urls) {
        const endpoints = [...new Set(typeof urls === 'string' ? [urls] : urls)];
        if (!endpoints.length || endpoints.length > 4)
            throw new Error('INVALID_RPC_ENDPOINTS');
        for (const endpoint of endpoints)
            validateRpcUrl(endpoint);
        super({ url: endpoints[0] }, { retries: 1 });
        this.connections = endpoints.map(url => new JsonRpcProvider({ url }, { retries: 1 }));
    }
    sendJsonRpc = async (method, params) => {
        for (let cycle = 0; cycle < 2; cycle++) {
            let earliest = Infinity;
            for (const provider of this.connections) {
                const endpoint = provider.connection.url, blocked = rpcCooldowns.get(endpoint) ?? 0;
                if (blocked > Date.now()) {
                    earliest = Math.min(earliest, blocked);
                    continue;
                }
                try {
                    return await provider.sendJsonRpc(method, params);
                }
                catch (error) {
                    if (error instanceof RpcError)
                        throw error;
                    const e = error;
                    if (![408, 429, 500, 502, 503, 504].includes(e.cause ?? 0) && !/fetch failed|Failed to fetch|FetchError|timeout/i.test(e.message))
                        throw error;
                    const seconds = Number(e.message.match(/retry after (\d+) seconds/i)?.[1] ?? (e.cause === 429 ? 30 : 2));
                    // Preserve provider backoff, including long rate limits and a longer
                    // cooldown reported by another in-flight request to the same RPC.
                    const delay = Number.isFinite(seconds) ? Math.max(1, seconds) * 1000 : 30000;
                    const until = Math.max(rpcCooldowns.get(endpoint) ?? 0, Date.now() + delay);
                    rpcCooldowns.set(endpoint, until);
                    earliest = Math.min(earliest, until);
                }
            }
            const wait = Math.max(0, earliest - Date.now());
            // The durable caller can retry later. Waiting past this short budget
            // would still leave every endpoint blocked and delay wallet progress.
            if (cycle === 0 && Number.isFinite(earliest) && wait <= rpcRetryWaitMs) {
                if (wait)
                    await new Promise(resolve => setTimeout(resolve, wait));
            }
            else
                break;
        }
        throw new Error('RPC_UNAVAILABLE');
    };
}
const signerQueues = new Map();
export async function withV4SignerLock(account, task) {
    const signer = account.getSigner();
    if (!signer)
        throw new Error("SIGNER_REQUIRED");
    const key = `${account.accountId}:${String(await signer.getPublicKey())}`;
    const previous = signerQueues.get(key) ?? Promise.resolve();
    let unlock;
    const current = new Promise(resolve => { unlock = resolve; });
    signerQueues.set(key, current);
    await previous;
    try {
        return await task();
    }
    finally {
        unlock();
        if (signerQueues.get(key) === current)
            signerQueues.delete(key);
    }
}
export class V4NearTransport {
    account_id;
    journal;
    provider;
    account;
    constructor(account_id, rpc, signer, journal) {
        this.account_id = account_id;
        this.journal = journal;
        this.provider = new V4RpcProvider(rpc);
        this.account = new Account(account_id, this.provider, signer);
    }
    async codeHash(contract) {
        const account = await this.provider.viewAccount({ accountId: contract, blockQuery: { finality: "final" } });
        return account.code_hash;
    }
    async view(contract, method, args) {
        const result = await this.provider.callFunction({ contractId: contract, method, args, blockQuery: { finality: "final" } });
        if (result === undefined)
            throw new Error("EMPTY_CONTRACT_VIEW");
        return result;
    }
    async call(contract, method, args, options) {
        // All transport instances and action batches sharing this key serialize.
        // External processes must still use distinct keys.
        return withV4SignerLock(this.account, () => this.submit(contract, method, args, options));
    }
    async reconcile(contract, method, args, options) {
        return withV4SignerLock(this.account, () => this.submit(contract, method, args, options, true));
    }
    async submit(contract, method, args, options, reconcileOnly = false) {
        const payload_hash = v4Digest(stableJson({ signer: this.account_id, contract, method, args, deposit: String(options.deposit ?? 0n), gas: String(options.gas ?? 120000000000000n) }));
        const existing = await this.journal.get(options.operation_id);
        if (!existing && reconcileOnly)
            throw new Error('TRANSACTION_NOT_RECORDED');
        let op;
        if (existing) {
            if (existing.payload_hash !== payload_hash)
                throw new Error("REQUEST_ID_CONFLICT");
            if (existing.state === "CONFIRMED")
                return existing.result;
            if (existing.state === "FAILED")
                throw new Error(existing.error ?? "TRANSACTION_FAILED");
            // Never create a new transaction/nonce after an uncertain broadcast.
            // NONE returns a definite missing-transaction result immediately. FINAL
            // can wait indefinitely for bytes that were rejected before inclusion.
            try {
                const status = await this.provider.viewTransactionStatus({ txHash: existing.tx_hash, accountId: existing.signer_id, waitUntil: "NONE" });
                return await this.confirm(existing, status, true);
            }
            catch (error) {
                const current = await this.journal.get(existing.id);
                if (current?.state === "FAILED")
                    throw new Error(current.error ?? "CHAIN_EXECUTION_FAILED");
                if (reconcileOnly || !v4UnknownTransaction(error))
                    throw new V4BroadcastUnknown(existing.id, existing.tx_hash);
                // Retry the exact signed bytes after reconciling a definite missing tx.
                // A crash before broadcast cannot strand an operation or create a new nonce.
                try {
                    return await this.confirm(existing, await this.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(existing.signed_transaction, "base64")), "FINAL"));
                }
                catch (e) {
                    if ((await this.journal.get(existing.id))?.state === "FAILED")
                        throw e;
                    throw new V4BroadcastUnknown(existing.id, existing.tx_hash);
                }
            }
        }
        else {
            const signer = this.account.getSigner();
            if (!signer)
                throw new Error("SIGNER_REQUIRED");
            const fresh = new Account(this.account_id, this.provider, signer);
            const transaction = await fresh.createTransaction({ receiverId: contract, actions: [actions.functionCall(method, args, options.gas ?? 120000000000000n, options.deposit ?? 0n)], publicKey: await signer.getPublicKey() });
            const signed = await signer.signTransaction(transaction);
            op = { id: options.operation_id, payload_hash, signer_id: this.account_id, tx_hash: baseEncode(signed.txHash), signed_transaction: Buffer.from(signed.signedTransaction.encode()).toString("base64"), state: "SIGNED", created_at_ms: Date.now(), ...(typeof (args.amount ?? args.expected_available) === 'string' ? { amount: String(args.amount ?? args.expected_available) } : {}) };
            await this.journal.put(op); // Durable before any broadcast.
        }
        try {
            const response = await this.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction, "base64")), "FINAL");
            return await this.confirm(op, response);
        }
        catch (error) {
            const current = await this.journal.get(op.id);
            if (current?.state === "FAILED")
                throw error;
            op.state = "UNKNOWN";
            await this.journal.put(op);
            throw new V4BroadcastUnknown(op.id, op.tx_hash);
        }
    }
    async confirm(op, response, requireFinal = false) {
        const res = response;
        if (requireFinal && res.final_execution_status !== 'FINAL' || res.final_execution_status && res.final_execution_status !== 'FINAL')
            throw new V4BroadcastUnknown(op.id, op.tx_hash);
        if (res.status?.Failure) {
            op.state = "FAILED";
            op.error = "CHAIN_EXECUTION_FAILED";
            await this.journal.put(op);
            throw new Error(op.error);
        }
        if (res.status?.SuccessValue === undefined)
            throw new V4BroadcastUnknown(op.id, op.tx_hash);
        const raw = Buffer.from(res.status.SuccessValue, "base64").toString();
        const result = { value: (raw ? JSON.parse(raw) : null), tx_hash: op.tx_hash, evidence: "near_final" };
        const outcomes = [res.transaction_outcome, ...(res.receipts_outcome ?? [])].filter(Boolean);
        result.gas_burnt = outcomes.reduce((n, o) => n + BigInt(o?.outcome.gas_burnt ?? 0), 0n).toString();
        result.tokens_burnt = outcomes.reduce((n, o) => n + BigInt(o?.outcome.tokens_burnt ?? 0), 0n).toString();
        op.state = "CONFIRMED";
        op.result = result;
        await this.journal.put(op);
        return result;
    }
}
export class AchV4Client {
    transport;
    role;
    deployment;
    validated = false;
    constructor(config, transport, role = "agent") {
        this.transport = transport;
        this.role = role;
        this.deployment = validateV4Deployment(config);
    }
    async assertDeployment(refresh = false) {
        if (this.validated && !refresh)
            return;
        const c = await this.transport.view(this.deployment.vault, "get_config", {});
        if (c.protocol_version !== 4 || c.network !== this.deployment.network || c.vault !== this.deployment.vault || c.token !== this.deployment.token || c.decimals !== 6)
            throw new Error("DEPLOYMENT_MISMATCH");
        if (this.deployment.workflow_revision !== undefined && c.workflow_revision !== this.deployment.workflow_revision)
            throw new Error("WORKFLOW_REVISION_MISMATCH");
        if (this.deployment.code_hash) {
            if (!this.transport.codeHash)
                throw new Error('CODE_HASH_VERIFICATION_REQUIRED');
            if (await this.transport.codeHash(this.deployment.vault) !== this.deployment.code_hash)
                throw new Error("DEPLOYED_CODE_HASH_MISMATCH");
        }
        this.validated = true;
    }
    async read(method, args = {}) { await this.assertDeployment(); return this.transport.view(this.deployment.vault, method, args); }
    async write(method, args, operation_id, owner = false) {
        await this.assertDeployment(true);
        if (owner && this.role !== "owner")
            throw new Error("OWNER_SIGNER_REQUIRED");
        return this.transport.call(this.deployment.vault, method, args, { operation_id, deposit: owner || this.role === "owner" ? 1n : 0n });
    }
    register(name, requestId = `register:${this.transport.account_id}`) { return this.write("register_account", { name }, requestId, true); }
    sponsorAccount(account_id, name, expires_at_ms, requestId) { account(account_id); integer(expires_at_ms); return this.write("authorize_account_registration", { account_id, name, expires_at_ms }, requestId, true); }
    setPolicy(policy, requestId) { return this.write("set_agent_policy", policy, requestId, true); }
    revokeAgent(requestId) { return this.write("revoke_agent", {}, requestId, true); }
    balance(account_id = this.transport.account_id) { return this.read("get_balance", { account_id }); }
    invoice(id) { return this.read("get_invoice", { id }); }
    round(id) { return this.read("get_round", { id }); }
    purchaseGroup(id) { return this.read("get_purchase_group", { id }); }
    purchaseOrder(id) { return this.read("get_purchase_order", { id }); }
    proposePurchaseGroup(input) { v4FundingGroupHash(this.deployment, input); return this.write("propose_purchase_group", { input }, `purchase-group:${input.id}`); }
    authorizePurchaseGroup(group, expected_net) {
        if (v4FundingGroupHash(this.deployment, group.input) !== group.hash)
            throw new Error("PURCHASE_GROUP_HASH_MISMATCH");
        const own = group.input.positions.find(p => p.account_id === this.transport.account_id);
        if (!own || own.net !== expected_net)
            throw new Error("EXACT_NET_AUTHORIZATION_REQUIRED");
        return this.write("authorize_purchase_group", { id: group.input.id, expected_hash: group.hash, expected_net }, `fund:${group.input.id}:${this.transport.account_id}`);
    }
    expirePurchaseGroup(id) { return this.write("expire_purchase_group", { id }, `expire-purchase-group:${id}`); }
    proposeInvoice(spec) { canonicalV4Invoice(this.deployment, spec); return this.write("propose_invoice", { spec }, `invoice:${spec.id}`); }
    acceptInvoice(invoice) { if (v4InvoiceHash(this.deployment, invoice.spec) !== invoice.hash)
        throw new Error("INVOICE_HASH_MISMATCH"); return this.write("accept_invoice", { id: invoice.spec.id, expected_hash: invoice.hash }, `accept:${invoice.spec.id}:${this.transport.account_id}`); }
    cancelInvoice(invoice) { return this.write("cancel_invoice_by_agreement", { id: invoice.spec.id, expected_hash: invoice.hash }, `cancel-invoice:${invoice.spec.id}:${this.transport.account_id}`); }
    proposeRound(id, invoice_ids, deadline_ms) { return this.write("propose_round", { id, invoice_ids, deadline_ms }, `round:${id}`); }
    authorizeRound(round, expected_net) {
        if (v4RoundHash(this.deployment, round.input) !== round.hash)
            throw new Error("ROUND_HASH_MISMATCH");
        const own = round.input.positions.find(p => p.account_id === this.transport.account_id);
        if (!own || own.net !== expected_net)
            throw new Error("EXACT_NET_AUTHORIZATION_REQUIRED");
        return this.write("authorize_round", { id: round.input.id, expected_hash: round.hash, expected_net }, `authorize:${round.input.id}:${this.transport.account_id}`);
    }
    cancelRound(round) { return this.write("cancel_round_authorization", { id: round.input.id, expected_hash: round.hash }, `cancel-round:${round.input.id}:${this.transport.account_id}`); }
    settleRound(round) { return this.write("settle_round", { id: round.input.id, expected_hash: round.hash }, `settle:${round.input.id}`); }
    expireRound(id) { return this.write("expire_round", { id }, `expire:${id}`); }
    releaseStaleRound(id) { return this.write("release_stale_round", { id }, `release-stale:${id}`); }
    listInvoices(cursor = 0, limit = 25, account_id) { return this.read("list_invoices", { cursor, limit, ...(account_id ? { account_id } : {}) }); }
    listRounds(cursor = 0, limit = 25) { return this.read("list_rounds", { cursor, limit }); }
    listActivity(account_id = this.transport.account_id, cursor = 0, limit = 25) { return this.read("list_account_activity", { account_id, cursor, limit }); }
    withdrawal(id) { return this.read("get_withdrawal", { id }); }
    privateEncryptionKey() { return this.read("get_private_encryption_key"); }
    privateRequest(id) { return this.read("get_private_request", { id }); }
    expirePrivateRequest(id) { return this.write("expire_private_request", { id }, `expire-private:${id}`); }
    privateInvoice(id) { return this.read("get_private_invoice", { id }); }
    privatePurchase(id) { return this.read("get_private_purchase", { id }); }
    cancelPendingPrivatePurchase(order) { hash(order.charge_id); hash(order.order_commitment); return this.write("cancel_pending_private_purchase", { id: order.charge_id, expected_hash: order.order_commitment }, `cancel-private-order:${order.charge_id}:${this.transport.account_id}`); }
    authorizePrivatePurchase(request) {
        id(request.purchase_id);
        integer(request.terms_version);
        account(request.seller);
        hash(request.order_commitment);
        if (!request.terms_version || request.purchase_id.length < 32)
            throw new Error("INVALID_PRIVATE_PURCHASE");
        const charge = v4ChargeId(this.deployment, { buyer: this.transport.account_id, purchase_id: request.purchase_id, terms_version: request.terms_version });
        return this.write("authorize_private_purchase", request, `private-purchase:${charge}`);
    }
    async requestPrivateRound(request, sponsorPayment = 20000000000000000000000n) {
        if (this.role !== "owner")
            throw new Error("OWNER_SPONSOR_SIGNER_REQUIRED");
        await this.assertDeployment(true);
        const encryption = await this.privateEncryptionKey();
        if (!encryption)
            throw new Error("PRIVATE_MODE_UNAVAILABLE");
        const input_commitment = v4PrivateInputCommitment(this.deployment, request.id, request.deadline_ms, encryption.worker_hash, request.encrypted_invoices);
        v4PrivateDisclosureHash(this.deployment, input_commitment, request.members);
        if (!request.verification_only && (!request.disclosure_signatures || request.disclosure_signatures.length !== request.members.length))
            throw new Error("PRIVATE_DISCLOSURE_CONSENT_REQUIRED");
        if (sponsorPayment <= 0n || sponsorPayment > 50000000000000000000000n)
            throw new Error("BOUNDED_SPONSOR_PAYMENT_REQUIRED");
        return this.transport.call(this.deployment.vault, "request_private_round", { ...request, input_commitment }, { operation_id: `private:${request.id}`, deposit: sponsorPayment, gas: 280000000000000n });
    }
    withdraw(id, amount) { v4Units(amount); return this.write("request_withdrawal", { id, amount, receiver_id: this.transport.account_id }, `withdraw:${id}`, true); }
    recoveryWithdrawal(account_id = this.transport.account_id) { return this.read("get_recovery_withdrawal", { account_id }); }
    recoveryWithdraw(nonce, expected_available) { integer(nonce); v4Units(expected_available); return this.write("request_recovery_withdrawal", { nonce, expected_available }, `recovery:${this.transport.account_id}:${nonce}`, true); }
    async deposit(id, amount) {
        if (this.role !== "owner")
            throw new Error("OWNER_SIGNER_REQUIRED");
        v4Units(amount);
        if (!/^[a-zA-Z0-9_.-]{1,96}$/.test(id))
            throw new Error("INVALID_ID");
        await this.assertDeployment(true);
        return this.transport.call(this.deployment.token, "ft_transfer_call", { receiver_id: this.deployment.vault, amount, msg: `deposit:${id}` }, { operation_id: `deposit:${id}`, deposit: 1n, gas: 120000000000000n });
    }
}
