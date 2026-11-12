import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync}from 'node:fs';
import {parseEnv}from 'node:util';

export const repoRoot=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const argument=name=>{const index=process.argv.indexOf(name);if(index<0)return;const value=process.argv[index+1];if(!value||value.startsWith('--'))throw new Error('EXPLICIT_STATE_PATH_REQUIRED');return value;};
const legacyRoot=path.join(repoRoot,'.local/v4');
const rootArgument=argument('--private-root');
export const privateRoot=path.resolve(repoRoot,rootArgument??process.env.ACH_V4_PRIVATE_ROOT??legacyRoot);
const defaultManifest=privateRoot===legacyRoot?'docs/v4/deployment.json':path.join(privateRoot,'deployment.json');
export const manifestPath=path.resolve(repoRoot,argument('--manifest')??(rootArgument?defaultManifest:process.env.ACH_V4_MANIFEST??defaultManifest));
export const outlayerPath=path.join(path.dirname(manifestPath),'outlayer.json');
export const privatePath=(...parts)=>path.join(privateRoot,...parts);
export function loadPrivateEnvironment(){
 const env=parseEnv(readFileSync(privatePath('services.env'),'utf8'));
 for(const[name,expected]of [['ACH_V4_PRIVATE_ROOT',privateRoot],['ACH_V4_MANIFEST',manifestPath]])if(Object.hasOwn(env,name)&&(!env[name]||path.resolve(repoRoot,env[name])!==expected))throw new Error('SERVICE_ENVIRONMENT_NAMESPACE_MISMATCH');
 for(const[name,value]of Object.entries(env))if((name.startsWith('ACH_')||name==='NEAR_AI_API_KEY')&&!['ACH_V4_PRIVATE_ROOT','ACH_V4_MANIFEST'].includes(name))process.env[name]=value;
 process.env.ACH_V4_PRIVATE_ROOT=privateRoot;process.env.ACH_V4_MANIFEST=manifestPath;
}
// Child processes inherit the same candidate namespace. Existing keys, stores
// and live manifests are never copied into a new deployment.
process.env.ACH_V4_PRIVATE_ROOT=privateRoot;
process.env.ACH_V4_MANIFEST=manifestPath;
