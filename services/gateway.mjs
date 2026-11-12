import {spawn}from 'node:child_process';
import {readFileSync,writeFileSync}from 'node:fs';
import {Account,KeyPair,actions}from '../packages/client/dist/near.js';
import {V4RpcProvider}from '../packages/client/dist/v4.js';
import {StateStore}from './lib/store.mjs';
import {durableActions}from './lib/transactions.mjs';
import {privatePath,manifestPath}from './lib/paths.mjs';
import {requireServiceLayout,requireIdentityAccount}from './lib/workflow.mjs';
const config=JSON.parse(readFileSync(manifestPath,'utf8'));requireServiceLayout(config);
const identity=requireIdentityAccount(config,'publisher',JSON.parse(readFileSync(privatePath('gateway-publisher.json'),'utf8')));
if(identity.role!=='gateway-publisher')throw new Error('PUBLISHER_IDENTITY_NAMESPACE_MISMATCH');
const journal=new StateStore(privatePath('gateway.sqlite'));
const account=new Account(identity.account_id,new V4RpcProvider(config.rpc_urls??config.rpc_url),identity.secret_key),key=KeyPair.fromString(identity.secret_key);
let current='',publishing=false,buffer='';
const message=record=>Buffer.from(['ACH gateway v4',config.network,config.vault,record.url,String(record.published_at_ms),String(record.expires_at_ms)].join('\n'));
async function publish(url){
 if(publishing)return;publishing=true;
 try{
  const at=Date.now(),record={protocol_version:4,network:config.network,vault:config.vault,url,published_at_ms:at,expires_at_ms:at+7*86400000};record.signature=Buffer.from(key.sign(message(record)).signature).toString('base64');
  const content=Buffer.from(JSON.stringify(record)),field=s=>{const b=Buffer.from(s),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);},size=Buffer.alloc(4);size.writeUInt32LE(content.length);
  const payload=Buffer.concat([Buffer.from([0]),field('ach-v4-gateway.json'),Buffer.from([1]),field('application/json'),size,content]);
  const result=await durableActions(account,journal,'gateway:'+at,'outlayer.testnet',[actions.functionCall('__fastdata_fastfs',payload,1n,0n)],{recordedFastFS:true});
  writeFileSync(privatePath('gateway-record.json'),JSON.stringify({...record,tx_hash:result.tx_hash}),{mode:0o600});
  console.log(JSON.stringify({gateway:'published',url,discovery_url:config.gateway.discovery_url}));current=url;
 }catch{console.error('ACH_HTTPS_GATEWAY_PUBLICATION_WAITING');setTimeout(()=>publish(url),5000);}finally{publishing=false;}
}
const tunnel=spawn(privatePath('cloudflared'),['tunnel','--no-autoupdate','--url',config.services.coordinator],{stdio:['ignore','pipe','pipe']});
function output(chunk){buffer=(buffer+chunk.toString()).slice(-12000);const found=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(found&&!current&&!publishing)void publish(found[0]);}
tunnel.stdout.on('data',output);tunnel.stderr.on('data',output);tunnel.once('exit',()=>process.exit(1));
setInterval(()=>{if(current)void publish(current);},12*3600000).unref();
process.on('SIGTERM',()=>{tunnel.kill('SIGTERM');process.exit(0);});
