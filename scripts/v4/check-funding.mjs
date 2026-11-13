// Read-only operator check. Native test NEAR pays fees/storage/OutLayer;
// ledger tUSDC is a separate, nonmonetary settlement token.
import {readFileSync} from 'node:fs';
import {V4RpcProvider} from '../../packages/client/dist/v4.js';
import {requireFreshAccounts} from '../../services/lib/workflow.mjs';

const yocto=10n**24n;
const units=value=>{const text=String(value);if(!/^(0|[1-9]\d*)$/.test(text))throw new Error('INVALID_NATIVE_FUNDING_DATA');return BigInt(text);};
const near=value=>{const sign=value<0n?'-':'',absolute=value<0n?-value:value;return sign+String(absolute/yocto)+'.'+String(absolute%yocto).padStart(24,'0').slice(0,6);};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";

try{
 if(!process.argv.includes('--private-root')&&!process.env.ACH_V4_PRIVATE_ROOT)throw new Error('EXPLICIT_STATE_PATH_REQUIRED');
 const {privateRoot,manifestPath}=await import('../../services/lib/paths.mjs');
 const config=JSON.parse(readFileSync(manifestPath,'utf8'));
 requireFreshAccounts(config);
 if(config.protocol_version!==4||config.status!=='deployed'||config.token_has_monetary_value!==false||config.coordinator_id!==`desk.${config.root}`)throw new Error('DEPLOYED_NONMONETARY_TESTNET_REQUIRED');
 const provider=new V4RpcProvider(config.rpc_urls??config.rpc_url);
 const protocol=await provider.sendJsonRpc('EXPERIMENTAL_protocol_config',{finality:'final'});
 const storagePrice=units(protocol.runtime_config?.storage_amount_per_byte);if(storagePrice===0n)throw new Error('INVALID_NATIVE_FUNDING_DATA');
 const limits=config.sponsor_limits;
 if(!limits)throw new Error('SPONSOR_CONFIGURATION_REQUIRED');
 const cap=units(limits.maxNative),workspaceReservation=units(limits.perSessionNative);
 const definitions=[['root',config.root,20n],['coordinator',config.coordinator_id,1n],['vault',config.vault,2n]];
 const results=await Promise.allSettled(definitions.map(async([role,account_id,threshold])=>{
  const account=await provider.viewAccount({accountId:account_id,blockQuery:{finality:'final'}});
  const amount=units(account.amount),storage=units(account.storage_usage)*storagePrice,available=amount-storage;
  return{role,account_id,native_balance_yocto:amount.toString(),storage_backing_yocto:storage.toString(),available_native_yocto:available.toString(),available_native_near:near(available),recommended_minimum_near:threshold.toString(),low:available<threshold*yocto};
 }));
 const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 const accounts=results.map(result=>result.value),warnings=[];
 const refill=flag=>`node scripts/create-testnet.mjs ${flag} --private-root ${shellQuote(privateRoot)} --manifest ${shellQuote(manifestPath)}`;
 for(const account of accounts.filter(account=>account.low))warnings.push({account_id:account.account_id,message:`Available native test NEAR is below ${account.recommended_minimum_near} NEAR for ${account.role}.`,...(account.role==='root'?{recommended_command:refill('--refill-sponsor')}:account.role==='vault'?{recommended_command:refill('--refill-vault-storage')}:{recommendation:'Request free testnet NEAR for this coordinator account at https://near-faucet.io.'})});
 console.log(JSON.stringify({funding_check:'complete',network:'testnet',read_only:true,checked_at:new Date().toISOString(),manifest:manifestPath,native_purpose:'Test NEAR pays transaction fees, sponsored wallet storage and OutLayer computation.',storage_price_yocto_per_byte:storagePrice.toString(),accounts,sponsorship:{daily_native_reservation_cap_near:near(cap),base_workspace_native_reservation_near:near(workspaceReservation)},ledger_token:{account_id:config.token,symbol:'tUSDC',has_monetary_value:false,purpose:'Agent balances and net settlement; separate from native operating funds.'},warnings},null,2));
}catch(error){console.error(JSON.stringify({funding_check:'failed',error:/^[A-Z_\d]+$/.test(error?.message??'')?error.message:'FUNDING_CHECK_UNAVAILABLE'}));process.exitCode=1;}
