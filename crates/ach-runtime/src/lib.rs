//! Small NEAR host-ABI adapter. Entity storage is bounded and transactional.
//! ABI declarations match NEAR's public host API (and installed near-sdk-js
//! builder/builder.c); this is not a replacement for an independent audit.
use serde::{de::DeserializeOwned,Serialize};
use std::collections::BTreeMap;

pub trait Store {fn get(&self,key:&str)->Option<Vec<u8>>;fn put(&mut self,key:&str,value:Vec<u8>);fn remove(&mut self,key:&str);}
#[derive(Clone,Default)]pub struct MemoryStore(pub BTreeMap<String,Vec<u8>>);
impl Store for MemoryStore {fn get(&self,k:&str)->Option<Vec<u8>>{self.0.get(k).cloned()}fn put(&mut self,k:&str,v:Vec<u8>){self.0.insert(k.into(),v);}fn remove(&mut self,k:&str){self.0.remove(k);}}
pub struct Transaction<'a,S:Store>{pub base:&'a mut S,pub writes:BTreeMap<String,Option<Vec<u8>>>}
impl<'a,S:Store> Transaction<'a,S>{
    pub fn new(base:&'a mut S)->Self{Self{base,writes:BTreeMap::new()}}
    pub fn read<T:DeserializeOwned>(&self,key:&str)->Result<Option<T>,String>{self.get(key).map(|v|serde_json::from_slice(&v).map_err(|_|"CORRUPT_STATE".into())).transpose()}
    pub fn write<T:Serialize>(&mut self,key:&str,value:&T)->Result<(),String>{
        let mut bytes=serde_json::to_vec(value).map_err(|_|"STATE_ENCODING".to_string())?;
        let existing=self.get(key).map(|b|b.len()).unwrap_or(0);
        // Reserve room in mutable records before commitment. JSON whitespace is
        // canonical storage padding, ignored by both Rust and public RPC readers.
        let padding=if bytes.first()==Some(&b'{'){512}else if key.starts_with("balance:") || key.starts_with("budget:"){128}else{0};
        let capacity=if bytes.len()<=existing{existing}else{bytes.len()+padding};
        bytes.resize(capacity,b' ');self.put(key,bytes);Ok(())
    }
    /// Reserve an explicit future representation after writing a mutable record.
    /// Generic padding can be consumed by approvals; terminal transitions must
    /// retain their own capacity before funds become irrevocably committed.
    pub fn reserve_for<T:Serialize>(&mut self,key:&str,future:&T)->Result<(),String>{
        let minimum=serde_json::to_vec(future).map_err(|_|"STATE_ENCODING".to_string())?.len();
        let mut bytes=self.get(key).ok_or("STATE_MISSING")?;
        if bytes.len()<minimum{bytes.resize(minimum,b' ');self.put(key,bytes);}
        Ok(())
    }
    pub fn additional_bytes(&self)->u128{self.writes.iter().map(|(k,v)|v.as_ref().map(|new|{let old=self.base.get(k).map(|v|v.len()).unwrap_or(0);(new.len().saturating_sub(old)+if old==0{k.len()+64}else{32}) as u128}).unwrap_or(0)).sum()}
    pub fn storage_growth_bytes(&self)->usize{self.writes.iter().map(|(k,v)|v.as_ref().map(|new|{let old=self.base.get(k);new.len().saturating_sub(old.as_ref().map(Vec::len).unwrap_or(0))+if old.is_none(){k.len()+64}else{0}}).unwrap_or(0)).sum()}
    pub fn commit(self){for(k,v)in self.writes{if let Some(v)=v{self.base.put(&k,v)}else{self.base.remove(&k)}}}
}
impl<S:Store> Store for Transaction<'_,S>{fn get(&self,k:&str)->Option<Vec<u8>>{self.writes.get(k).cloned().unwrap_or_else(||self.base.get(k))}fn put(&mut self,k:&str,v:Vec<u8>){self.writes.insert(k.into(),Some(v));}fn remove(&mut self,k:&str){self.writes.insert(k.into(),None);}}
#[derive(Clone,Debug,Default)]pub struct Context {
    pub current:String,pub predecessor:String,pub signer:String,pub signer_key:String,
    pub attached:u128,pub now_ms:u64,pub native_free:u128,pub promise_results:Vec<Option<Vec<u8>>>,
}
#[derive(Clone,Debug,serde::Serialize,serde::Deserialize)]pub struct Call {pub receiver:String,pub method:String,pub args:serde_json::Value,pub deposit:String,pub gas:u64,pub callback:Option<Box<Call>>}

#[cfg(target_arch="wasm32")]
pub mod near {
    use super::*;
    #[link(wasm_import_module="env")]
    extern "C" {
        fn read_register(id:u64,ptr:u64);fn register_len(id:u64)->u64;
        fn input(id:u64);fn current_account_id(id:u64);fn predecessor_account_id(id:u64);fn signer_account_id(id:u64);fn signer_account_pk(id:u64);
        fn attached_deposit(ptr:u64);fn account_balance(ptr:u64);fn storage_usage()->u64;fn block_timestamp()->u64;
        fn storage_read(len:u64,ptr:u64,id:u64)->u64;fn storage_write(kl:u64,kp:u64,vl:u64,vp:u64,id:u64)->u64;fn storage_remove(kl:u64,kp:u64,id:u64)->u64;
        fn value_return(len:u64,ptr:u64);fn panic_utf8(len:u64,ptr:u64)->!;fn log_utf8(len:u64,ptr:u64);
        fn promise_results_count()->u64;fn promise_result(index:u64,id:u64)->u64;
        fn promise_create(al:u64,ap:u64,ml:u64,mp:u64,dl:u64,dp:u64,amount:u64,gas:u64)->u64;
        fn promise_then(index:u64,al:u64,ap:u64,ml:u64,mp:u64,dl:u64,dp:u64,amount:u64,gas:u64)->u64;
        fn promise_return(index:u64);
        fn ed25519_verify(sl:u64,sp:u64,ml:u64,mp:u64,kl:u64,kp:u64)->u64;
    }
    fn register(id:u64)->Vec<u8>{unsafe {let n=register_len(id);if n==u64::MAX{return vec![];}let mut v=vec![0u8;n as usize];read_register(id,v.as_mut_ptr() as u64);v}}
    pub fn read_input()->Vec<u8>{unsafe{input(0)};register(0)}
    pub fn read_input_bounded(limit:usize)->Vec<u8>{
        unsafe{input(0);let size=register_len(0);if size!=u64::MAX && size>limit as u64{fail("INPUT_TOO_LARGE");}}
        register(0)
    }
    pub fn view_context()->Context {unsafe{
        current_account_id(0);let current=String::from_utf8(register(0)).unwrap();
        let mut amount=[0u8;16];account_balance(amount.as_mut_ptr() as u64);
        let native_free=u128::from_le_bytes(amount).saturating_sub(storage_usage() as u128*10u128.pow(19));
        Context{current,now_ms:block_timestamp()/1_000_000,native_free,..Default::default()}
    }}
    pub fn context()->Context {unsafe{
        current_account_id(0);let current=String::from_utf8(register(0)).unwrap();
        predecessor_account_id(0);let predecessor=String::from_utf8(register(0)).unwrap();
        signer_account_id(0);let signer=String::from_utf8(register(0)).unwrap();
        signer_account_pk(0);let pk=register(0);let signer_key=if pk.len()==33 && pk[0]==0{hex::encode(&pk[1..])}else{String::new()};
        let mut amount=[0u8;16];attached_deposit(amount.as_mut_ptr() as u64);let attached=u128::from_le_bytes(amount);
        account_balance(amount.as_mut_ptr() as u64);let native_free=u128::from_le_bytes(amount).saturating_sub(storage_usage() as u128*10u128.pow(19));
        let promise_results=(0..promise_results_count()).map(|i|if promise_result(i,0)==1{Some(register(0))}else{None}).collect();
        Context{current,predecessor,signer,signer_key,attached,now_ms:block_timestamp()/1_000_000,native_free,promise_results}
    }}
    pub struct Storage;
    impl Store for Storage {
        fn get(&self,k:&str)->Option<Vec<u8>>{unsafe{if storage_read(k.len() as u64,k.as_ptr() as u64,0)==1{Some(register(0))}else{None}}}
        fn put(&mut self,k:&str,v:Vec<u8>){unsafe{storage_write(k.len() as u64,k.as_ptr() as u64,v.len() as u64,v.as_ptr() as u64,0);}}
        fn remove(&mut self,k:&str){unsafe{storage_remove(k.len() as u64,k.as_ptr() as u64,0);}}
    }
    pub fn finish(value:&serde_json::Value){let bytes=serde_json::to_vec(value).unwrap();unsafe{value_return(bytes.len() as u64,bytes.as_ptr() as u64)}}
    pub fn fail(code:&str)->!{unsafe{panic_utf8(code.len() as u64,code.as_ptr() as u64)}}
    pub fn log(value:&serde_json::Value){let bytes=serde_json::to_vec(value).unwrap();unsafe{log_utf8(bytes.len() as u64,bytes.as_ptr() as u64)}}
    pub fn verify(signature:&[u8],message:&[u8],key:&[u8])->bool{unsafe{ed25519_verify(signature.len() as u64,signature.as_ptr() as u64,message.len() as u64,message.as_ptr() as u64,key.len() as u64,key.as_ptr() as u64)==1}}
    fn args(c:&Call)->Vec<u8>{serde_json::to_vec(&c.args).unwrap()}
    pub fn schedule(c:&Call,return_promise:bool){unsafe{
        let a=args(c);let amount=c.deposit.parse::<u128>().unwrap().to_le_bytes();
        let mut index=promise_create(c.receiver.len() as u64,c.receiver.as_ptr() as u64,c.method.len() as u64,c.method.as_ptr() as u64,a.len() as u64,a.as_ptr() as u64,amount.as_ptr() as u64,c.gas);
        if let Some(cb)=&c.callback{let a=args(cb);let amount=cb.deposit.parse::<u128>().unwrap().to_le_bytes();index=promise_then(index,cb.receiver.len() as u64,cb.receiver.as_ptr() as u64,cb.method.len() as u64,cb.method.as_ptr() as u64,a.len() as u64,a.as_ptr() as u64,amount.as_ptr() as u64,cb.gas);}
        if return_promise{promise_return(index);}
    }}
}
