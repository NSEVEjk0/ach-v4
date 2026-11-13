import { createHash, createPublicKey, verify as cryptoVerify, randomBytes, generateKeyPairSync, diffieHellman, hkdfSync, createCipheriv } from "node:crypto";
import { Account, JsonRpcProvider, SignedTransaction, actions, baseEncode } from "near-api-js";
import { RpcError } from "near-api-js/rpc-errors";
import type { Signer, KeyPairString } from "near-api-js";

export type V4Units = string;
export type V4RoundState = "COLLECTING" | "READY" | "SETTLED" | "CANCELLED" | "EXPIRED" | "STALE";
export interface V4Deployment {
  protocol_version: 4; network: "testnet" | "mainnet"; vault: string; token: string;
  decimals: 6; rpc_url: string; rpc_urls?: string[]; code_hash?: string;
  workflow_revision?: 2;
}
export interface V4InvoiceSpec {
  id: string; purchase_id: string; terms_version: number; buyer: string; seller: string;
  asset: string; amount: V4Units; service: string; terms_hash: string; artifact_hash: string;
  ready_at_ms: number; expires_at_ms: number;
}
export interface V4Acceptance { owner: boolean; epoch: number; key: string; budget_charge: V4Units }
export interface V4Invoice {
  spec: V4InvoiceSpec; hash: string; charge_id: string;
  status: "PROPOSED" | "ACCEPTED" | "READY" | "SETTLED" | "CANCELLED";
  buyer_acceptance: V4Acceptance | null; seller_acceptance: V4Acceptance | null;
  round_id: string | null; sequence: number;
  funding_group_id?:string|null;
}
export interface V4Position { account_id: string; net: V4Units }
export interface V4FundingOrder {
  purchase_id:string; terms_version:number; buyer:string; seller:string; order_commitment:string;
  public_terms:{amount:V4Units;service:string;terms_hash:string;artifact_hash:string}|null;
}
export interface V4FundingGroupInput {id:string;orders:V4FundingOrder[];positions:V4Position[];deadline_ms:number;private:boolean}
export interface V4FundingGroup {input:V4FundingGroupInput;hash:string;proposer:string;status:"COLLECTING"|"FUNDED"|"READY"|"SETTLED"|"EXPIRED";approvals:V4Approval[];round_id:string|null}
export interface V4RoundInput {
  id: string; invoice_ids: string[]; invoice_hashes: string[]; positions: V4Position[];
  deadline_ms: number; private: boolean; input_commitment: string; worker_hash: string;
}
export interface V4Approval { account_id: string; expected_net: V4Units; authority: V4Acceptance; required: V4Units; approved_at_ms: number }
export interface V4Round {
  input: V4RoundInput; hash: string; proposer: string; status: V4RoundState;
  approvals: V4Approval[]; gross_invoice_volume: V4Units | null; net_settlement_volume: V4Units;
  created_at_ms: number; ready_at_ms: number | null; settled_at_ms: number | null; sequence: number; reason: string | null;
}
export interface V4Policy {
  key: string; epoch: number; max_invoice: V4Units; gross_budget: V4Units;
  max_net_commitment: V4Units; expires_at_ms: number; counterparties: string[]; services: string[]; revoked: boolean;
}
export interface V4Balance {
  account_id: string; name: string; balance: V4Units; reserved: V4Units; available: V4Units;
  pending_withdrawals: V4Units; policy: V4Policy | null; gross_purchase_budget_used: V4Units;
  active_proposals: number; active_authorizations: number; activity_count?:number; sponsored_records?:number;
}
export interface V4Withdrawal { id: string; account_id: string; receiver_id: string; amount: V4Units; status: "PENDING" | "COMPLETED" | "RESTORED"; requested_at_ms: number; completed_at_ms: number | null }
export interface V4PrivateSignature { account_id:string; key_epoch:number; signature:string }
export interface V4PrivateContribution { spec:V4InvoiceSpec; salt:string; signatures:V4PrivateSignature[] }
export interface V4PrivatePurchaseAuthorization {charge_id:string;purchase_id:string;terms_version:number;buyer:string;seller:string;order_commitment:string;policy_epoch:number;budget_charge:V4Units;status:"AUTHORIZED"|"FINALIZED"|"CANCELLED";buyer_cancelled?:boolean;seller_cancelled?:boolean;expires_at_ms?:number;funding_group_id?:string|null}
export interface V4EncryptedInvoice { nullifier:string; commitment:string; ephemeral_public_key:string; nonce:string; ciphertext:string }
export interface V4EncryptionKey { protocol_version:4; worker_hash:string; public_key:string; algorithm:"X25519-HKDF-SHA256-AES-256-GCM" }
export interface V4PrivateRoundRequest {id:string;profile:string;members:string[];deadline_ms:number;encrypted_invoices:V4EncryptedInvoice[];verification_only?:boolean;disclosure_signatures?:V4PrivateSignature[];funding_group_id?:string}
export interface V4Page<T> { items: T[]; next_cursor: number | null; total: number }
export interface V4Confirmed<T> { value: T; tx_hash: string; evidence: "near_final" | "local_wasm"; gas_burnt?: string; tokens_burnt?: string }
export interface V4CallOptions { operation_id: string; deposit?: bigint; gas?: bigint }
export interface V4Transport {
  readonly account_id: string;
  codeHash?(contract: string): Promise<string>;
  view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
  call<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
  /** Read an already journaled operation without signing or broadcasting. */
  reconcile?<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>>;
}
export interface V4Operation {
  id: string; payload_hash: string; signer_id: string; tx_hash: string;
  signed_transaction: string; state: "SIGNED" | "UNKNOWN" | "CONFIRMED" | "FAILED";
  created_at_ms?:number;amount?:V4Units;public_key?:string;nonce?:string;
  result?: V4Confirmed<unknown>; error?: string;
}
export interface V4Journal {
  get(id: string): Promise<V4Operation | undefined>;
  put(operation: V4Operation): Promise<void>;
  /** Retain the highest signed nonce across process restarts. */
  latestSignerOperation?(accountId:string,publicKey:string):Promise<V4Operation|undefined>;
}
export class V4MemoryJournal implements V4Journal {
  private readonly operations = new Map<string, V4Operation>();
  async get(id: string) { return this.operations.get(id); }
  async put(op: V4Operation) { this.operations.set(op.id, structuredClone(op)); }
  async latestSignerOperation(accountId:string,publicKey:string) {
    let latest:V4Operation|undefined;
    for(const op of this.operations.values()){
      if(op.signer_id!==accountId)continue;
      const info=v4OperationSigner(op);if(!info||info.public_key!==publicKey)continue;
      if(!latest||info.nonce>=v4OperationSigner(latest)!.nonce)latest=op;
    }
    return latest;
  }
}

export const V4_MAX_AMOUNT = (1n << 100n) - 1n;
export const V4_MAX_PRIVATE_INVOICES = 6;
export const V4_PRIVATE_INVOICE_PADDING_BYTES = 2048;
export function v4Units(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 31) throw new Error("INVALID_AMOUNT");
  const amount = BigInt(value); if (amount > V4_MAX_AMOUNT) throw new Error("AMOUNT_OVERFLOW"); return amount;
}
export function parseTestUSD(value: string): V4Units {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw new Error("Enter a nonnegative amount with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return v4Units(units.toString()).toString();
}
export function formatTestUSD(units: V4Units, minimumDecimals = 2): string {
  const n = v4Units(units); const whole = n / 1_000_000n;
  let fraction = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  fraction = fraction.padEnd(minimumDecimals, "0"); return fraction ? `${whole}.${fraction}` : whole.toString();
}
function id(s: string) { if (!/^[a-zA-Z0-9_.-]{1,96}$/.test(s)) throw new Error("INVALID_ID"); }
function account(s: string) { if (!/^[a-z\d]+(?:[._-][a-z\d]+)*$/.test(s) || s.length < 2 || s.length > 64) throw new Error("INVALID_ACCOUNT"); }
function hash(s: string) { if (!/^[a-f\d]{64}$/.test(s)) throw new Error("INVALID_HASH"); }
function integer(n: number) { if (!Number.isSafeInteger(n) || n < 0) throw new Error("INVALID_INTEGER"); }
export function validateV4Deployment(c: V4Deployment): V4Deployment {
  if (c.protocol_version !== 4 || !["testnet", "mainnet"].includes(c.network) || c.decimals !== 6) throw new Error("INVALID_V4_DEPLOYMENT");
  account(c.vault); account(c.token);
  if (c.vault === "ach-clearing-v2.testnet" || c.vault === "ach-clearing.testnet") throw new Error("LEGACY_VAULT_REFUSED");
  if ((c.network === "testnet") !== c.vault.endsWith(".testnet") || (c.network === "testnet") !== c.token.endsWith(".testnet")) throw new Error("NETWORK_ACCOUNT_MISMATCH");
  if(c.workflow_revision!==undefined&&c.workflow_revision!==2)throw new Error("INVALID_WORKFLOW_REVISION");
  validateRpcUrl(c.rpc_url); return c;
}
function validateRpcUrl(endpoint:string){const url=new URL(endpoint);if(url.username||url.password||!(url.protocol==="https:"||url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))throw new Error("INVALID_RPC_URL");}
export function v4Digest(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
export function canonicalV4(purpose: string, network: string, vault: string, fields: string[]): Uint8Array {
  return Buffer.concat(["ACH", "4", purpose, network, vault, ...fields].map(field => {
    const bytes = Buffer.from(field, "utf8"); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); return Buffer.concat([length, bytes]);
  }));
}
export function canonicalV4Invoice(c: V4Deployment, i: V4InvoiceSpec): Uint8Array {
  id(i.id); id(i.purchase_id); id(i.service); account(i.buyer); account(i.seller); hash(i.terms_hash); hash(i.artifact_hash);
  integer(i.terms_version); integer(i.ready_at_ms); integer(i.expires_at_ms);
  if (i.buyer === i.seller || i.asset !== c.token || v4Units(i.amount) === 0n || !i.terms_version || i.ready_at_ms > i.expires_at_ms) throw new Error("INVALID_INVOICE");
  return canonicalV4("invoice", c.network, c.vault, [i.id, i.purchase_id, String(i.terms_version), i.buyer, i.seller, i.asset, i.amount, i.service, i.terms_hash, i.artifact_hash, String(i.ready_at_ms), String(i.expires_at_ms)]);
}
export function v4InvoiceHash(c: V4Deployment, i: V4InvoiceSpec): string { return v4Digest(canonicalV4Invoice(c, i)); }
export function v4ChargeId(c: V4Deployment, i: Pick<V4InvoiceSpec, "buyer" | "purchase_id" | "terms_version">): string {
  return v4Digest(canonicalV4("purchase-charge", c.network, c.vault, [i.buyer, i.purchase_id, String(i.terms_version)]));
}
export function v4FundedInvoiceId(c:V4Deployment, order:Pick<V4InvoiceSpec,"buyer"|"purchase_id"|"terms_version">):string {
  return `bill-${v4ChargeId(c,order)}`;
}
export function v4PurchaseGroupId(c:V4Deployment, proposer:string, requestId:string):string {
  account(proposer);id(requestId);
  const prefix=v4Digest(canonicalV4("purchase-group-proposer",c.network,c.vault,[proposer])).slice(0,32);
  const result=`pg-${prefix}-${requestId}`;id(result);return result;
}
export function v4FundingGroupHash(c:V4Deployment,input:V4FundingGroupInput):string {
  id(input.id);integer(input.deadline_ms);
  const limit=input.private?V4_MAX_PRIVATE_INVOICES:48;
  if(!input.orders.length||input.orders.length>limit)throw new Error("PURCHASE_GROUP_LIMIT");
  const orders=[...input.orders].sort((a,b)=>{const x=v4ChargeId(c,a),y=v4ChargeId(c,b);return x<y?-1:x>y?1:0;});
  const members=new Set<string>(),charges=new Set<string>();
  const fields=[input.id,String(input.deadline_ms),input.private?"private":"public",String(orders.length)];
  for(const o of orders){
    id(o.purchase_id);integer(o.terms_version);account(o.buyer);account(o.seller);hash(o.order_commitment);
    if(!o.terms_version||o.buyer===o.seller||charges.has(v4ChargeId(c,o)))throw new Error("INVALID_PURCHASE_ORDER");
    charges.add(v4ChargeId(c,o));members.add(o.buyer);members.add(o.seller);
    fields.push(o.purchase_id,String(o.terms_version),o.buyer,o.seller,o.order_commitment);
    if(input.private){if(o.public_terms!==null||o.purchase_id.length<32)throw new Error("PRIVATE_ORDER_DISCLOSURE");}
    else{
      const t=o.public_terms;if(!t||v4Units(t.amount)===0n)throw new Error("PUBLIC_PURCHASE_TERMS_REQUIRED");
      id(t.service);hash(t.terms_hash);hash(t.artifact_hash);fields.push(t.amount,t.service,t.terms_hash,t.artifact_hash);
    }
  }
  const ps=[...input.positions].sort((a,b)=>a.account_id<b.account_id?-1:a.account_id>b.account_id?1:0);
  if(ps.length<2||ps.length>12||new Set(ps.map(p=>p.account_id)).size!==ps.length||JSON.stringify([...members].sort())!==JSON.stringify(ps.map(p=>p.account_id)))throw new Error("PURCHASE_GROUP_MEMBER_MISMATCH");
  let sum=0n;for(const p of ps){if(!/^(0|[1-9]\d*|-[1-9]\d*)$/.test(p.net))throw new Error("INVALID_NET");v4Units(p.net.replace('-',''));sum+=BigInt(p.net);}if(sum!==0n)throw new Error("UNBALANCED_ROUND");
  fields.push(String(ps.length));for(const p of ps)fields.push(p.account_id,p.net);
  return v4Digest(canonicalV4("purchase-group",c.network,c.vault,fields));
}
export function v4PrivateInvoiceCommitment(c:V4Deployment, spec:V4InvoiceSpec, salt:string):string {
  hash(salt);return v4Digest(canonicalV4("private-invoice",c.network,c.vault,[v4InvoiceHash(c,spec),salt]));
}
export function v4PrivateInputCommitment(c:V4Deployment, requestId:string, deadline:number, workerHash:string, envelopes:V4EncryptedInvoice[]):string {
  id(requestId);integer(deadline);hash(workerHash);
  if(!envelopes.length||envelopes.length>V4_MAX_PRIVATE_INVOICES||new Set(envelopes.map(e=>e.nullifier)).size!==envelopes.length)throw new Error("PRIVATE_INVOICE_LIMIT");
  const commitments=envelopes.map(e=>{hash(e.commitment);hash(e.nullifier);return e.commitment;}).sort();
  return v4Digest(canonicalV4("private-input",c.network,c.vault,[requestId,String(deadline),workerHash,String(commitments.length),...commitments]));
}
export function v4PrivateDisclosureHash(c:V4Deployment,inputCommitment:string,members:string[]):string {
  hash(inputCommitment);const sorted=[...members].sort();
  if(sorted.length<2||sorted.length>12||new Set(sorted).size!==sorted.length)throw new Error("PRIVATE_MEMBER_MISMATCH");
  sorted.forEach(account);
  return v4Digest(canonicalV4("private-net-disclosure",c.network,c.vault,[inputCommitment,String(sorted.length),...sorted]));
}
export function encryptV4Invoice(c:V4Deployment, key:V4EncryptionKey, contribution:V4PrivateContribution):V4EncryptedInvoice {
  if(key.protocol_version!==4||key.algorithm!=="X25519-HKDF-SHA256-AES-256-GCM")throw new Error("PRIVATE_KEY_BINDING_MISMATCH");
  hash(key.public_key);hash(key.worker_hash);
  const commitment=v4PrivateInvoiceCommitment(c,contribution.spec,contribution.salt);
  if(contribution.signatures.length!==2||new Set(contribution.signatures.map(s=>s.account_id)).size!==2||contribution.signatures.some(s=>![contribution.spec.buyer,contribution.spec.seller].includes(s.account_id)))throw new Error("PRIVATE_SIGNATURE_PARTY");
  const clear=Buffer.from(JSON.stringify(contribution),"utf8");
  if(clear.length>V4_PRIVATE_INVOICE_PADDING_BYTES)throw new Error("PRIVATE_INPUT_TOO_LARGE");
  const padded=Buffer.alloc(V4_PRIVATE_INVOICE_PADDING_BYTES,0x20);clear.copy(padded);
  const peer=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b656e032100","hex"),Buffer.from(key.public_key,"hex")]),format:"der",type:"spki"});
  const ephemeral=generateKeyPairSync("x25519");const shared=diffieHellman({privateKey:ephemeral.privateKey,publicKey:peer});
  if(shared.every(b=>b===0))throw new Error("PRIVATE_KEY_INVALID");
  const aesKey=Buffer.from(hkdfSync("sha256",shared,Buffer.alloc(0),Buffer.from("ach-private-invoices-v4"),32));
  const nonce=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",aesKey,nonce);
  cipher.setAAD(canonicalV4("private-envelope",c.network,c.vault,[key.worker_hash,commitment]));
  const ciphertext=Buffer.concat([cipher.update(padded),cipher.final(),cipher.getAuthTag()]);
  const envelope={nullifier:v4ChargeId(c,contribution.spec),commitment,ephemeral_public_key:ephemeral.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex"),nonce:nonce.toString("hex"),ciphertext:ciphertext.toString("base64")};
  if(envelope.ciphertext.length>4096)throw new Error("PRIVATE_INPUT_TOO_LARGE");return envelope;
}
export function v4NetPlan(invoices: V4InvoiceSpec[]) {
  if (!invoices.length || invoices.length > 48) throw new Error("ROUND_INVOICE_LIMIT");
  const ids = new Set<string>(); const charges = new Set<string>(); const nets = new Map<string, bigint>(); let gross = 0n;
  for (const i of invoices) {
    const n = v4Units(i.amount); if (!n || i.buyer === i.seller || ids.has(i.id)) throw new Error("INVALID_INVOICE");
    const purchase = `${i.buyer}\0${i.purchase_id}\0${i.terms_version}`;
    if (charges.has(purchase)) throw new Error("DUPLICATE_PURCHASE"); charges.add(purchase); ids.add(i.id);
    gross += n; nets.set(i.buyer, (nets.get(i.buyer) ?? 0n) - n); nets.set(i.seller, (nets.get(i.seller) ?? 0n) + n);
  }
  if (nets.size > 12 || gross > V4_MAX_AMOUNT) throw new Error("ROUND_LIMIT");
  const positions = [...nets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([account_id, net]) => ({ account_id, net: net.toString() }));
  const net = [...nets.values()].filter(n => n < 0n).reduce((sum, n) => sum - n, 0n);
  return { positions, gross_invoice_volume: gross.toString(), net_settlement_volume: net.toString(), settlement_ratio: gross ? Number(net) / Number(gross) : 0, volume_reduction: gross ? 1 - Number(net) / Number(gross) : 0 };
}
export function v4RoundHash(c: V4Deployment, r: V4RoundInput): string {
  id(r.id); integer(r.deadline_ms); if (!r.invoice_ids.length || r.invoice_ids.length > 48 || r.invoice_ids.length !== r.invoice_hashes.length) throw new Error("INVALID_ROUND_INPUT");
  if (r.positions.length < 2 || r.positions.length > 12 || new Set(r.positions.map(p => p.account_id)).size !== r.positions.length) throw new Error("INVALID_MEMBERS");
  const positions = [...r.positions].sort((a, b) => a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0);
  let sum = 0n; for (const p of positions) { account(p.account_id); const negative = p.net.startsWith("-"); const n = v4Units(negative ? p.net.slice(1) : p.net); if (negative && !n) throw new Error("INVALID_NET"); sum += negative ? -n : n; }
  if (sum !== 0n) throw new Error("UNBALANCED_ROUND");
  const pairs = r.invoice_ids.map((id, n) => [id, r.invoice_hashes[n]]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (new Set(r.invoice_ids).size !== r.invoice_ids.length) throw new Error("DUPLICATE_INVOICE");
  for (const [, h] of pairs) hash(h);
  return v4Digest(canonicalV4("round", c.network, c.vault, [r.id, String(r.deadline_ms), r.private ? "private" : "public", r.input_commitment, r.worker_hash, String(pairs.length), ...pairs.flat(), String(positions.length), ...positions.flatMap(p => [p.account_id, p.net])]));
}
export function verifyV4InvoiceSignature(keyHex: string, hashHex: string, signatureBase64: string): boolean {
  try { hash(keyHex); hash(hashHex); const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(keyHex, "hex")]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(hashHex, "hex"), key, Buffer.from(signatureBase64, "base64")); } catch { return false; }
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export class V4BroadcastUnknown extends Error { constructor(public readonly operation_id: string, public readonly tx_hash: string) { super("Transaction confirmation is unknown. Reconcile this operation before sending again."); } }
export function v4UnknownTransaction(error: unknown): boolean {
  const e = error as { message?: string; name?: string; type?: string };
  return /UNKNOWN_TRANSACTION|UnknownTransaction|TransactionDoesNotExist|transaction.*(?:does not|doesn't) exist/i.test(`${e?.type ?? ''} ${e?.name ?? ''} ${e?.message ?? ''}`);
}
const rpcCooldowns = new Map<string,number>();
const rpcRetryWaitMs = 2000;
async function boundedRpcRequest<T>(request:()=>Promise<T>):Promise<T>{
  const signal=AbortSignal.timeout(12_000);
  let expired!:()=>void;
  const timeout=new Promise<never>((_,reject)=>{expired=()=>reject(new Error('RPC request timed out'));signal.addEventListener('abort',expired,{once:true});});
  try{return await Promise.race([request(),timeout]);}
  finally{signal.removeEventListener('abort',expired);}
}
/** Retry transport failures with the same RPC payload. Contract errors are final. */
export class V4RpcProvider extends JsonRpcProvider {
  private connections: JsonRpcProvider[];
  constructor(urls:string|readonly string[]){
    const endpoints=[...new Set(typeof urls==='string'?[urls]:urls)];
    if(!endpoints.length||endpoints.length>4)throw new Error('INVALID_RPC_ENDPOINTS');
    for(const endpoint of endpoints)validateRpcUrl(endpoint);
    super({url:endpoints[0]},{retries:1});this.connections=endpoints.map(url=>new JsonRpcProvider({url},{retries:1}));
  }
  override sendJsonRpc:JsonRpcProvider['sendJsonRpc']=async(method,params)=>{
    for(let cycle=0;cycle<2;cycle++){
      let earliest=Infinity;let missingTransaction:unknown;
      for(const provider of this.connections){
        const endpoint=provider.connection.url,blocked=rpcCooldowns.get(endpoint)??0;
        if(blocked>Date.now()){earliest=Math.min(earliest,blocked);continue;}
        try{return await boundedRpcRequest(()=>provider.sendJsonRpc(method,params));}
        catch(error){
          if(method==='tx'&&v4UnknownTransaction(error)){
            // A lagging RPC can report a transaction missing while another
            // provider already has its final receipt. Check every endpoint.
            missingTransaction=error;continue;
          }
          if(error instanceof RpcError)throw error;
          const e=error as Error&{cause?:number};
          if(![408,429,500,502,503,504].includes(e.cause??0)&&!/fetch failed|Failed to fetch|FetchError|timeout|timed out/i.test(e.message))throw error;
          const seconds=Number(e.message.match(/retry after (\d+) seconds/i)?.[1]??(e.cause===429?30:2));
          // Preserve provider backoff, including long rate limits and a longer
          // cooldown reported by another in-flight request to the same RPC.
          const delay=Number.isFinite(seconds)?Math.max(1,seconds)*1000:30000;
          const until=Math.max(rpcCooldowns.get(endpoint)??0,Date.now()+delay);rpcCooldowns.set(endpoint,until);earliest=Math.min(earliest,until);
        }
      }
      if(missingTransaction)throw missingTransaction;
      const wait=Math.max(0,earliest-Date.now());
      // The durable caller can retry later. Waiting past this short budget
      // would still leave every endpoint blocked and delay wallet progress.
      if(cycle===0&&Number.isFinite(earliest)&&wait<=rpcRetryWaitMs){if(wait)await new Promise(resolve=>setTimeout(resolve,wait));}
      else break;
    }
    throw new Error('RPC_UNAVAILABLE');
  };
}
const signerQueues=new Map<string,Promise<void>>();
const signerHeads=new Map<string,{operation:V4Operation;journal:V4Journal}>();
/** Public journal metadata; older records are decoded without exposing keys. */
export function v4OperationSigner(op:V4Operation):{public_key:string;nonce:bigint}|undefined {
  if(!op.signed_transaction)return;
  try{
    const tx=SignedTransaction.decode(Buffer.from(op.signed_transaction,'base64')).transaction;
    return{public_key:tx.publicKey.toString(),nonce:BigInt(tx.nonce)};
  }catch{return;}
}
/** Called under withV4SignerLock; persist before permitting another nonce. */
export async function v4SignOperation(account:Account,journal:V4Journal,id:string,payload_hash:string,input:Omit<Parameters<Account['createTransaction']>[0],'publicKey'>,amount?:V4Units):Promise<V4Operation>{
  const signer=account.getSigner();if(!signer)throw new Error('SIGNER_REQUIRED');
  const publicKey=await signer.getPublicKey(),key=`${account.accountId}:${String(publicKey)}`;
  const stored=await journal.latestSignerOperation?.(account.accountId,String(publicKey));
  const remembered=signerHeads.get(key);
  let head=remembered;
  if(stored&&(!head||v4OperationSigner(stored)!.nonce>=v4OperationSigner(head.operation)!.nonce))head={operation:stored,journal};
  if(head){
    const current=await head.journal.get(head.operation.id)??head.operation;
    if(['SIGNED','UNKNOWN'].includes(current.state))throw new V4BroadcastUnknown(current.id,current.tx_hash);
  }
  const fresh=new Account(account.accountId,account.provider,signer);
  const transaction=await fresh.createTransaction({...input,publicKey});
  // Access-key views may lag a confirmed transaction. A fresh Account alone
  // therefore cannot safely allocate the next nonce, even with a signer lock.
  const previous=head?v4OperationSigner(head.operation)?.nonce:undefined;
  if(previous!==undefined&&BigInt(transaction.nonce)<=previous)transaction.nonce=previous+1n;
  const signed=await signer.signTransaction(transaction);
  const operation:V4Operation={id,payload_hash,signer_id:account.accountId,public_key:String(publicKey),nonce:transaction.nonce.toString(),tx_hash:baseEncode(signed.txHash),signed_transaction:Buffer.from(signed.signedTransaction.encode()).toString('base64'),state:'SIGNED',created_at_ms:Date.now(),...(amount!==undefined?{amount}:{})};
  await journal.put(operation);
  signerHeads.set(key,{operation,journal});
  return operation;
}
export async function withV4SignerLock<T>(account:Account, task:()=>Promise<T>):Promise<T> {
  const signer=account.getSigner();if(!signer)throw new Error("SIGNER_REQUIRED");
  const key=`${account.accountId}:${String(await signer.getPublicKey())}`;
  const previous=signerQueues.get(key)??Promise.resolve();
  let unlock!:()=>void;const current=new Promise<void>(resolve=>{unlock=resolve;});signerQueues.set(key,current);
  await previous;
  try{return await task();}finally{unlock();if(signerQueues.get(key)===current)signerQueues.delete(key);}
}
export class V4NearTransport implements V4Transport {
  readonly provider: JsonRpcProvider; readonly account: Account;
  constructor(readonly account_id: string, rpc: string|readonly string[], signer: Signer | KeyPairString, private journal: V4Journal) {
    this.provider = new V4RpcProvider(rpc); this.account = new Account(account_id, this.provider, signer);
  }
  async codeHash(contract: string): Promise<string> {
    const account = await this.provider.viewAccount({ accountId: contract, blockQuery: { finality: "final" } });
    return account.code_hash;
  }
  async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.provider.callFunction<T & object>({ contractId: contract, method, args, blockQuery: { finality: "final" } });
    if (result === undefined) throw new Error("EMPTY_CONTRACT_VIEW"); return result as T;
  }
  async call<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>> {
    // All transport instances and action batches sharing this key serialize.
    // External processes must still use distinct keys.
    return withV4SignerLock(this.account,()=>this.submit<T>(contract,method,args,options));
  }
  async reconcile<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions): Promise<V4Confirmed<T>> {
    return withV4SignerLock(this.account,()=>this.submit<T>(contract,method,args,options,true));
  }
  private async submit<T>(contract: string, method: string, args: Record<string, unknown>, options: V4CallOptions, reconcileOnly=false): Promise<V4Confirmed<T>> {
    const payload_hash = v4Digest(stableJson({ signer: this.account_id, contract, method, args, deposit: String(options.deposit ?? 0n), gas: String(options.gas ?? 120_000_000_000_000n) }));
    const existing = await this.journal.get(options.operation_id);
    if (!existing && reconcileOnly) throw new Error('TRANSACTION_NOT_RECORDED');
    let op: V4Operation;
    if (existing) {
      if (existing.payload_hash !== payload_hash) throw new Error("REQUEST_ID_CONFLICT");
      if (existing.state === "CONFIRMED") return existing.result as V4Confirmed<T>;
      if (existing.state === "FAILED") throw new Error(existing.error ?? "TRANSACTION_FAILED");
      // Never create a new transaction/nonce after an uncertain broadcast.
      // NONE returns a definite missing-transaction result immediately. FINAL
      // can wait indefinitely for bytes that were rejected before inclusion.
      try { const status = await this.provider.viewTransactionStatus({ txHash: existing.tx_hash, accountId: existing.signer_id, waitUntil: "NONE" }); return await this.confirm<T>(existing, status, true); }
      catch (error) {
        const current = await this.journal.get(existing.id);
        if (current?.state === "FAILED") throw new Error(current.error ?? "CHAIN_EXECUTION_FAILED");
        if (reconcileOnly || !v4UnknownTransaction(error)) throw new V4BroadcastUnknown(existing.id, existing.tx_hash);
        // Retry the exact signed bytes after reconciling a definite missing tx.
        // A crash before broadcast cannot strand an operation or create a new nonce.
        try { return await this.confirm<T>(existing, await this.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(existing.signed_transaction, "base64")), "FINAL")); }
        catch (e) { if ((await this.journal.get(existing.id))?.state === "FAILED") throw e; throw new V4BroadcastUnknown(existing.id, existing.tx_hash); }
      }
    } else {
      op=await v4SignOperation(this.account,this.journal,options.operation_id,payload_hash,{receiverId:contract,actions:[actions.functionCall(method,args,options.gas??120_000_000_000_000n,options.deposit??0n)]},typeof(args.amount??args.expected_available)==='string'?String(args.amount??args.expected_available):undefined);
    }
    try { const response = await this.provider.sendTransactionUntil(SignedTransaction.decode(Buffer.from(op.signed_transaction, "base64")), "FINAL"); return await this.confirm<T>(op, response); }
    catch (error) {
      const current = await this.journal.get(op.id); if (current?.state === "FAILED") throw error;
      op.state = "UNKNOWN"; await this.journal.put(op); throw new V4BroadcastUnknown(op.id, op.tx_hash);
    }
  }
  private async confirm<T>(op: V4Operation, response: unknown, requireFinal=false): Promise<V4Confirmed<T>> {
    const res = response as { final_execution_status?: string; status?: { SuccessValue?: string; Failure?: unknown }; transaction_outcome?: { outcome: { gas_burnt?: number; tokens_burnt?: string } }; receipts_outcome?: { outcome: { gas_burnt?: number; tokens_burnt?: string; status: { Failure?: unknown } } }[] };
    if (requireFinal && res.final_execution_status !== 'FINAL' || res.final_execution_status && res.final_execution_status !== 'FINAL') throw new V4BroadcastUnknown(op.id, op.tx_hash);
    if (res.status?.Failure) { op.state = "FAILED"; op.error = "CHAIN_EXECUTION_FAILED"; await this.journal.put(op); throw new Error(op.error); }
    if (res.status?.SuccessValue === undefined) throw new V4BroadcastUnknown(op.id, op.tx_hash);
    const raw = Buffer.from(res.status.SuccessValue, "base64").toString();
    const result: V4Confirmed<T> = { value: (raw ? JSON.parse(raw) : null) as T, tx_hash: op.tx_hash, evidence: "near_final" };
    const outcomes = [res.transaction_outcome, ...(res.receipts_outcome ?? [])].filter(Boolean);
    result.gas_burnt = outcomes.reduce((n, o) => n + BigInt(o?.outcome.gas_burnt ?? 0), 0n).toString();
    result.tokens_burnt = outcomes.reduce((n, o) => n + BigInt(o?.outcome.tokens_burnt ?? 0), 0n).toString();
    op.state = "CONFIRMED"; op.result = result; await this.journal.put(op); return result;
  }
}

export class AchV4Client {
  readonly deployment: V4Deployment; private validated = false;
  constructor(config: V4Deployment, readonly transport: V4Transport, private role: "owner" | "agent" = "agent") { this.deployment = validateV4Deployment(config); }
  async assertDeployment(refresh=false) {
    if (this.validated&&!refresh) return;
    const c = await this.transport.view<Record<string, unknown>>(this.deployment.vault, "get_config", {});
    if (c.protocol_version !== 4 || c.network !== this.deployment.network || c.vault !== this.deployment.vault || c.token !== this.deployment.token || c.decimals !== 6) throw new Error("DEPLOYMENT_MISMATCH");
    if(this.deployment.workflow_revision!==undefined&&c.workflow_revision!==this.deployment.workflow_revision)throw new Error("WORKFLOW_REVISION_MISMATCH");
    if (this.deployment.code_hash) {
      if (!this.transport.codeHash) throw new Error('CODE_HASH_VERIFICATION_REQUIRED');
      if (await this.transport.codeHash(this.deployment.vault) !== this.deployment.code_hash) throw new Error("DEPLOYED_CODE_HASH_MISMATCH");
    }
    this.validated = true;
  }
  private async read<T>(method: string, args: Record<string, unknown> = {}): Promise<T> { await this.assertDeployment(); return this.transport.view<T>(this.deployment.vault, method, args); }
  private async write<T>(method: string, args: Record<string, unknown>, operation_id: string, owner = false): Promise<V4Confirmed<T>> {
    await this.assertDeployment(true); if (owner && this.role !== "owner") throw new Error("OWNER_SIGNER_REQUIRED");
    return this.transport.call<T>(this.deployment.vault, method, args, { operation_id, deposit: owner || this.role === "owner" ? 1n : 0n });
  }
  register(name: string, requestId = `register:${this.transport.account_id}`) { return this.write<V4Balance>("register_account", { name }, requestId, true); }
  sponsorAccount(account_id:string,name:string,expires_at_ms:number,requestId:string) { account(account_id);integer(expires_at_ms);return this.write("authorize_account_registration",{account_id,name,expires_at_ms},requestId,true); }
  setPolicy(policy: Omit<V4Policy, "epoch" | "revoked">, requestId: string) { return this.write<V4Policy>("set_agent_policy", policy, requestId, true); }
  revokeAgent(requestId: string) { return this.write<V4Policy>("revoke_agent", {}, requestId, true); }
  balance(account_id = this.transport.account_id) { return this.read<V4Balance>("get_balance", { account_id }); }
  invoice(id: string) { return this.read<V4Invoice>("get_invoice", { id }); }
  round(id: string) { return this.read<V4Round>("get_round", { id }); }
  purchaseGroup(id:string) { return this.read<V4FundingGroup>("get_purchase_group",{id}); }
  purchaseOrder(id:string) { return this.read<{group_id:string;order:V4FundingOrder;status:string;invoice_id:string|null}|null>("get_purchase_order",{id}); }
  proposePurchaseGroup(input:V4FundingGroupInput) { v4FundingGroupHash(this.deployment,input);return this.write<V4FundingGroup>("propose_purchase_group",{input},`purchase-group:${input.id}`); }
  authorizePurchaseGroup(group:V4FundingGroup,expected_net:string) {
    if(v4FundingGroupHash(this.deployment,group.input)!==group.hash)throw new Error("PURCHASE_GROUP_HASH_MISMATCH");
    const own=group.input.positions.find(p=>p.account_id===this.transport.account_id);
    if(!own||own.net!==expected_net)throw new Error("EXACT_NET_AUTHORIZATION_REQUIRED");
    return this.write<V4FundingGroup>("authorize_purchase_group",{id:group.input.id,expected_hash:group.hash,expected_net},`fund:${group.input.id}:${this.transport.account_id}`);
  }
  expirePurchaseGroup(id:string) { return this.write<V4FundingGroup>("expire_purchase_group",{id},`expire-purchase-group:${id}`); }
  proposeInvoice(spec: V4InvoiceSpec) { canonicalV4Invoice(this.deployment, spec); return this.write<V4Invoice>("propose_invoice", { spec }, `invoice:${spec.id}`); }
  acceptInvoice(invoice: V4Invoice) { if (v4InvoiceHash(this.deployment, invoice.spec) !== invoice.hash) throw new Error("INVOICE_HASH_MISMATCH"); return this.write<V4Invoice>("accept_invoice", { id: invoice.spec.id, expected_hash: invoice.hash }, `accept:${invoice.spec.id}:${this.transport.account_id}`); }
  cancelInvoice(invoice: V4Invoice) { return this.write<V4Invoice>("cancel_invoice_by_agreement", { id: invoice.spec.id, expected_hash: invoice.hash }, `cancel-invoice:${invoice.spec.id}:${this.transport.account_id}`); }
  proposeRound(id: string, invoice_ids: string[], deadline_ms: number) { return this.write<V4Round>("propose_round", { id, invoice_ids, deadline_ms }, `round:${id}`); }
  authorizeRound(round: V4Round, expected_net: string) {
    if (v4RoundHash(this.deployment, round.input) !== round.hash) throw new Error("ROUND_HASH_MISMATCH");
    const own = round.input.positions.find(p => p.account_id === this.transport.account_id);
    if (!own || own.net !== expected_net) throw new Error("EXACT_NET_AUTHORIZATION_REQUIRED");
    return this.write<V4Round>("authorize_round", { id: round.input.id, expected_hash: round.hash, expected_net }, `authorize:${round.input.id}:${this.transport.account_id}`);
  }
  cancelRound(round: V4Round) { return this.write<V4Round>("cancel_round_authorization", { id: round.input.id, expected_hash: round.hash }, `cancel-round:${round.input.id}:${this.transport.account_id}`); }
  settleRound(round: V4Round) { return this.write<V4Round>("settle_round", { id: round.input.id, expected_hash: round.hash }, `settle:${round.input.id}`); }
  expireRound(id: string) { return this.write<V4Round>("expire_round", { id }, `expire:${id}`); }
  releaseStaleRound(id: string) { return this.write<V4Round>("release_stale_round", { id }, `release-stale:${id}`); }
  listInvoices(cursor = 0, limit = 25, account_id?: string) { return this.read<V4Page<V4Invoice>>("list_invoices", { cursor, limit, ...(account_id ? { account_id } : {}) }); }
  listRounds(cursor = 0, limit = 25) { return this.read<V4Page<V4Round>>("list_rounds", { cursor, limit }); }
  listActivity(account_id = this.transport.account_id, cursor = 0, limit = 25) { return this.read<V4Page<{ kind: string; reference: string; amount: string | null; at_ms: number }>>("list_account_activity", { account_id, cursor, limit }); }
  withdrawal(id: string) { return this.read<V4Withdrawal | null>("get_withdrawal", { id }); }
  privateEncryptionKey() { return this.read<V4EncryptionKey|null>("get_private_encryption_key"); }
  privateRequest(id:string) { return this.read<{status:string;id:string;deadline_ms:number;verification_only:boolean}|null>("get_private_request",{id}); }
  expirePrivateRequest(id:string) { return this.write<{status:string;id:string}>("expire_private_request",{id},`expire-private:${id}`); }
  privateInvoice(id:string) { return this.read<{status:string;charge:{commitment:string;buyer:string};round_id:string|null}|null>("get_private_invoice",{id}); }
  privatePurchase(id:string) { return this.read<V4PrivatePurchaseAuthorization|null>("get_private_purchase",{id}); }
  cancelPendingPrivatePurchase(order:V4PrivatePurchaseAuthorization) { hash(order.charge_id);hash(order.order_commitment);return this.write<V4PrivatePurchaseAuthorization>("cancel_pending_private_purchase",{id:order.charge_id,expected_hash:order.order_commitment},`cancel-private-order:${order.charge_id}:${this.transport.account_id}`); }
  authorizePrivatePurchase(request:{purchase_id:string;terms_version:number;seller:string;order_commitment:string;deadline_ms?:number}) {
    id(request.purchase_id);integer(request.terms_version);account(request.seller);hash(request.order_commitment);
    if(!request.terms_version||request.purchase_id.length<32)throw new Error("INVALID_PRIVATE_PURCHASE");
    const charge=v4ChargeId(this.deployment,{buyer:this.transport.account_id,purchase_id:request.purchase_id,terms_version:request.terms_version});
    return this.write<V4PrivatePurchaseAuthorization>("authorize_private_purchase",request,`private-purchase:${charge}`);
  }
  async requestPrivateRound(request:V4PrivateRoundRequest, sponsorPayment=20_000_000_000_000_000_000_000n) {
    if(this.role!=="owner")throw new Error("OWNER_SPONSOR_SIGNER_REQUIRED");await this.assertDeployment(true);
    const encryption=await this.privateEncryptionKey();if(!encryption)throw new Error("PRIVATE_MODE_UNAVAILABLE");
    const input_commitment=v4PrivateInputCommitment(this.deployment,request.id,request.deadline_ms,encryption.worker_hash,request.encrypted_invoices);
    v4PrivateDisclosureHash(this.deployment,input_commitment,request.members);
    if(!request.verification_only && (!request.disclosure_signatures||request.disclosure_signatures.length!==request.members.length))throw new Error("PRIVATE_DISCLOSURE_CONSENT_REQUIRED");
    if(sponsorPayment<=0n||sponsorPayment>50_000_000_000_000_000_000_000n)throw new Error("BOUNDED_SPONSOR_PAYMENT_REQUIRED");
    return this.transport.call<{id:string;status:string}>(this.deployment.vault,"request_private_round",{...request,input_commitment},{operation_id:`private:${request.id}`,deposit:sponsorPayment,gas:280_000_000_000_000n});
  }
  withdraw(id: string, amount: V4Units) { v4Units(amount); return this.write<V4Withdrawal>("request_withdrawal", { id, amount, receiver_id: this.transport.account_id }, `withdraw:${id}`, true); }
  recoveryWithdrawal(account_id=this.transport.account_id) { return this.read<V4Withdrawal & {sequence:number}>("get_recovery_withdrawal",{account_id}); }
  recoveryWithdraw(nonce:number,expected_available:V4Units) { integer(nonce);v4Units(expected_available);return this.write<V4Withdrawal>("request_recovery_withdrawal",{nonce,expected_available},`recovery:${this.transport.account_id}:${nonce}`,true); }
  async deposit(id: string, amount: V4Units) {
    if (this.role !== "owner") throw new Error("OWNER_SIGNER_REQUIRED"); v4Units(amount); if(!/^[a-zA-Z0-9_.-]{1,96}$/.test(id))throw new Error("INVALID_ID");await this.assertDeployment(true);
    return this.transport.call<V4Units>(this.deployment.token, "ft_transfer_call", { receiver_id: this.deployment.vault, amount, msg: `deposit:${id}` }, { operation_id: `deposit:${id}`, deposit: 1n, gas: 120_000_000_000_000n });
  }
}
