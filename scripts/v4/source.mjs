import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const roots=[
 'contracts/ach-v4','contracts/test-usdc','crates','workers/private-netting',
 'packages/core/src','packages/core/package.json','packages/core/package-lock.json','packages/client/src','packages/client/package.json','packages/client/package-lock.json',
 'contracts/clearing/package.json','contracts/clearing/package-lock.json','contracts/clearing/scripts','contracts/clearing/src','contracts/clearing/test','contracts/clearing/vitest.config.ts',
 'packages/intents/src','packages/intents/package.json','packages/intents/package-lock.json',
 'services','web/app','web/components','web/lib','web/public','web/package.json','web/package-lock.json',
 'web/next.config.ts','web/postcss.config.mjs','web/tailwind.config.ts','web/tsconfig.json','web/.vercelignore',
 'scripts/v4','scripts/deploy-contract.mjs','scripts/create-testnet.mjs','tests/v4',
 'package.json','package-lock.json','Cargo.toml','Cargo.lock','rust-toolchain.toml','LICENSE','README.md','.gitignore','docs',
 'packages/client/README.md','packages/client/LICENSE','packages/intents/README.md','packages/intents/LICENSE',
];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function sourceFingerprint(gitContext){
 const entries=new Map();
 function visit(filename){
  const absolute=path.join(repository,filename);
  if(!existsSync(absolute))return;
  if(statSync(absolute).isDirectory()){
   for(const entry of readdirSync(absolute,{withFileTypes:true})){
    if(['node_modules','.local','.git','dist','build','target'].includes(entry.name)||entry.name.startsWith('.env')||entry.name.startsWith('.next'))continue;
    if(entry.isFile()||entry.isDirectory())visit(path.join(filename,entry.name));
   }
  }else entries.set(filename.split(path.sep).join('/'),digest(readFileSync(absolute)));
 }
 for(const root of roots)visit(root);
 const normalized=[...entries].sort(([a],[b])=>a.localeCompare(b));
 const commit=gitContext?.commit??execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
 const dirty=gitContext?.dirty??Boolean(execFileSync('git',['status','--porcelain'],{cwd:repository,encoding:'utf8'}).trim());
 if(!/^[a-f\d]{40}$/.test(commit)||typeof dirty!=='boolean')throw new Error('VERIFIED_GIT_CONTEXT_REQUIRED');
 const fingerprint=digest(JSON.stringify(normalized,null,2)),publication=gitContext?.publication;
 if(publication!==undefined&&(!publication||publication.verified!==true||publication.repository!=='NSEVEjk0/ach-v4'||publication.commit!==commit||publication.fingerprint_sha256!==fingerprint||dirty||!Number.isFinite(Date.parse(publication.verified_at))))throw new Error('PUBLISHED_SOURCE_CONTEXT_MISMATCH');
 return{
  commit,dirty,
  fingerprint_sha256:fingerprint,file_count:normalized.length,
  roots,repository_pushed:publication!==undefined,
  ...(publication?{publication}:{}),
 };
}
