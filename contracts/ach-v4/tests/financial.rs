use ach_protocol::{Amount,InvoiceSpec};
use ach_runtime::{Context,MemoryStore};
use ach_vault::{execute,Execution,Round,Invoice,Wallet,Config};
use serde_json::{json,Value};
use std::collections::{BTreeMap,BTreeSet};

const A:&str="aa.testnet";const B:&str="bb.testnet";const C:&str="cc.testnet";const D:&str="dd.testnet";const CO:&str="coord.testnet";const VAULT:&str="vault.testnet";const TOKEN:&str="usd.testnet";
struct Harness{store:MemoryStore,ctx:Context,nonce:u64}
impl Harness{
 fn new()->Self{let mut h=Self{store:MemoryStore::default(),ctx:Context{current:VAULT.into(),predecessor:VAULT.into(),signer:VAULT.into(),signer_key:"a".repeat(64),now_ms:1000,native_free:10u128.pow(26),..Default::default()},nonce:0};h.call("init",json!({"network":"testnet","token":TOKEN,"owner_id":CO,"coordinator_id":CO,"private_worker":null})).unwrap();for id in [A,B,C,D,CO]{h.as_owner(id);h.call("register_account",json!({"name":id})).unwrap();h.policy(id,1_000_000_000,10_000_000_000,1_000_000_000);}h}
 fn policy(&mut self,id:&str,max:u128,gross:u128,net:u128){self.as_owner(id);self.call("set_agent_policy",json!({"key":"a".repeat(64),"max_invoice":max.to_string(),"gross_budget":gross.to_string(),"max_net_commitment":net.to_string(),"expires_at_ms":1_000_000,"counterparties":[],"services":[]})).unwrap();}
 fn as_agent(&mut self,id:&str){self.ctx.predecessor=id.into();self.ctx.signer=id.into();self.ctx.signer_key="a".repeat(64);self.ctx.attached=0;self.ctx.promise_results.clear();}
 fn as_owner(&mut self,id:&str){self.as_agent(id);self.ctx.attached=1;}
 fn call(&mut self,m:&str,a:Value)->Result<Execution,String>{execute(&mut self.store,&self.ctx,m,a)}
 fn view(&mut self,m:&str,a:Value)->Value{self.call(m,a).unwrap().value}
 fn deposit(&mut self,id:&str,n:u128){self.as_agent(id);self.ctx.predecessor=TOKEN.into();self.call("ft_on_transfer",json!({"sender_id":id,"amount":n.to_string(),"msg":"deposit"})).unwrap();}
 fn balance(&mut self,id:&str)->Value{self.view("get_balance",json!({"account_id":id}))}
 fn spec(&mut self,b:&str,s:&str,n:u128)->InvoiceSpec{self.nonce+=1;InvoiceSpec{id:format!("bill-{}",self.nonce),purchase_id:format!("purchase-{}",self.nonce),terms_version:1,buyer:b.into(),seller:s.into(),asset:TOKEN.into(),amount:Amount(n),service:"research".into(),terms_hash:"b".repeat(64),artifact_hash:"c".repeat(64),ready_at_ms:self.ctx.now_ms,expires_at_ms:self.ctx.now_ms+100_000}}
 fn invoice(&mut self,b:&str,s:&str,n:u128)->Invoice{let spec=self.spec(b,s,n);self.as_agent(s);let v=self.call("propose_invoice",json!({"spec":spec})).unwrap().value;let i:Invoice=serde_json::from_value(v).unwrap();for id in [b,s]{self.as_agent(id);self.call("accept_invoice",json!({"id":i.spec.id,"expected_hash":i.hash})).unwrap();}serde_json::from_value(self.view("get_invoice",json!({"id":i.spec.id}))).unwrap()}
 fn round(&mut self,id:&str,inv:&[&Invoice])->Round{self.as_agent(CO);serde_json::from_value(self.call("propose_round",json!({"id":id,"invoice_ids":inv.iter().map(|i|i.spec.id.clone()).collect::<Vec<_>>(),"deadline_ms":self.ctx.now_ms+10_000})).unwrap().value).unwrap()}
 fn approve(&mut self,r:&Round,id:&str)->Result<Execution,String>{self.as_agent(id);let net=&r.input.positions.iter().find(|p|p.account_id==id).unwrap().net;self.call("authorize_round",json!({"id":r.input.id,"expected_hash":r.hash,"expected_net":net}))}
 fn ready(&mut self,r:&Round){for p in &r.input.positions{self.approve(r,&p.account_id).unwrap();}assert_eq!(self.view("get_round",json!({"id":r.input.id}))["status"],"READY");}
 fn settle(&mut self,r:&Round)->Result<Execution,String>{self.as_agent("anyone.testnet");self.call("settle_round",json!({"id":r.input.id,"expected_hash":r.hash}))}
 fn assert_backing(&mut self){let b=self.view("get_backing_status",json!({}));assert_eq!(b["claims_equal_tracked_custody"],true);let mut total=0u128;let mut pending=0u128;for(vk,v)in &self.store.0{if vk.starts_with("account:"){let w:Wallet=serde_json::from_slice(v).unwrap();assert!(w.reserved.0<=w.balance.0);total+=w.balance.0;pending+=w.pending_withdrawals.0;}}assert_eq!(total.to_string(),b["total_balances"]);assert_eq!(pending.to_string(),b["pending_withdrawals"]);}
}
#[test]fn net_funding_is_atomic_and_ready_is_irrevocable(){let mut h=Harness::new();let ab=h.invoice(A,B,100_000);let bc=h.invoice(B,C,100_000);let ca=h.invoice(C,A,80_000);assert_eq!(h.balance(A)["reserved"],"0");h.deposit(A,20_000);let r=h.round("net-funded",&[&ab,&bc,&ca]);assert_eq!(r.net_settlement_volume.0,20_000);h.ready(&r);assert_eq!(h.balance(A)["available"],"0");h.as_owner(A);assert_eq!(h.call("request_withdrawal",json!({"id":"steal","amount":"1","receiver_id":A})).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");assert_eq!(h.call("cancel_round_authorization",json!({"id":r.input.id,"expected_hash":r.hash})).err().unwrap(),"ROUND_IS_IRREVOCABLE");h.ctx.now_ms+=50_000;assert!(h.call("expire_round",json!({"id":r.input.id})).is_err());h.settle(&r).unwrap();h.settle(&r).unwrap();assert_eq!(h.balance(A)["balance"],"0");assert_eq!(h.balance(B)["balance"],"0");assert_eq!(h.balance(C)["balance"],"20000");for i in [&ab,&bc,&ca]{assert_eq!(h.view("get_invoice",json!({"id":i.spec.id}))["status"],"SETTLED");}h.assert_backing();}
#[test]fn balanced_cycle_creates_no_spendable_money(){let mut h=Harness::new();let a=h.invoice(A,B,100);let b=h.invoice(B,C,100);let c=h.invoice(C,A,100);let r=h.round("balanced",&[&a,&b,&c]);h.ready(&r);h.settle(&r).unwrap();for id in [A,B,C]{assert_eq!(h.balance(id)["balance"],"0");h.as_owner(id);assert!(h.call("request_withdrawal",json!({"id":format!("withdraw-{id}"),"amount":"1","receiver_id":id})).is_err());}h.assert_backing();}
#[test]fn subgroup_requires_new_funding_and_exact_credit(){let mut h=Harness::new();let ab=h.invoice(A,B,100);let bc=h.invoice(B,C,80);let ca=h.invoice(C,A,60);h.deposit(A,40);let full=h.round("full",&[&ab,&bc,&ca]);assert_eq!(full.net_settlement_volume.0,40);let sub=h.round("subset",&[&ab]);assert_eq!(sub.net_settlement_volume.0,100);h.as_agent(A);assert_eq!(h.call("authorize_round",json!({"id":sub.input.id,"expected_hash":full.hash,"expected_net":"-40"})).err().unwrap(),"ROUND_HASH_MISMATCH");assert_eq!(h.approve(&sub,A).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");h.as_agent(B);assert_eq!(h.call("authorize_round",json!({"id":sub.input.id,"expected_hash":sub.hash,"expected_net":"20"})).err().unwrap(),"EXACT_NET_AUTHORIZATION_REQUIRED");h.deposit(A,60);h.ready(&sub);h.settle(&sub).unwrap();assert_eq!(h.view("get_invoice",json!({"id":bc.spec.id}))["status"],"ACCEPTED");assert_eq!(h.view("get_invoice",json!({"id":ca.spec.id}))["status"],"ACCEPTED");h.assert_backing();}
#[test]fn overlapping_rounds_release_only_their_own_reservations(){let mut h=Harness::new();h.deposit(A,300);let ab=h.invoice(A,B,100);let ad=h.invoice(A,D,70);let winner=h.round("winner",&[&ab]);let loser=h.round("loser",&[&ab]);let independent=h.round("independent",&[&ad]);for r in [&winner,&loser,&independent]{h.approve(r,A).unwrap();}assert_eq!(h.balance(A)["reserved"],"270");h.approve(&winner,B).unwrap();h.settle(&winner).unwrap();assert_eq!(h.balance(A)["reserved"],"170");h.call("release_stale_round",json!({"id":loser.input.id})).unwrap();assert_eq!(h.balance(A)["reserved"],"70");h.approve(&independent,D).unwrap();h.settle(&independent).unwrap();assert_eq!(h.balance(A)["balance"],"130");h.assert_backing();}
#[test]fn same_cash_cannot_authorize_twice(){let mut h=Harness::new();h.deposit(A,100);let a=h.invoice(A,B,80);let b=h.invoice(A,C,80);let r1=h.round("one",&[&a]);let r2=h.round("two",&[&b]);h.approve(&r1,A).unwrap();assert_eq!(h.approve(&r2,A).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");h.as_owner(A);h.call("request_withdrawal",json!({"id":"available","amount":"20","receiver_id":A})).unwrap();assert_eq!(h.balance(A)["available"],"0");h.assert_backing();}
#[test]fn payout_failure_restores_once_with_other_reservations_intact(){let mut h=Harness::new();h.deposit(A,150);let i=h.invoice(A,B,100);let r=h.round("r",&[&i]);h.approve(&r,A).unwrap();h.as_owner(A);let out=h.call("request_withdrawal",json!({"id":"payout","amount":"50","receiver_id":A})).unwrap();assert_eq!(out.calls.len(),1);assert_eq!(out.calls[0].receiver,TOKEN);assert_eq!(h.balance(A)["balance"],"100");assert_eq!(h.balance(A)["pending_withdrawals"],"50");h.as_agent(B);assert_eq!(h.call("withdrawal_callback",json!({"id":"payout"})).err().unwrap(),"PRIVATE_CALLBACK_ONLY");h.ctx.predecessor=VAULT.into();h.ctx.promise_results=vec![None];h.call("withdrawal_callback",json!({"id":"payout"})).unwrap();h.call("withdrawal_callback",json!({"id":"payout"})).unwrap();assert_eq!(h.balance(A)["available"],"50");assert_eq!(h.balance(A)["reserved"],"100");assert_eq!(h.balance(A)["pending_withdrawals"],"0");h.assert_backing();h.as_owner(A);h.call("request_withdrawal",json!({"id":"paid","amount":"50","receiver_id":A})).unwrap();h.ctx.predecessor=VAULT.into();h.ctx.attached=0;h.ctx.promise_results=vec![Some(vec![])];h.call("withdrawal_callback",json!({"id":"paid"})).unwrap();h.call("withdrawal_callback",json!({"id":"paid"})).unwrap();h.assert_backing();assert_eq!(h.balance(A)["balance"],"100");}
#[test]fn trading_key_cannot_change_policy_or_withdraw(){let mut h=Harness::new();h.deposit(A,100);h.as_agent(A);assert_eq!(h.call("revoke_agent",json!({})).err().unwrap(),"OWNER_AUTHORIZATION_REQUIRED");assert_eq!(h.call("request_withdrawal",json!({"id":"bad","amount":"100","receiver_id":A})).err().unwrap(),"OWNER_AUTHORIZATION_REQUIRED");h.ctx.signer_key="b".repeat(64);let i=h.spec(A,B,10);assert_eq!(h.call("propose_invoice",json!({"spec":i})).err().unwrap(),"AGENT_AUTHORITY_EXPIRED_OR_REVOKED");}
#[test]fn gross_budget_counts_pending_and_settled_zero_net_purchases(){let mut h=Harness::new();h.policy(A,100,100,100);let ab=h.invoice(A,B,100);let ba=h.invoice(B,A,100);let mut extra=h.spec(A,C,1);h.as_agent(C);let q=h.call("propose_invoice",json!({"spec":extra})).unwrap().value;h.as_agent(A);assert_eq!(h.call("accept_invoice",json!({"id":q["spec"]["id"],"expected_hash":q["hash"]})).err().unwrap(),"GROSS_PURCHASE_BUDGET_EXCEEDED");let r=h.round("zero-budget",&[&ab,&ba]);h.ready(&r);h.settle(&r).unwrap();assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");h.as_agent(A);assert_eq!(h.call("accept_invoice",json!({"id":q["spec"]["id"],"expected_hash":q["hash"]})).err().unwrap(),"GROSS_PURCHASE_BUDGET_EXCEEDED");extra=ab.spec.clone();extra.id="rebill".into();h.as_agent(B);assert_eq!(h.call("propose_invoice",json!({"spec":extra})).err().unwrap(),"PURCHASE_ALREADY_INVOICED");}
#[test]fn mutual_cancellation_releases_permission_without_reusing_charge(){let mut h=Harness::new();h.policy(A,100,100,100);let i=h.invoice(A,B,100);h.as_agent(A);h.call("cancel_invoice_by_agreement",json!({"id":i.spec.id,"expected_hash":i.hash})).unwrap();assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");h.as_agent(B);h.call("cancel_invoice_by_agreement",json!({"id":i.spec.id,"expected_hash":i.hash})).unwrap();assert_eq!(h.balance(A)["gross_purchase_budget_used"],"0");let mut new=i.spec.clone();new.id="other-id".into();assert!(h.call("propose_invoice",json!({"spec":new})).is_err());}
#[test]fn expiry_revocation_and_unrelated_invoices_do_not_strand_cash(){let mut h=Harness::new();h.deposit(A,100);let i=h.invoice(A,B,60);let r=h.round("expire",&[&i]);h.approve(&r,A).unwrap();let _unrelated=h.invoice(C,D,10);h.approve(&r,B).unwrap();h.settle(&r).unwrap();let i=h.invoice(A,B,20);let r=h.round("revoked",&[&i]);h.approve(&r,A).unwrap();h.as_owner(A);h.call("revoke_agent",json!({})).unwrap();let result=h.approve(&r,B).unwrap();assert_eq!(result.value["status"],"STALE");assert_eq!(h.balance(A)["reserved"],"0");h.as_owner(A);let q=h.round("expired",&[&i]);h.as_owner(A);h.call("authorize_round",json!({"id":q.input.id,"expected_hash":q.hash,"expected_net":"-20"})).unwrap();h.ctx.now_ms=q.input.deadline_ms;h.as_agent("outsider.testnet");h.call("expire_round",json!({"id":q.input.id})).unwrap();assert_eq!(h.balance(A)["reserved"],"0");h.assert_backing();}
#[test]fn cancellation_and_final_approval_have_only_two_valid_outcomes(){for commit_first in [true,false]{let mut h=Harness::new();h.deposit(A,10);let i=h.invoice(A,B,10);let r=h.round("race",&[&i]);h.approve(&r,A).unwrap();if commit_first{h.approve(&r,B).unwrap();h.as_agent(A);assert!(h.call("cancel_round_authorization",json!({"id":r.input.id,"expected_hash":r.hash})).is_err());h.settle(&r).unwrap();assert_eq!(h.balance(B)["balance"],"10");}else{h.as_agent(A);h.call("cancel_round_authorization",json!({"id":r.input.id,"expected_hash":r.hash})).unwrap();assert!(h.approve(&r,B).is_err());assert_eq!(h.balance(B)["balance"],"0");assert_eq!(h.balance(A)["available"],"10");}h.assert_backing();}}
#[test]fn failed_requests_are_transactional_and_bad_or_replayed_payloads_fail(){let mut h=Harness::new();let i=h.invoice(A,B,10);let r=h.round("domain",&[&i]);let mut other=r.input.clone();other.deadline_ms+=1;let hash=other.hash("testnet",VAULT).unwrap();h.as_agent(A);assert!(h.call("authorize_round",json!({"id":r.input.id,"expected_hash":hash,"expected_net":"-10"})).is_err());let network=r.input.hash("mainnet",VAULT).unwrap();assert!(h.call("authorize_round",json!({"id":r.input.id,"expected_hash":network,"expected_net":"-10"})).is_err());let before=h.store.0.clone();h.ctx.predecessor=TOKEN.into();assert!(h.call("ft_on_transfer",json!({"sender_id":"unknown.testnet","amount":"9","msg":"deposit"})).is_err());assert_eq!(h.store.0,before);h.ctx.predecessor="forged.testnet".into();assert!(h.call("ft_on_transfer",json!({"sender_id":A,"amount":"9","msg":"deposit"})).is_err());h.as_agent(A);let mut rebill=i.spec.clone();rebill.amount=Amount(11);assert!(h.call("propose_invoice",json!({"spec":rebill})).is_err());for amount in ["-1","1.0","01","99999999999999999999999999999999999999999"]{h.ctx.predecessor=TOKEN.into();assert!(h.call("ft_on_transfer",json!({"sender_id":A,"amount":amount,"msg":"deposit"})).is_err());}h.assert_backing();}
#[test]fn sponsor_exhaustion_refuses_new_claims_but_recovery_paths_continue(){let mut h=Harness::new();h.deposit(A,100);let i=h.invoice(A,B,100);let r=h.round("low-native",&[&i]);h.approve(&r,A).unwrap();h.ctx.native_free=0;h.as_agent(B);assert_eq!(h.approve(&r,B).err().unwrap(),"SPONSOR_STORAGE_HEADROOM_REQUIRED");h.ctx.now_ms=r.input.deadline_ms;h.call("expire_round",json!({"id":r.input.id})).unwrap();assert_eq!(h.balance(A)["reserved"],"0");h.assert_backing();}
#[test]fn stable_pagination_and_configured_round_limits(){let mut h=Harness::new();for _ in 0..80{h.invoice(A,B,1);}let first=h.view("list_invoices",json!({"cursor":0,"limit":20}));assert_eq!(first["items"].as_array().unwrap().len(),20);assert_eq!(first["next_cursor"],20);let last=h.view("list_invoices",json!({"cursor":60,"limit":20}));assert_eq!(last["next_cursor"],Value::Null);let many=first["items"].as_array().unwrap().iter().map(|i|i["spec"]["id"].as_str().unwrap().to_string()).cycle().take(49).collect::<Vec<_>>();h.as_agent(CO);assert_eq!(h.call("propose_round",json!({"id":"too-big","invoice_ids":many,"deadline_ms":2000})).err().unwrap(),"ROUND_INVOICE_LIMIT");}

#[test]fn recovery_uses_preallocated_storage_even_with_zero_native_headroom(){
 let mut h=Harness::new();h.deposit(A,100);h.deposit(D,50);
 let payment=h.invoice(A,B,100);let r=h.round("reserved-storage",&[&payment]);h.ready(&r);
 let cancelled=h.invoice(C,D,30);
 h.as_owner(D);h.call("request_withdrawal",json!({"id":"restore-at-zero","amount":"20","receiver_id":D})).unwrap();
 let footprint=|s:&MemoryStore|s.0.iter().map(|(k,v)|k.len()+v.len()).sum::<usize>();
 let before=footprint(&h.store);h.ctx.native_free=0;
 h.settle(&r).unwrap();
 h.as_owner(C);h.call("revoke_agent",json!({})).unwrap();
 for party in [C,D]{h.as_owner(party);h.call("cancel_invoice_by_agreement",json!({"id":cancelled.spec.id,"expected_hash":cancelled.hash})).unwrap();}
 h.as_agent(D);h.ctx.predecessor=VAULT.into();h.ctx.promise_results=vec![None];
 h.call("withdrawal_callback",json!({"id":"restore-at-zero"})).unwrap();
 assert_eq!(footprint(&h.store),before,"recovery allocated new storage");
 assert_eq!(h.balance(D)["available"],"50");assert_eq!(h.balance(C)["policy"]["revoked"],true);
 assert_eq!(h.view("get_invoice",json!({"id":cancelled.spec.id}))["status"],"CANCELLED");h.assert_backing();
}

fn pin_private_worker(h:&mut Harness){
 h.as_owner(VAULT);
 h.call("pin_private_worker",json!({"worker":{"outlayer_account":"outlayer.testnet","url":"https://example.com/pinned.wasm","hash":"c".repeat(64),"profile":"private-v4"}})).unwrap();
}

#[test]
fn private_purchase_budget_covers_pending_work_and_public_rebilling(){
 let mut h=Harness::new();pin_private_worker(&mut h);h.policy(A,100,100,100);
 let purchase="a".repeat(32);
 let order=json!({"purchase_id":purchase,"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)});
 h.as_agent(A);let authorization=h.call("authorize_private_purchase",order.clone()).unwrap().value;
 assert_eq!(authorization["status"],"AUTHORIZED");
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");
 assert_eq!(h.balance(A)["reserved"],"0","purchase permission is separate from settlement cash");
 assert_eq!(h.call("authorize_private_purchase",order.clone()).unwrap().value,authorization);
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");
 let before=h.store.0.clone();
 assert_eq!(h.call("authorize_private_purchase",json!({"purchase_id":"b".repeat(32),"terms_version":1,"seller":C,"order_commitment":"e".repeat(64)})).err().unwrap(),"GROSS_PURCHASE_BUDGET_EXCEEDED");
 assert_eq!(h.store.0,before,"failed purchase must not partially consume permission");
 let mut changed=order;changed["order_commitment"]=json!("e".repeat(64));
 assert_eq!(h.call("authorize_private_purchase",changed).err().unwrap(),"REQUEST_ID_CONFLICT");
 let mut spec=h.spec(A,B,80);spec.purchase_id=purchase;h.as_agent(B);
 assert_eq!(h.call("propose_invoice",json!({"spec":spec})).err().unwrap(),"PURCHASE_ALREADY_INVOICED");
 h.as_owner(A);h.call("revoke_agent",json!({})).unwrap();h.as_agent(A);
 assert_eq!(h.call("authorize_private_purchase",json!({"purchase_id":"f".repeat(32),"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)})).err().unwrap(),"AGENT_AUTHORITY_EXPIRED_OR_REVOKED");
 h.assert_backing();
}

#[test]
fn private_callback_keeps_precharged_budget_and_settles_only_after_exact_consent(){
 use ach_protocol::Canonical;
 let mut h=Harness::new();pin_private_worker(&mut h);h.policy(A,100,100,100);
 let purchase="a".repeat(32);h.as_agent(A);
 let authorization=h.call("authorize_private_purchase",json!({"purchase_id":purchase,"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)})).unwrap().value;
 let charge_id=authorization["charge_id"].as_str().unwrap().to_string();let commitment="e".repeat(64);let deadline=5000;
 let mut binding=Canonical::new("private-input","testnet",VAULT);
 binding.field("private-funded").field(&deadline.to_string()).field(&"c".repeat(64)).count(1).field(&commitment);
 let input_commitment=binding.hash();
 let request=json!({"id":"private-funded","input_commitment":input_commitment,"profile":"private-v4","members":[A,B],"deadline_ms":deadline,"disclosure_signatures":[{"account_id":A,"key_epoch":h.balance(A)["policy"]["epoch"],"signature":"A".repeat(88)},{"account_id":B,"key_epoch":h.balance(B)["policy"]["epoch"],"signature":"A".repeat(88)}],"encrypted_invoices":[{"nullifier":charge_id,"commitment":commitment,"ephemeral_public_key":"f".repeat(64),"nonce":"12".repeat(12),"ciphertext":"A".repeat(ach_protocol::PRIVATE_CIPHERTEXT_BASE64_BYTES)}]});
 h.as_owner(CO);h.ctx.attached=20_000_000_000_000_000_000_000;
 let execution=h.call("request_private_round",request.clone()).unwrap();assert_eq!(execution.calls.len(),1);
 let policies=execution.calls[0].args["input_data"].as_str().map(|s|serde_json::from_str::<Value>(s).unwrap()["policies"].clone()).unwrap();
 let result=json!({"protocol_version":4,"operation":"net","request_id":"private-funded","input_commitment":input_commitment,"worker_hash":"c".repeat(64),"deadline_ms":deadline,"positions":[{"account_id":A,"net":"-80"},{"account_id":B,"net":"80"}],"charges":[{"nullifier":charge_id,"commitment":commitment,"buyer":A,"policy_epoch":authorization["policy_epoch"]}],"policy_epochs":policies,"previous_nullifiers":[]});
 h.as_agent(B);h.ctx.promise_results=vec![Some(serde_json::to_vec(&serde_json::to_string(&result).unwrap()).unwrap())];
 assert_eq!(h.call("verified_private_round_callback",json!({"id":"private-funded"})).err().unwrap(),"PRIVATE_CALLBACK_ONLY");
 h.ctx.predecessor=VAULT.into();let round:Round=serde_json::from_value(h.call("verified_private_round_callback",json!({"id":"private-funded"})).unwrap().value).unwrap();
 h.call("verified_private_round_callback",json!({"id":"private-funded"})).unwrap();
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100","verification must not charge the pending cap twice");
 assert_eq!(h.balance(B)["balance"],"0","a verified receivable must not create spendable cash");
 assert_eq!(h.approve(&round,A).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");
 h.deposit(A,80);h.ready(&round);h.settle(&round).unwrap();h.settle(&round).unwrap();
 assert_eq!(h.balance(B)["available"],"80");
 assert_eq!(h.view("get_private_invoice",json!({"id":charge_id}))["status"],"SETTLED");
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");
 h.as_owner(A);assert_eq!(h.call("cancel_pending_private_purchase",json!({"id":authorization["charge_id"],"expected_hash":authorization["order_commitment"]})).err().unwrap(),"PRIVATE_PURCHASE_ALREADY_FINALIZED");
 h.as_owner(CO);h.ctx.attached=20_000_000_000_000_000_000_000;
 assert_eq!(h.call("request_private_round",request).err().unwrap(),"PRIVATE_CHARGE_ALREADY_COMMITTED");h.assert_backing();
}

#[test]
fn private_receipt_callback_rejects_disclosure_and_creates_no_financial_round(){
 let mut h=Harness::new();pin_private_worker(&mut h);h.as_agent(A);
 let authorization=h.call("authorize_private_purchase",json!({"purchase_id":"a".repeat(32),"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)})).unwrap().value;
 let charge=authorization["charge_id"].as_str().unwrap();let commitment="e".repeat(64);let deadline=5000;
 let mut binding=ach_protocol::Canonical::new("private-input","testnet",VAULT);binding.field("verify-only").field(&deadline.to_string()).field(&"c".repeat(64)).count(1).field(&commitment);let input=binding.hash();
 let mut request=json!({"id":"verify-only","input_commitment":input,"profile":"private-v4","members":[A,B],"deadline_ms":deadline,"verification_only":true,"encrypted_invoices":[{"nullifier":charge,"commitment":commitment,"ephemeral_public_key":"f".repeat(64),"nonce":"12".repeat(12),"ciphertext":"A".repeat(ach_protocol::PRIVATE_CIPHERTEXT_BASE64_BYTES)}]});
 h.as_owner(CO);h.ctx.attached=20_000_000_000_000_000_000_000;
 request["verification_only"]=json!(false);assert_eq!(h.call("request_private_round",request.clone()).err().unwrap(),"PRIVATE_DISCLOSURE_CONSENT_REQUIRED");
 request["verification_only"]=json!(true);let execution=h.call("request_private_round",request).unwrap();
 let worker:Value=serde_json::from_str(execution.calls[0].args["input_data"].as_str().unwrap()).unwrap();assert_eq!(worker["operation"],"verify");
 let mut result=json!({"protocol_version":4,"operation":"net","request_id":"verify-only","input_commitment":input,"worker_hash":"c".repeat(64),"deadline_ms":deadline,"positions":[{"account_id":A,"net":"0"},{"account_id":B,"net":"0"}],"charges":[{"nullifier":charge,"commitment":commitment,"buyer":A,"policy_epoch":authorization["policy_epoch"]}],"policy_epochs":worker["policies"],"previous_nullifiers":[]});
 h.ctx.predecessor=VAULT.into();h.ctx.attached=0;let before=h.store.0.clone();
 h.ctx.promise_results=vec![Some(serde_json::to_vec(&result.to_string()).unwrap())];assert_eq!(h.call("verified_private_round_callback",json!({"id":"verify-only"})).err().unwrap(),"PRIVATE_RESULT_OPERATION_MISMATCH");assert_eq!(h.store.0,before);
 result["operation"]=json!("verify");result["positions"][0]["net"]=json!("-80");result["positions"][1]["net"]=json!("80");
 h.ctx.promise_results=vec![Some(serde_json::to_vec(&result.to_string()).unwrap())];assert_eq!(h.call("verified_private_round_callback",json!({"id":"verify-only"})).err().unwrap(),"PRIVATE_VERIFICATION_DISCLOSURE_REFUSED");assert_eq!(h.store.0,before);
 result["positions"][0]["net"]=json!("0");result["positions"][1]["net"]=json!("0");h.ctx.promise_results=vec![Some(serde_json::to_vec(&result.to_string()).unwrap())];
 assert_eq!(h.call("verified_private_round_callback",json!({"id":"verify-only"})).unwrap().value["status"],"VERIFIED");
 assert_eq!(h.view("get_private_invoice",json!({"id":charge}))["status"],"ACCEPTED");assert_eq!(h.view("list_rounds",json!({"cursor":0,"limit":10}))["total"],0);assert_eq!(h.balance(CO)["active_proposals"],0);h.assert_backing();
}

#[test]
fn failed_private_order_requires_mutual_cancellation_and_releases_only_its_permission(){
 let mut h=Harness::new();pin_private_worker(&mut h);h.policy(A,100,100,100);h.deposit(A,50);
 h.as_agent(A);let order=h.call("authorize_private_purchase",json!({"purchase_id":"a".repeat(32),"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)})).unwrap().value;
 let cancellation=json!({"id":order["charge_id"],"expected_hash":order["order_commitment"]});
 h.as_agent(C);assert_eq!(h.call("cancel_pending_private_purchase",cancellation.clone()).err().unwrap(),"INVOICE_PARTY_REQUIRED");
 h.ctx.native_free=0;h.as_owner(A);h.call("cancel_pending_private_purchase",cancellation.clone()).unwrap();
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"100");assert_eq!(h.balance(A)["available"],"50");
 h.as_owner(B);let result=h.call("cancel_pending_private_purchase",cancellation.clone()).unwrap();assert_eq!(result.value["status"],"CANCELLED");
 h.call("cancel_pending_private_purchase",cancellation).unwrap();assert_eq!(h.balance(A)["gross_purchase_budget_used"],"0");assert_eq!(h.balance(A)["available"],"50");
 let mut rebill=h.spec(A,B,10);rebill.purchase_id="a".repeat(32);h.ctx.native_free=10u128.pow(26);assert_eq!(h.call("propose_invoice",json!({"spec":rebill})).err().unwrap(),"PURCHASE_ALREADY_INVOICED");
 h.as_agent(A);assert_eq!(h.call("authorize_private_purchase",json!({"purchase_id":"a".repeat(32),"terms_version":1,"seller":B,"order_commitment":"d".repeat(64)})).unwrap().value["status"],"CANCELLED");
 assert_eq!(h.balance(A)["gross_purchase_budget_used"],"0");h.assert_backing();
}

/// Independent accounting reference: external cash in/out and settled bilateral
/// obligations explain every balance. Reservations are reconstructed from active
/// approvals, not from the contract's balance/reservation implementation.
fn independently_check(store:&MemoryStore,expected:&BTreeMap<String,u128>){
 let mut reserved=BTreeMap::<String,u128>::new();let mut consumed=BTreeSet::new();
 for (k,v) in &store.0{if k.starts_with("round:"){let r:Round=serde_json::from_slice(v).unwrap();if matches!(r.status.as_str(),"COLLECTING"|"READY"){for a in &r.approvals{*reserved.entry(a.account_id.clone()).or_default()+=a.required.0;}}if r.status=="SETTLED"{for id in r.input.invoice_ids{assert!(consumed.insert(id),"invoice consumed twice");}}}}
 let mut total=0;let mut pending=0;
 for (k,v) in &store.0{if k.starts_with("account:"){let w:Wallet=serde_json::from_slice(v).unwrap();assert_eq!(w.balance.0,*expected.get(&w.account_id).unwrap_or(&0),"independent balance {}",w.account_id);assert_eq!(w.reserved.0,*reserved.get(&w.account_id).unwrap_or(&0),"independent reservations");assert!(w.balance.0>=w.reserved.0);total+=w.balance.0;pending+=w.pending_withdrawals.0;}}
 let c:Config=serde_json::from_slice(&store.0["config"]).unwrap();assert_eq!(total,c.total_balances.0);assert_eq!(pending,c.pending_withdrawals.0);assert_eq!(total+pending,c.tracked_token_custody.0);
}
#[test]fn randomized_model_checks_every_transition_and_detects_financial_faults(){
 let mut h=Harness::new();let mut expected=BTreeMap::new();for id in [A,B,C,D]{h.deposit(id,10_000);expected.insert(id.into(),10_000u128);}let mut seed=17u64;let agents=[A,B,C,D];let mut rounds=Vec::<(Round,Vec<Invoice>)>::new();let mut settled=BTreeSet::new();
 for step in 0..1200{seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);let n=(seed>>32) as usize;
  if step%5==0{let buyer=agents[n%4];let seller=agents[(n%4+1+n%3)%4];let i=h.invoice(buyer,seller,(n%97+1) as u128);h.as_agent(buyer);let result=h.call("propose_round",json!({"id":format!("random-{step}"),"invoice_ids":[i.spec.id],"deadline_ms":h.ctx.now_ms+10_000}));if let Ok(result)=result{let r:Round=serde_json::from_value(result.value).unwrap();rounds.push((r,vec![i]));}}
  else if !rounds.is_empty(){let idx=n%rounds.len();let (r,invoices)=rounds[idx].clone();let member=&r.input.positions[n%r.input.positions.len()].account_id;
   match n%5{
    0|1=>{let _=h.approve(&r,member);},
    2=>{if h.settle(&r).is_ok() && settled.insert(r.input.id.clone()){for i in invoices{*expected.get_mut(&i.spec.buyer).unwrap()-=i.spec.amount.0;*expected.get_mut(&i.spec.seller).unwrap()+=i.spec.amount.0;}}},
    3=>{h.as_owner(member);let _=h.call("cancel_round_authorization",json!({"id":r.input.id,"expected_hash":r.hash}));},
    _=>{h.ctx.now_ms+=50;h.as_agent("permissionless.testnet");let _=h.call("expire_round",json!({"id":r.input.id}));},
   }
  }
  independently_check(&h.store,&expected);
 }
 let mut broken=h.store.clone();let mut w:Wallet=serde_json::from_slice(&broken.0[&format!("account:{A}")]).unwrap();w.balance.0+=1;broken.0.insert(format!("account:{A}"),serde_json::to_vec(&w).unwrap());assert!(std::panic::catch_unwind(||independently_check(&broken,&expected)).is_err(),"reference failed to detect injected unbacked credit");
}
