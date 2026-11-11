//! Testnet-only, six-decimal NEP-141 demonstration token. No monetary value.
use ach_protocol::{add,sub,ensure,valid_account,Amount,Result};
use ach_runtime::{Store,Transaction,Context,Call};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
const TGAS:u64=1_000_000_000_000;
#[derive(Serialize,Deserialize)]struct Config{owner_id:String,total_supply:Amount,transfers:u64}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Init{owner_id:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct AccountArgs{account_id:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Mint{account_id:String,amount:Amount}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Transfer{receiver_id:String,amount:Amount,memo:Option<String>,msg:Option<String>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Resolve{sender_id:String,receiver_id:String,amount:Amount,transfer_id:u64}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct StorageDeposit{account_id:Option<String>,registration_only:Option<bool>}
fn args<T:serde::de::DeserializeOwned>(v:Value)->Result<T>{serde_json::from_value(v).map_err(|_|"INVALID_ARGUMENTS".into())}
fn k(id:&str)->String{format!("balance:{id}")}
pub struct Execution{pub value:Value,pub calls:Vec<Call>,pub return_promise:bool}
pub fn execute<S:Store>(store:&mut S,ctx:&Context,method:&str,input:Value)->Result<Execution>{
    let mut s=Transaction::new(store);let mut calls=vec![];let mut return_promise=false;
    if method=="init"{let a:Init=args(input)?;ensure(ctx.current.ends_with(".testnet") && ctx.predecessor==ctx.current && ctx.signer==ctx.current,"TESTNET_SELF_INITIALIZATION_ONLY")?;ensure(s.get("config").is_none(),"ALREADY_INITIALIZED")?;valid_account(&a.owner_id)?;s.write("config",&Config{owner_id:a.owner_id,total_supply:Amount(0),transfers:0})?;s.commit();return Ok(Execution{value:json!(true),calls,return_promise})}
    let mut c:Config=s.read("config")?.ok_or("NOT_INITIALIZED")?;
    let output=match method{
        "ft_metadata"=>json!({"spec":"ft-1.0.0","name":"ACH Test USD — no monetary value","symbol":"tUSDC","decimals":6,"icon":null,"reference":null,"reference_hash":null}),
        "ft_total_supply"=>json!(c.total_supply),
        "ft_balance_of"=>{let a:AccountArgs=args(input)?;json!(s.read::<Amount>(&k(&a.account_id))?.unwrap_or_default())},
        "storage_balance_bounds"=>json!({"min":"0","max":"0"}),
        "storage_balance_of"=>{let a:AccountArgs=args(input)?;if s.get(&k(&a.account_id)).is_some(){json!({"total":"0","available":"0"})}else{Value::Null}},
        "storage_deposit"=>{
            let a:StorageDeposit=args(input)?;let _=a.registration_only;ensure(ctx.attached==0,"REGISTRATION_IS_SPONSORED_NO_DEPOSIT_REQUIRED")?;let id=a.account_id.unwrap_or(ctx.predecessor.clone());valid_account(&id)?;
            if s.get(&k(&id)).is_none(){s.write(&k(&id),&Amount(0))?;}json!({"total":"0","available":"0"})
        },
        "mint"=>{let a:Mint=args(input)?;ensure(ctx.predecessor==c.owner_id && ctx.signer==c.owner_id && ctx.attached==1,"TOKEN_OWNER_ONLY")?;valid_account(&a.account_id)?;ensure(a.amount.0>0,"INVALID_AMOUNT")?;let balance=s.read::<Amount>(&k(&a.account_id))?.unwrap_or_default();s.write(&k(&a.account_id),&Amount(add(balance.0,a.amount.0)?))?;c.total_supply=Amount(add(c.total_supply.0,a.amount.0)?);json!(a.amount)},
        "ft_transfer"|"ft_transfer_call"=>{
            let a:Transfer=args(input)?;ensure(ctx.attached==1,"ONE_YOCTO_REQUIRED")?;valid_account(&a.receiver_id)?;ensure(a.receiver_id!=ctx.predecessor && a.amount.0>0 && a.memo.as_ref().is_none_or(|m|m.len()<=256),"INVALID_TRANSFER")?;
            let from=s.read::<Amount>(&k(&ctx.predecessor))?.ok_or("SENDER_NOT_REGISTERED")?;let to=s.read::<Amount>(&k(&a.receiver_id))?.ok_or("RECEIVER_NOT_REGISTERED")?;
            s.write(&k(&ctx.predecessor),&Amount(sub(from.0,a.amount.0)?))?;s.write(&k(&a.receiver_id),&Amount(add(to.0,a.amount.0)?))?;
            if method=="ft_transfer_call"{
                let msg=a.msg.ok_or("MESSAGE_REQUIRED")?;ensure(msg.len()<=4096,"MESSAGE_TOO_LARGE")?;let id=c.transfers;c.transfers+=1;s.write(&format!("pending:{id}"),&true)?;
                let cb=Call{receiver:ctx.current.clone(),method:"ft_resolve_transfer".into(),args:json!({"sender_id":ctx.predecessor,"receiver_id":a.receiver_id,"amount":a.amount,"transfer_id":id}),deposit:"0".into(),gas:20*TGAS,callback:None};
                calls.push(Call{receiver:a.receiver_id,method:"ft_on_transfer".into(),args:json!({"sender_id":ctx.predecessor,"amount":a.amount,"msg":msg}),deposit:"0".into(),gas:65*TGAS,callback:Some(Box::new(cb))});return_promise=true;
            }Value::Null
        },
        "ft_resolve_transfer"=>{
            let a:Resolve=args(input)?;ensure(ctx.predecessor==ctx.current && ctx.promise_results.len()==1,"PRIVATE_CALLBACK_ONLY")?;
            // The callback ID makes repeated/malicious callback attempts inert.
            let pending=s.read::<bool>(&format!("pending:{}",a.transfer_id))?.ok_or("TRANSFER_NOT_FOUND")?;
            if !pending{return Ok(Execution{value:json!("0"),calls,return_promise})}
            let mut unused=ctx.promise_results[0].as_ref().and_then(|r|serde_json::from_slice::<Amount>(r).ok()).map(|v|v.0).unwrap_or(a.amount.0).min(a.amount.0);
            let receiver=s.read::<Amount>(&k(&a.receiver_id))?.unwrap_or_default();unused=unused.min(receiver.0);
            let sender=s.read::<Amount>(&k(&a.sender_id))?.ok_or("SENDER_NOT_REGISTERED")?;
            s.write(&k(&a.receiver_id),&Amount(sub(receiver.0,unused)?))?;s.write(&k(&a.sender_id),&Amount(add(sender.0,unused)?))?;s.write(&format!("pending:{}",a.transfer_id),&false)?;json!(Amount(a.amount.0-unused))
        },
        _=>return Err("METHOD_NOT_FOUND".into()),
    };
    if !s.writes.is_empty(){s.write("config",&c)?;if method!="ft_resolve_transfer"{ensure(ctx.native_free>=100_000_000_000_000_000_000_000+s.additional_bytes()*10u128.pow(19),"SPONSOR_STORAGE_HEADROOM_REQUIRED")?;}}
    s.commit();Ok(Execution{value:output,calls,return_promise})
}
#[cfg(target_arch="wasm32")]
fn entry(method:&str){use ach_runtime::near;let input=near::read_input();if input.len()>16384{near::fail("INPUT_TOO_LARGE")};let v=serde_json::from_slice(&input).unwrap_or_else(|_|near::fail("INVALID_JSON"));let ctx=if matches!(method,"ft_metadata"|"ft_total_supply"|"ft_balance_of"|"storage_balance_bounds"|"storage_balance_of"){near::view_context()}else{near::context()};let mut s=near::Storage;match execute(&mut s,&ctx,method,v){Ok(r)=>{for c in &r.calls{near::schedule(c,r.return_promise);}if !r.return_promise{near::finish(&r.value)}},Err(code)=>near::fail(&code)}}
#[cfg(target_arch="wasm32")]
macro_rules! export{($($n:ident),+)=>{$(#[no_mangle]pub extern "C" fn $n(){entry(stringify!($n));})+}}
#[cfg(target_arch="wasm32")]
export!(init,ft_metadata,ft_total_supply,ft_balance_of,storage_balance_bounds,storage_balance_of,storage_deposit,mint,ft_transfer,ft_transfer_call,ft_resolve_transfer);

#[cfg(test)]mod tests{use super::*;use ach_runtime::MemoryStore;
 #[test]fn receiver_failure_restores_transfer_once(){let mut s=MemoryStore::default();let mut ctx=Context{current:"usd.testnet".into(),predecessor:"usd.testnet".into(),signer:"usd.testnet".into(),native_free:10u128.pow(25),..Default::default()};execute(&mut s,&ctx,"init",json!({"owner_id":"sponsor.testnet"})).unwrap();ctx.predecessor="sponsor.testnet".into();ctx.signer=ctx.predecessor.clone();ctx.attached=1;execute(&mut s,&ctx,"mint",json!({"account_id":"alice.testnet","amount":"100"})).unwrap();ctx.attached=0;execute(&mut s,&ctx,"storage_deposit",json!({"account_id":"vault.testnet"})).unwrap();ctx.predecessor="alice.testnet".into();ctx.signer=ctx.predecessor.clone();ctx.attached=1;execute(&mut s,&ctx,"ft_transfer_call",json!({"receiver_id":"vault.testnet","amount":"100","msg":"deposit"})).unwrap();ctx.predecessor=ctx.current.clone();ctx.attached=0;ctx.promise_results=vec![None];let a=json!({"sender_id":"alice.testnet","receiver_id":"vault.testnet","amount":"100","transfer_id":0});assert_eq!(execute(&mut s,&ctx,"ft_resolve_transfer",a.clone()).unwrap().value,json!("0"));execute(&mut s,&ctx,"ft_resolve_transfer",a).unwrap();assert_eq!(execute(&mut s,&ctx,"ft_balance_of",json!({"account_id":"alice.testnet"})).unwrap().value,json!("100"));}
}
