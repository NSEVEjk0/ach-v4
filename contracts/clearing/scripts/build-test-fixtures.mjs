import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=new URL('../test/fixtures/legacy/',import.meta.url);
const recorded=JSON.parse(readFileSync(new URL('source.json',fixture),'utf8'));
for(const [name,info] of Object.entries(recorded.files)){
 assert.match(name,/^[a-z]+\.ts$/);
 assert.equal(createHash('sha256').update(readFileSync(new URL(name,fixture))).digest('hex'),info.sha256,'HISTORICAL_MIGRATION_FIXTURE_CHANGED');
}
const cli=require.resolve('near-sdk-js/lib/cli/cli.js');
for(const [source,output] of [
 ['src/index.ts','build/clearing-v3.wasm'],
 ['test/fixtures/legacy/index.ts','build/clearing.wasm'],
 ['test/fixtures/withdrawal-failure.ts','build/withdrawal-failure.wasm'],
]){
 const result=spawnSync(process.execPath,[cli,'build',source,output],{cwd:root,stdio:'inherit'});
 if(result.error||result.status!==0||result.signal)throw new Error('CONTRACT_TEST_FIXTURE_BUILD_FAILED:'+source);
}
