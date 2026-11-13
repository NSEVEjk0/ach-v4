import {readFileSync}from 'node:fs';import path from 'node:path';
import {validateV4Deployment,V4NearTransport,AchV4Client}from '../../packages/client/dist/v4.js';
import {manifestPath}from './paths.mjs';
import {requireServiceLayout}from './workflow.mjs';
import {withSignerRecovery}from './transactions.mjs';
export function loadConfig(){const c=JSON.parse(readFileSync(manifestPath,'utf8'));if(c.status!=='deployed'||!c.verification?.code_hash_verified)throw new Error('VERIFIED_V4_DEPLOYMENT_REQUIRED');requireServiceLayout(c);validateV4Deployment(c);if(!process.env.ACH_V4_SERVICE_TOKEN)throw new Error('V4_SERVICE_CONFIGURATION_REQUIRED');return c;}
export function loadIdentity(filename,config,journal,role='agent'){
 const data=JSON.parse(readFileSync(filename,'utf8'));if(!data.account_id||!data.secret_key||data.role!==role)throw new Error('SCOPED_IDENTITY_REQUIRED');
 const transport=withSignerRecovery(new V4NearTransport(data.account_id,config.rpc_urls??config.rpc_url,data.secret_key,journal),journal);return{account_id:data.account_id,transport,client:new AchV4Client(config,transport,role),data};
}
