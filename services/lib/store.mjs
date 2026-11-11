import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { v4Digest } from '../../packages/client/dist/v4.js';
import {randomBytes,createCipheriv,createDecipheriv}from 'node:crypto';
export class StateStore {
  constructor(filename,{sealingKey}={}) {
    this.sealingKey=sealingKey?Buffer.from(sealingKey,'hex'):null;if(this.sealingKey&&this.sealingKey.length!==32)throw new Error('PRIVATE_STORAGE_KEY_INVALID');
    mkdirSync(path.dirname(filename), { recursive:true, mode:0o700 });
    this.db=new DatabaseSync(filename);chmodSync(filename,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE,ip_hash TEXT,created_at INTEGER,expires_at INTEGER,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,session_id TEXT,request_hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,at_ms INTEGER,kind TEXT,reference TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS sponsor_days(day TEXT PRIMARY KEY,sessions INTEGER NOT NULL,native_reserved TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  async get(id){const row=this.db.prepare('SELECT data FROM operations WHERE id=?').get(id);return row?JSON.parse(row.data):undefined;}
  async put(op){this.db.prepare('INSERT INTO operations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(op.id,JSON.stringify(op));}
  putSession(session,token,ipHash){this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(session.id,v4Digest(token),ipHash,session.created_at_ms,session.expires_at_ms,JSON.stringify(session));}
  session(id){const row=this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id);return row?JSON.parse(row.data):undefined;}
  authenticate(token,now=Date.now()){if(!token||!/^[a-f\d]{64}$/.test(token))throw new Error('SESSION_REQUIRED');const row=this.db.prepare('SELECT data,expires_at FROM sessions WHERE token_hash=?').get(v4Digest(token));if(!row||row.expires_at<now)throw new Error('SESSION_EXPIRED');return JSON.parse(row.data);}
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
  job(id){const row=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);return row?this.decodeJob(row.data):undefined;}
  saveJob(job){this.db.prepare('UPDATE jobs SET state=?,data=? WHERE id=?').run(job.state,this.encodeJob(job),job.id);}
  jobs(sessionId){return this.db.prepare('SELECT data FROM jobs WHERE session_id=? ORDER BY rowid').all(sessionId).map(r=>this.decodeJob(r.data));}
  event(sessionId,kind,reference,data={}){this.db.prepare('INSERT INTO events(session_id,at_ms,kind,reference,data)VALUES(?,?,?,?,?)').run(sessionId,Date.now(),kind,reference,JSON.stringify(data));}
  events(sessionId,after=0){return this.db.prepare('SELECT sequence,at_ms,kind,reference,data FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(sessionId,after).map(r=>({...r,data:JSON.parse(r.data)}));}
  reserveSession(ipHash,{dailyLimit=40,ipLimit=5,maxNative='8000000000000000000000000',perSessionNative='200000000000000000000000'}={}){
    const day=new Date().toISOString().slice(0,10);this.db.exec('BEGIN IMMEDIATE');
    try{const row=this.db.prepare('SELECT * FROM sponsor_days WHERE day=?').get(day)??{sessions:0,native_reserved:'0'};
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ip_hash=? AND created_at>=?').get(ipHash,Date.parse(`${day}T00:00:00Z`)).n;
      if(row.sessions>=dailyLimit||count>=ipLimit||BigInt(row.native_reserved)+BigInt(perSessionNative)>BigInt(maxNative))throw new Error('FREE_SESSION_QUOTA_REACHED');
      this.db.prepare('INSERT INTO sponsor_days VALUES(?,?,?) ON CONFLICT(day)DO UPDATE SET sessions=excluded.sessions,native_reserved=excluded.native_reserved').run(day,row.sessions+1,(BigInt(row.native_reserved)+BigInt(perSessionNative)).toString());this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  pendingSessions(){return this.db.prepare('SELECT data FROM sessions WHERE expires_at>?').all(Date.now()).map(r=>JSON.parse(r.data));}
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
