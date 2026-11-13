import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { v4Digest,v4OperationSigner } from '../../packages/client/dist/v4.js';
import {randomBytes,createCipheriv,createDecipheriv}from 'node:crypto';
export class StateStore {
  constructor(filename,{sealingKey}={}) {
    this.sealingKey=sealingKey?Buffer.from(sealingKey,'hex'):null;if(this.sealingKey&&this.sealingKey.length!==32)throw new Error('PRIVATE_STORAGE_KEY_INVALID');
    mkdirSync(path.dirname(filename), { recursive:true, mode:0o700 });
    this.db=new DatabaseSync(filename);chmodSync(filename,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE,ip_hash TEXT,created_at INTEGER,expires_at INTEGER,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_access(session_id TEXT PRIMARY KEY REFERENCES sessions(id),token_hash TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS brief_admissions(session_id TEXT PRIMARY KEY REFERENCES sessions(id),last_started_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS inference_days(day TEXT PRIMARY KEY,requests_reserved INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,session_id TEXT,request_hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS planner_attempts(job_id TEXT PRIMARY KEY REFERENCES jobs(id),requests_used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS operations_signer ON operations(json_extract(data,'$.signer_id'));
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,at_ms INTEGER,kind TEXT,reference TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS sponsor_days(day TEXT PRIMARY KEY,sessions INTEGER NOT NULL,native_reserved TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  async get(id){const row=this.db.prepare('SELECT data FROM operations WHERE id=?').get(id);return row?JSON.parse(row.data):undefined;}
  async put(op){this.db.prepare('INSERT INTO operations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(op.id,JSON.stringify(op));}
  async latestSignerOperation(accountId,publicKey){
    let latest,nonce=-1n;
    for(const row of this.db.prepare("SELECT data FROM operations WHERE json_extract(data,'$.signer_id')=? ORDER BY rowid").all(accountId)){
      const op=JSON.parse(row.data),info=v4OperationSigner(op);
      if(info?.public_key===publicKey&&info.nonce>=nonce){latest=op;nonce=info.nonce;}
    }
    return latest;
  }
  ownerOperations(accounts){
    const owners=new Set(accounts);
    return this.db.prepare("SELECT data FROM operations WHERE id LIKE 'withdraw:%' OR id LIKE 'deposit:%' OR id LIKE 'recovery:%' OR id LIKE 'revoke-%'").all().map(r=>JSON.parse(r.data)).filter(op=>owners.has(op.signer_id)).map(op=>({id:op.id,account_id:op.signer_id,state:op.state,tx_hash:op.tx_hash,evidence:op.result?.evidence??null,value:op.result?.value??null,amount:op.amount??null,created_at_ms:op.created_at_ms??null}));
  }
  putSession(session,token,ipHash){this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(session.id,v4Digest(token),ipHash,session.created_at_ms,session.expires_at_ms,JSON.stringify(session));}
  session(id){const row=this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id);return row?JSON.parse(row.data):undefined;}
  authenticate(token,now=Date.now()){if(!token||!/^[a-f\d]{64}$/.test(token))throw new Error('SESSION_REQUIRED');const hash=v4Digest(token),row=this.db.prepare('SELECT data,expires_at FROM sessions WHERE token_hash=? UNION ALL SELECT s.data,s.expires_at FROM session_access a JOIN sessions s ON s.id=a.session_id WHERE a.token_hash=? LIMIT 1').get(hash,hash);if(!row||row.expires_at<=now)throw new Error('SESSION_EXPIRED');const session=JSON.parse(row.data);if(session.prepared_pool)throw new Error('SESSION_REQUIRED');return session;}
  workspaceSessions(current,now=Date.now()){
    const owner=this.session(current.id);if(!owner||owner.expires_at_ms<=now)throw new Error('SESSION_EXPIRED');
    const family=owner.family_id??owner.id;
    return this.db.prepare("SELECT data FROM sessions WHERE expires_at>? AND (json_extract(data,'$.family_id')=? OR id=?) ORDER BY created_at DESC,id DESC").all(now,family,family).map(r=>JSON.parse(r.data)).map(s=>({id:s.id,created_at_ms:s.created_at_ms,expires_at_ms:s.expires_at_ms,state:s.state,briefs_run:this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE session_id=? AND id LIKE 'run-%'").get(s.id).n}));
  }
  switchSession(current,id,now=Date.now()){
    if(typeof id!=='string'||!/^[a-f\d]{32}$/.test(id))throw new Error('SESSION_OWNER_SCOPE_REQUIRED');
    const owner=this.session(current.id),target=this.session(id);
    if(!owner||owner.expires_at_ms<=now)throw new Error('SESSION_EXPIRED');
    if(!/^[a-f\d]{32}$/.test(id)||!target||target.expires_at_ms<=now||(owner.family_id??owner.id)!==(target.family_id??target.id))throw new Error('SESSION_OWNER_SCOPE_REQUIRED');
    const token=randomBytes(32).toString('hex');this.db.prepare('INSERT INTO session_access VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET token_hash=excluded.token_hash').run(id,v4Digest(token));return{session:target,token};
  }
  updateSession(session){this.db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(session),session.id);}
  encodeJob(job){if(!job.sealed)return JSON.stringify(job);if(!this.sealingKey)throw new Error('PRIVATE_STORAGE_UNAVAILABLE');const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.sealingKey,nonce);cipher.setAAD(Buffer.from(job.id+':'+job.session_id));const data=Buffer.concat([cipher.update(JSON.stringify(job)),cipher.final(),cipher.getAuthTag()]);return JSON.stringify({sealed:true,id:job.id,session_id:job.session_id,nonce:nonce.toString('hex'),ciphertext:data.toString('base64')});}
  decodeJob(data){const v=JSON.parse(data);if(!v.sealed||!v.ciphertext)return v;if(!this.sealingKey)throw new Error('PRIVATE_STORAGE_UNAVAILABLE');const bytes=Buffer.from(v.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',this.sealingKey,Buffer.from(v.nonce,'hex'));decipher.setAAD(Buffer.from(v.id+':'+v.session_id));decipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString());}
  startJob(id,sessionId,payload){
    const privateRecord=payload?.privacy==='private'||payload?.order?.privacy==='private';
    if(privateRecord&&!this.sealingKey)throw new Error('PRIVATE_MODE_UNAVAILABLE');
    const requestHash=v4Digest(JSON.stringify(payload));const old=this.job(id);
    if(old){if(old.session_id!==sessionId||old.request_hash!==requestHash)throw new Error('REQUEST_ID_CONFLICT');return old;}
    const job={id,session_id:sessionId,request_hash:requestHash,state:'STARTED',payload,created_at_ms:Date.now(),...(privateRecord?{sealed:true}:{})};
    this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(id,sessionId,requestHash,job.state,this.encodeJob(job));return job;
  }
  assertSessionJobAdmission(id,sessionId){
    // Judge tests use the same trading keys as the separate service processes.
    // Reserve the workspace before starting either side of that shared work.
    if(id.startsWith('test-netting-')){
      if(this.db.prepare("SELECT 1 FROM jobs WHERE session_id=? AND id<>? AND state IN ('STARTED','WAITING') AND (id LIKE 'run-%' OR id LIKE 'clear-%' OR id LIKE 'test-netting-%') LIMIT 1").get(sessionId,id))throw new Error('SESSION_PAYMENT_IN_PROGRESS');
    }else if(id.startsWith('run-')||id.startsWith('clear-')){
      if(this.db.prepare("SELECT 1 FROM jobs WHERE session_id=? AND id<>? AND state IN ('STARTED','WAITING') AND id LIKE 'test-netting-%' LIMIT 1").get(sessionId,id))throw new Error('SESSION_NETTING_TEST_IN_PROGRESS');
    }
  }
  startSessionJob(id,sessionId,payload,{kind,maxJobs=12}={}){
    const prefix=kind==='test'?'test-netting-':kind==='clear'?'clear-':null;
    if(!prefix||!id.startsWith(prefix)||!Number.isSafeInteger(maxJobs)||maxJobs<1)throw new Error('INVALID_SESSION_JOB_ADMISSION');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.job(id);
      // Validate replay identity before any admission or quota response.
      if(old){const job=this.startJob(id,sessionId,payload);if(job.state==='COMPLETE'){this.db.exec('COMMIT');return job;}}
      this.assertSessionJobAdmission(id,sessionId);
      if(!old&&this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE session_id=? AND id LIKE ?').get(sessionId,prefix+'%').n>=maxJobs)throw new Error('SESSION_CLEARING_QUOTA_REACHED');
      const job=this.startJob(id,sessionId,payload);this.db.exec('COMMIT');return job;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  startBrief(id,sessionId,payload,{now=Date.now(),intervalMs=5000,maxPlannerCallsPerDay=2000}={}){
    if(!Number.isSafeInteger(now)||!Number.isSafeInteger(intervalMs)||intervalMs<0||!Number.isSafeInteger(maxPlannerCallsPerDay)||maxPlannerCallsPerDay<2)throw new Error('INVALID_BRIEF_ADMISSION');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(this.job(id)){const job=this.startJob(id,sessionId,payload);if(job.state!=='COMPLETE')this.assertSessionJobAdmission(id,sessionId);this.db.exec('COMMIT');return job;}
      this.assertSessionJobAdmission(id,sessionId);
      if(this.db.prepare("SELECT 1 FROM jobs WHERE session_id=? AND id LIKE 'run-%' AND state IN ('STARTED','WAITING') LIMIT 1").get(sessionId))throw new Error('SESSION_BRIEF_IN_PROGRESS');
      const admission=this.db.prepare('SELECT last_started_at FROM brief_admissions WHERE session_id=?').get(sessionId);
      if(admission&&now-admission.last_started_at<intervalMs)throw new Error('BRIEF_RATE_LIMITED');
      const day=new Date(now).toISOString().slice(0,10),used=this.db.prepare('SELECT requests_reserved FROM inference_days WHERE day=?').get(day)?.requests_reserved??0;
      // Reserve both allowed planner attempts before a new paid inference.
      // A shared resource budget bounds usage while preserving repeat requests.
      if(used+2>maxPlannerCallsPerDay)throw new Error('SPONSORED_INFERENCE_UNAVAILABLE');
      const job=this.startJob(id,sessionId,payload);
      this.db.prepare('INSERT INTO brief_admissions VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET last_started_at=excluded.last_started_at').run(sessionId,now);
      this.db.prepare('INSERT INTO inference_days VALUES(?,?) ON CONFLICT(day) DO UPDATE SET requests_reserved=excluded.requests_reserved').run(day,used+2);
      this.db.exec('COMMIT');return job;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  job(id){const row=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);return row?this.decodeJob(row.data):undefined;}
  consumePlannerAttempt(id){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(!this.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id))throw new Error('AI_PLANNER_JOB_REQUIRED');
      const used=this.db.prepare('SELECT requests_used FROM planner_attempts WHERE job_id=?').get(id)?.requests_used??0;
      if(used>=2)throw new Error('AI_PLANNER_ATTEMPTS_EXHAUSTED');
      this.db.prepare('INSERT INTO planner_attempts VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET requests_used=excluded.requests_used').run(id,used+1);
      this.db.exec('COMMIT');return used+1;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  saveJob(job){
    const active=['STARTED','WAITING'].includes(job.state),shared=['run-','clear-','test-netting-'].some(prefix=>job.id.startsWith(prefix));
    if(!active||!shared){this.db.prepare('UPDATE jobs SET state=?,data=? WHERE id=?').run(job.state,this.encodeJob(job),job.id);return;}
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.job(job.id);
      // Failed work can become recoverable after a delayed chain proof. Its
      // revival must acquire admission atomically, just like a fresh request.
      if(old&&!['STARTED','WAITING'].includes(old.state))this.assertSessionJobAdmission(job.id,job.session_id);
      this.db.prepare('UPDATE jobs SET state=?,data=? WHERE id=?').run(job.state,this.encodeJob(job),job.id);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  jobs(sessionId){return this.db.prepare('SELECT data FROM jobs WHERE session_id=? ORDER BY rowid').all(sessionId).map(r=>this.decodeJob(r.data));}
  event(sessionId,kind,reference,data={}){this.db.prepare('INSERT INTO events(session_id,at_ms,kind,reference,data)VALUES(?,?,?,?,?)').run(sessionId,Date.now(),kind,reference,JSON.stringify(data));}
  eventOnce(sessionId,kind,reference,data={}){this.db.prepare('INSERT INTO events(session_id,at_ms,kind,reference,data) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM events WHERE session_id=? AND kind=? AND reference=?)').run(sessionId,Date.now(),kind,reference,JSON.stringify(data),sessionId,kind,reference);}
  events(sessionId,after=0){return this.db.prepare('SELECT sequence,at_ms,kind,reference,data FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(sessionId,after).map(r=>({...r,data:JSON.parse(r.data)}));}
  eventPage(sessionId,{before=null,limit=100}={}){
    if(before!==null&&(!Number.isSafeInteger(before)||before<1)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('INVALID_HISTORY_CURSOR');
    const rows=this.db.prepare('SELECT sequence,at_ms,kind,reference,data FROM events WHERE session_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?').all(sessionId,before,before,limit+1);
    const more=rows.length>limit,items=rows.slice(0,limit).reverse().map(r=>({...r,data:JSON.parse(r.data)}));
    return{items,next_cursor:more?items[0].sequence:null};
  }
  reserveSession(ipHash,{dailyLimit=null,ipLimit=null,maxNative='8000000000000000000000000',perSessionNative='200000000000000000000000',intervalMs=10000}={}){
    if(![dailyLimit,ipLimit].every(n=>n===null||Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(intervalMs)||intervalMs<0||BigInt(perSessionNative)<=0n||BigInt(maxNative)<BigInt(perSessionNative))throw new Error('INVALID_SPONSOR_LIMITS');
    const day=new Date().toISOString().slice(0,10);this.db.exec('BEGIN IMMEDIATE');
    try{const row=this.db.prepare('SELECT * FROM sponsor_days WHERE day=?').get(day)??{sessions:0,native_reserved:'0'};
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ip_hash=? AND created_at>=?').get(ipHash,Date.parse(`${day}T00:00:00Z`)).n;
      const latest=this.db.prepare('SELECT MAX(created_at) AS at_ms FROM sessions WHERE ip_hash=?').get(ipHash);
      if(latest?.at_ms!==null&&Date.now()-latest.at_ms<intervalMs)throw new Error('WORKSPACE_RATE_LIMITED');
      if(dailyLimit!==null&&row.sessions>=dailyLimit||ipLimit!==null&&count>=ipLimit||BigInt(row.native_reserved)+BigInt(perSessionNative)>BigInt(maxNative))throw new Error('FREE_SESSION_QUOTA_REACHED');
      this.db.prepare('INSERT INTO sponsor_days VALUES(?,?,?) ON CONFLICT(day)DO UPDATE SET sessions=excluded.sessions,native_reserved=excluded.native_reserved').run(day,row.sessions+1,(BigInt(row.native_reserved)+BigInt(perSessionNative)).toString());this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  pendingSessions({includePrepared=false}={}){return this.db.prepare("SELECT data FROM sessions WHERE expires_at>? AND (? OR COALESCE(json_extract(data,'$.prepared_pool'),0)=0)").all(Date.now(),includePrepared?1:0).map(r=>JSON.parse(r.data));}
  claimPreparedSession(ipHash,parent,agentCount,{ipLimit=null,intervalMs=10000}={}){
    if(!/^[a-f\d]{64}$/.test(ipHash)||!Number.isSafeInteger(agentCount)||agentCount<3||agentCount>12||ipLimit!==null&&(!Number.isSafeInteger(ipLimit)||ipLimit<1)||!Number.isSafeInteger(intervalMs)||intervalMs<0)throw new Error('INVALID_SPONSOR_LIMITS');
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare("SELECT data FROM sessions WHERE expires_at>? AND json_extract(data,'$.prepared_pool')=1 AND json_extract(data,'$.state')='READY' AND json_extract(data,'$.agent_count')>=? ORDER BY json_extract(data,'$.agent_count'),created_at DESC LIMIT 1").get(now+3600000,agentCount);
      if(!row){this.db.exec('COMMIT');return;}
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ip_hash=? AND created_at>=?').get(ipHash,Date.parse(day+'T00:00:00Z')).n;
      const latest=this.db.prepare('SELECT MAX(created_at) AS at_ms FROM sessions WHERE ip_hash=?').get(ipHash).at_ms;
      if(latest!==null&&now-latest<intervalMs)throw new Error('WORKSPACE_RATE_LIMITED');
      if(ipLimit!==null&&count>=ipLimit)throw new Error('FREE_SESSION_QUOTA_REACHED');
      const previous=parent?this.session(parent.id):null;
      if(parent&&(!previous||previous.expires_at_ms<=now))throw new Error('SESSION_EXPIRED');
      const session=JSON.parse(row.data),token=randomBytes(32).toString('hex');
      delete session.prepared_pool;
      session.wallet_prepared_at_ms=session.provisioned_at_ms;
      session.created_at_ms=now;session.requested_agent_count=agentCount;session.family_id=previous?(previous.family_id??previous.id):session.id;
      this.db.prepare('UPDATE sessions SET token_hash=?,ip_hash=?,created_at=?,data=? WHERE id=?').run(v4Digest(token),ipHash,now,JSON.stringify(session),session.id);
      this.db.exec('COMMIT');return{session,token};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  ensureSessionReservation(session,{maxNative,perSessionNative}){
    const required=BigInt(perSessionNative);
    // The single session created by the pre-release sponsor reserved 0.4 NEAR.
    const previous=BigInt(session.sponsor_native_reserved??'400000000000000000000000');
    if(previous>=required)return;
    const day=new Date(session.created_at_ms).toISOString().slice(0,10);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('SELECT native_reserved FROM sponsor_days WHERE day=?').get(day);
      if(!row)throw new Error('SPONSOR_RESERVATION_MISSING');
      const next=BigInt(row.native_reserved)+required-previous;
      if(next>BigInt(maxNative))throw new Error('FREE_SESSION_QUOTA_REACHED');
      session.sponsor_native_reserved=required.toString();
      this.db.prepare('UPDATE sponsor_days SET native_reserved=? WHERE day=?').run(next.toString(),day);
      this.updateSession(session);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
