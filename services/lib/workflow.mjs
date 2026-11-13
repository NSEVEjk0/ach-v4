export const WORKFLOW_REVISION=2;
export function requireCurrentWorkflow(config){
 if(config.workflow_revision!==WORKFLOW_REVISION)throw new Error('FRESH_WORKFLOW_REVISION_2_REQUIRED');
 return config;
}
export function requireFreshAccounts(plan){
 requireCurrentWorkflow(plan);
 const suffix=plan.root?.match(/^ach-v4r2-demo-([a-f\d]{8})\.testnet$/)?.[1];
 if(plan.network!=='testnet'||!suffix||plan.vault!==`ach-vault-v4r2-${suffix}.testnet`||plan.token!==`ach-usdc-v4r2-${suffix}.testnet`)throw new Error('FRESH_ACH_TESTNET_ACCOUNTS_REQUIRED');
 return plan;
}
export function serviceLayout(plan){
 requireFreshAccounts(plan);
 const suffix=plan.root.match(/^ach-v4r2-demo-([a-f\d]{8})\.testnet$/)[1];
 // A separate block avoids the historical deployment's fixed ports. Port
 // collisions between candidate namespaces still fail the startup preflight.
 const base=30000+(Number.parseInt(suffix,16)%4000)*5;
 const ports=Object.fromEntries(['coordinator','demo','research','visual','audit'].map((role,index)=>[role,base+index]));
 return{unit:`ach-v4r2-${suffix}.service`,ports,services:Object.fromEntries(Object.entries(ports).map(([role,port])=>[role,`http://127.0.0.1:${port}`]))};
}
export function requireServiceLayout(config){
 const expected=serviceLayout(config),actual=config.service_layout;
 if(!actual||actual.unit!==expected.unit||Object.keys(actual.ports??{}).length!==5||Object.keys(config.services??{}).length!==5||Object.entries(expected.ports).some(([role,port])=>actual.ports[role]!==port||config.services[role]!==expected.services[role])||config.coordinator_id!==`desk.${config.root}`)throw new Error('ISOLATED_SERVICE_NAMESPACE_REQUIRED');
 return expected;
}
export function requireIdentityAccount(config,role,identity){
 requireFreshAccounts(config);
 const expected={root:config.root,vault:config.vault,token:config.token,coordinator:`desk.${config.root}`,publisher:`gate.${config.root}`}[role];
 if(!expected||identity?.account_id!==expected)throw new Error('IDENTITY_ACCOUNT_NAMESPACE_MISMATCH');
 return identity;
}
export function sessionAccountId(config,sessionId,kind){
 requireFreshAccounts(config);
 if(typeof sessionId!=='string'||!/^[a-f\d]{32}$/.test(sessionId)||!isSessionAgentKind(kind))throw new Error('SESSION_IDENTITY_SCOPE_REQUIRED');
 const prefix=kind.startsWith('test-')?'t'+kind.slice(5):kind[0];
 return`${prefix}-${sessionId.slice(0,12)}.${config.root}`;
}
export const isSessionAgentKind=kind=>['research','visual','audit'].includes(kind)||typeof kind==='string'&&/^test-(?:[4-9]|1[0-2])$/.test(kind);
export function sessionAgentKinds(count=3){
 if(!Number.isInteger(count)||count<3||count>12)throw new Error('TEST_AGENT_COUNT_LIMIT');
 return['research','visual','audit',...Array.from({length:count-3},(_,index)=>'test-'+(index+4))];
}

// Include initial contract state and transaction gas above the code footprint.
// The byte price comes from the current chain protocol configuration.
export function deploymentStorageShortfall(account,codeBytes,storagePrice){
 if(!Number.isSafeInteger(codeBytes)||codeBytes<1||!Number.isSafeInteger(account.storage_usage)||account.storage_usage<0||!/^[1-9]\d*$/.test(String(storagePrice))||!/^\d+$/.test(String(account.amount)))throw new Error('DEPLOYMENT_STORAGE_DATA_REQUIRED');
 const required=(BigInt(account.storage_usage)+BigInt(codeBytes)+10000n)*BigInt(storagePrice)+100_000_000_000_000_000_000_000n;
 return required>BigInt(account.amount)?required-BigInt(account.amount):0n;
}
export function storageFundedDeploymentId(operation,status,accountId){
 const failure=status?.status?.Failure?.ActionError?.kind?.LackBalanceForState;
 if(operation?.state!=='FAILED'||!operation.id?.startsWith('deploy:')||typeof operation.tx_hash!=='string'||status?.final_execution_status!=='FINAL'||failure?.account_id!==accountId||!/^[1-9]\d*$/.test(String(failure?.amount)))throw new Error('FINAL_DEPLOYMENT_STORAGE_FAILURE_REQUIRED');
 return operation.id+':storage-funded';
}
