/** Offline execution of the exact NEAR Wasm exports with a transactional host.
 * This is an ABI/financial harness, NOT a NEAR node or measured gas evidence.
 */
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class WasmChain {
  constructor({ now = 1_800_000_000_000 } = {}) { this.contracts = new Map(); this.keys = new Map(); this.externals = new Map(); this.now = now; this.transactions = []; this.failTransfer = false; this.counter = 0; }
  async deploy(account, artifact) { this.contracts.set(account, { module: await WebAssembly.compile(readFileSync(artifact)), storage: new Map() }); }
  addKey(account, publicKey, { owner = false, methods = [], receiver } = {}) { this.keys.set(`${account}:${publicKey}`, { owner, methods, receiver }); }
  async invoke(contractId, method, input, { account = contractId, key = 'a'.repeat(64), deposit = 0n, predecessor = account, promises = [], native = 100n * 10n ** 24n, checkKey = false } = {}) {
    if(this.externals.has(contractId))return {value:await this.externals.get(contractId)(method,input,{account,predecessor})};
    if (checkKey) { const permission = this.keys.get(`${account}:${key}`); if (!permission || (!permission.owner && (deposit !== 0n || permission.receiver !== contractId || !permission.methods.includes(method)))) throw new Error('ACCESS_KEY_PERMISSION_DENIED'); }
    if (this.failTransfer && method === 'ft_transfer') throw new Error('INJECTED_TOKEN_FAILURE');
    const c = this.contracts.get(contractId); if (!c) throw new Error('CONTRACT_NOT_DEPLOYED');
    const before = new Map(c.storage); const registers = new Map(); const scheduled = []; const logs = []; let output; let returnedPromise; let instance; let readCount = 0; let writes = 0;
    const getBytes = (pointer, length) => Buffer.from(new Uint8Array(instance.exports.memory.buffer, Number(pointer), Number(length)));
    const getText = (pointer, length) => getBytes(pointer, length).toString('utf8');
    const putBytes = (pointer, bytes) => new Uint8Array(instance.exports.memory.buffer, Number(pointer), bytes.length).set(bytes);
    const put128 = (pointer, n) => { const bytes = Buffer.alloc(16); bytes.writeBigUInt64LE(n & ((1n << 64n) - 1n)); bytes.writeBigUInt64LE(n >> 64n, 8); putBytes(pointer, bytes); };
    const env = {
      input: r => registers.set(r, Buffer.from(JSON.stringify(input))),
      read_register: (r, p) => putBytes(p, registers.get(r) ?? Buffer.alloc(0)), register_len: r => registers.has(r) ? BigInt(registers.get(r).length) : (1n << 64n) - 1n,
      current_account_id: r => registers.set(r, Buffer.from(contractId)), predecessor_account_id: r => registers.set(r, Buffer.from(predecessor)), signer_account_id: r => registers.set(r, Buffer.from(account)), signer_account_pk: r => registers.set(r, Buffer.concat([Buffer.from([0]), Buffer.from(key, 'hex')])),
      attached_deposit: p => put128(p, deposit), account_balance: p => put128(p, native), block_timestamp: () => BigInt(this.now) * 1_000_000n,
      storage_usage: () => BigInt([...c.storage].reduce((sum, [k, v]) => sum + Buffer.byteLength(k) + v.length + 64, 0)),
      storage_read: (l, p, r) => { readCount++; const v = c.storage.get(getText(p, l)); if (!v) return 0n; registers.set(r, v); return 1n; },
      storage_write: (kl, kp, vl, vp, r) => { writes++; const k = getText(kp, kl); const old = c.storage.get(k); if (old) registers.set(r, old); c.storage.set(k, getBytes(vp, vl)); return old ? 1n : 0n; },
      storage_remove: (kl, kp, r) => { const k = getText(kp, kl); const old = c.storage.get(k); if (old) registers.set(r, old); c.storage.delete(k); return old ? 1n : 0n; },
      value_return: (l, p) => { output = getText(p, l); }, panic_utf8: (l, p) => { throw new Error(getText(p, l)); }, log_utf8: (l, p) => logs.push(JSON.parse(getText(p, l))),
      promise_results_count: () => BigInt(promises.length), promise_result: (i, r) => { const v = promises[Number(i)]; if (v === null) return 2n; registers.set(r, Buffer.from(v ?? '')); return 1n; },
      promise_create: (al, ap, ml, mp, dl, dp, am, gas) => { const a = getBytes(am, 16); const amount = a.readBigUInt64LE() + (a.readBigUInt64LE(8) << 64n); scheduled.push({ receiver: getText(ap, al), method: getText(mp, ml), args: JSON.parse(getText(dp, dl)), deposit: amount, gas, predecessor: contractId }); return BigInt(scheduled.length - 1); },
      promise_then: (idx, al, ap, ml, mp, dl, dp, am, gas) => { const a = getBytes(am, 16); scheduled.push({ after: Number(idx), receiver: getText(ap, al), method: getText(mp, ml), args: JSON.parse(getText(dp, dl)), deposit: a.readBigUInt64LE() + (a.readBigUInt64LE(8) << 64n), gas, predecessor: contractId }); return BigInt(scheduled.length - 1); },
      promise_return: idx => { returnedPromise = Number(idx); },
      ed25519_verify: (sl, sp, ml, mp, kl, kp) => { try { const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), getBytes(kp, kl)]); return verify(null, getBytes(mp, ml), createPublicKey({ key: der, format: 'der', type: 'spki' }), getBytes(sp, sl)) ? 1n : 0n; } catch { return 0n; } },
    };
    try { instance = await WebAssembly.instantiate(c.module, { env }); if (!instance.exports[method]) throw new Error('METHOD_NOT_FOUND'); instance.exports[method](); }
    catch (error) { c.storage = before; throw error; }
    const receiptResults = [];
    for (const call of scheduled) {
      const resultOfPrevious = call.after === undefined ? undefined : receiptResults[call.after];
      try { const result = await this.invoke(call.receiver, call.method, call.args, { account, key, deposit: call.deposit, predecessor: call.predecessor, promises: call.after === undefined ? [] : [resultOfPrevious], native }); receiptResults.push(JSON.stringify(result.value)); }
      catch { receiptResults.push(null); }
    }
    if (returnedPromise !== undefined) { if (receiptResults[returnedPromise] === null) throw new Error('RETURNED_PROMISE_FAILED'); output = receiptResults[returnedPromise]; }
    return { value: output === undefined ? null : JSON.parse(output), logs, host_reads: readCount, host_writes: writes, scheduled: scheduled.length };
  }
  transport(account, publicKey, { owner = false } = {}) {
    return { account_id: account,
      view: async (contract, method, args) => (await this.invoke(contract, method, args, { account, key: publicKey })).value,
      call: async (contract, method, args, options) => {
        const payload = JSON.stringify({ account, contract, method, args, operation: options.operation_id });
        const prior = this.transactions.find(t => t.operation === options.operation_id && t.account === account);
        if (prior) { if (prior.payload !== payload) throw new Error('REQUEST_ID_CONFLICT'); return prior.result; }
        const result = await this.invoke(contract, method, args, { account, key: publicKey, deposit: options.deposit ?? (owner ? 1n : 0n), checkKey: true });
        const confirmed = { value: result.value, tx_hash: createHash('sha256').update(`offline:${++this.counter}:${payload}`).digest('hex'), evidence: 'local_wasm' };
        this.transactions.push({ account, payload, operation: options.operation_id, result: confirmed }); return confirmed;
      },
    };
  }
}
export const artifacts = {
  vault: fileURLToPath(new URL('../../target/wasm32-unknown-unknown/release/ach_vault.wasm', import.meta.url)),
  token: fileURLToPath(new URL('../../target/wasm32-unknown-unknown/release/ach_test_usdc.wasm', import.meta.url)),
};
