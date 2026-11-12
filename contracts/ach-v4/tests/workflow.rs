use ach_protocol::{Amount,Canonical,InvoiceSpec,net_invoices};
use ach_runtime::{Context,MemoryStore};
use ach_vault::{execute,Execution,FundingGroup,FundingGroupInput,FundingOrder,PublicPurchaseTerms,Invoice,Round,Wallet,Config};
use serde_json::{json,Value};
use std::collections::BTreeMap;

const A:&str="aa.testnet";const B:&str="bb.testnet";const C:&str="cc.testnet";const CO:&str="coord.testnet";const V:&str="vault.testnet";const T:&str="usd.testnet";
struct Harness{store:MemoryStore,ctx:Context,nonce:u64}
impl Harness{
 fn new()->Self{
  let mut h=Self{store:MemoryStore::default(),ctx:Context{current:V.into(),predecessor:V.into(),signer:V.into(),signer_key:"a".repeat(64),now_ms:1000,native_free:10u128.pow(27),..Default::default()},nonce:0};
  h.call("init",json!({"network":"testnet","token":T,"owner_id":CO,"coordinator_id":CO,"private_worker":null})).unwrap();
  assert_eq!(h.view("get_config",json!({}))["workflow_revision"],2);
  for account in [A,B,C,CO]{
   h.owner(CO);h.call("authorize_account_registration",json!({"account_id":account,"name":account,"expires_at_ms":1_000_000})).unwrap();
   h.owner(account);h.call("register_account",json!({"name":account})).unwrap();h.policy(account,1_000_000);
  }h
 }
 fn agent(&mut self,id:&str){self.ctx.predecessor=id.into();self.ctx.signer=id.into();self.ctx.signer_key="a".repeat(64);self.ctx.attached=0;self.ctx.promise_results.clear();}
 fn owner(&mut self,id:&str){self.agent(id);self.ctx.attached=1;}
 fn policy(&mut self,id:&str,gross:u128){self.owner(id);self.call("set_agent_policy",json!({"key":"a".repeat(64),"max_invoice":"1000000","gross_budget":gross.to_string(),"max_net_commitment":"1000000","expires_at_ms":2_000_000,"counterparties":[],"services":[]})).unwrap();}
 fn call(&mut self,m:&str,a:Value)->Result<Execution,String>{execute(&mut self.store,&self.ctx,m,a)}
 fn view(&mut self,m:&str,a:Value)->Value{self.call(m,a).unwrap().value}
 fn balance(&mut self,a:&str)->Value{self.view("get_balance",json!({"account_id":a}))}
 fn deposit(&mut self,a:&str,n:u128){self.agent(T);self.call("ft_on_transfer",json!({"sender_id":a,"amount":n.to_string(),"msg":"deposit"})).unwrap();}
 fn spec(&mut self,b:&str,s:&str,n:u128)->InvoiceSpec{
  self.nonce+=1;let mut spec=InvoiceSpec{id:String::new(),purchase_id:format!("{:032x}",self.nonce),terms_version:1,buyer:b.into(),seller:s.into(),asset:T.into(),amount:Amount(n),service:"chart".into(),terms_hash:"b".repeat(64),artifact_hash:"c".repeat(64),ready_at_ms:self.ctx.now_ms,expires_at_ms:self.ctx.now_ms+10_000};
  spec.id=format!("bill-{}",spec.charge_id("testnet",V));spec
 }
 fn input(&self,specs:&[InvoiceSpec],label:&str)->FundingGroupInput{
  let mut c=Canonical::new("purchase-group-proposer","testnet",V);c.field(&specs[0].buyer);
  FundingGroupInput{id:format!("pg-{}-{label}",&c.hash()[..32]),orders:specs.iter().map(|s|FundingOrder{purchase_id:s.purchase_id.clone(),terms_version:1,buyer:s.buyer.clone(),seller:s.seller.clone(),order_commitment:s.terms_hash.clone(),public_terms:Some(PublicPurchaseTerms{amount:s.amount,service:s.service.clone(),terms_hash:s.terms_hash.clone(),artifact_hash:s.artifact_hash.clone()})}).collect(),positions:net_invoices(specs).unwrap().positions,deadline_ms:specs[0].expires_at_ms,private:false}
 }
 fn propose(&mut self,input:&FundingGroupInput)->FundingGroup{self.agent(&input.orders[0].buyer);serde_json::from_value(self.call("propose_purchase_group",json!({"input":input})).unwrap().value).unwrap()}
 fn approve(&mut self,g:&FundingGroup,a:&str)->Result<Execution,String>{self.agent(a);let net=&g.input.positions.iter().find(|p|p.account_id==a).unwrap().net;self.call("authorize_purchase_group",json!({"id":g.input.id,"expected_hash":g.hash,"expected_net":net}))}
 fn fund(&mut self,input:&FundingGroupInput)->FundingGroup{let mut g=self.propose(input);for p in &input.positions{g=serde_json::from_value(self.approve(&g,&p.account_id).unwrap().value).unwrap();}assert_eq!(g.status,"FUNDED");g}
 fn deliver(&mut self,s:&InvoiceSpec)->Invoice{self.agent(&s.seller);let i=self.call("propose_invoice",json!({"spec":s})).unwrap().value;serde_json::from_value(self.call("accept_invoice",json!({"id":s.id,"expected_hash":i["hash"]})).unwrap().value).unwrap()}
 fn settle(&mut self,id:&str){let r=self.view("get_round",json!({"id":id}));self.agent("permissionless.testnet");self.call("settle_round",json!({"id":id,"expected_hash":r["hash"]})).unwrap();}
 fn expiry(&mut self,g:&FundingGroup)->Result<Execution,String>{self.agent("permissionless.testnet");self.call("expire_purchase_group",json!({"id":g.input.id}))}
 fn check(&self,expected:&BTreeMap<String,u128>){
  let mut reserved=BTreeMap::<String,u128>::new();
  for(k,v)in &self.store.0{
   if k.starts_with("funding-group:"){let g:FundingGroup=serde_json::from_slice(v).unwrap();if ["COLLECTING","FUNDED"].contains(&g.status.as_str()){for a in g.approvals{*reserved.entry(a.account_id).or_default()+=a.required.0;}}}
   if k.starts_with("round:"){let r:Round=serde_json::from_slice(v).unwrap();if r.status=="READY"{for a in r.approvals{*reserved.entry(a.account_id).or_default()+=a.required.0;}}}
  }
  let(mut sum,mut pending)=(0,0);
  for(k,v)in &self.store.0{if k.starts_with("account:"){let w:Wallet=serde_json::from_slice(v).unwrap();assert_eq!(w.balance.0,*expected.get(&w.account_id).unwrap_or(&0));assert_eq!(w.reserved.0,*reserved.get(&w.account_id).unwrap_or(&0));assert!(w.balance.0>=w.reserved.0);sum+=w.balance.0;pending+=w.pending_withdrawals.0;}}
  let c:Config=serde_json::from_slice(&self.store.0["config"]).unwrap();assert_eq!(sum,c.total_balances.0);assert_eq!(pending,c.pending_withdrawals.0);assert_eq!(sum+pending,c.tracked_token_custody.0);
 }
}

#[test]fn only_sponsored_accounts_can_allocate_wallet_storage(){let mut h=Harness::new();h.owner("attacker.testnet");let before=h.store.0.clone();assert_eq!(h.call("register_account",json!({"name":"Attacker"})).err().unwrap(),"ACCOUNT_STORAGE_SPONSORSHIP_REQUIRED");assert_eq!(h.store.0,before);assert_eq!(h.call("authorize_account_registration",json!({"account_id":"attacker.testnet","name":"Attacker","expires_at_ms":9999})).err().unwrap(),"STORAGE_SPONSOR_REQUIRED");}

#[test]fn unapproved_sellers_cannot_claim_purchase_or_group_identifiers(){let mut h=Harness::new();let spec=h.spec(A,B,10);let input=h.input(&[spec.clone()],"protected");h.agent(C);assert_eq!(h.call("propose_purchase_group",json!({"input":input})).err().unwrap(),"PURCHASE_GROUP_PROPOSER_NAMESPACE_REQUIRED");let before=h.store.0.clone();let mut malicious=spec.clone();malicious.seller=C.into();assert_eq!(h.call("propose_invoice",json!({"spec":malicious})).err().unwrap(),"BUYER_FUNDED_ORDER_REQUIRED");assert_eq!(h.store.0,before);h.deposit(A,10);h.fund(&input);h.deliver(&spec);h.settle(&input.id);assert_eq!(h.balance(B)["balance"],"10");}

#[test]fn deposit_receipts_are_idempotent_and_bound_to_the_amount(){let mut h=Harness::new();h.agent(T);let input=json!({"sender_id":A,"amount":"10","msg":"deposit:receipt-1"});assert_eq!(h.call("ft_on_transfer",input.clone()).unwrap().value,"0");let before=h.store.0.clone();assert_eq!(h.call("ft_on_transfer",input).unwrap().value,"10");assert_eq!(h.store.0,before);assert!(h.call("ft_on_transfer",json!({"sender_id":A,"amount":"11","msg":"deposit:receipt-1"})).is_err());assert_eq!(h.store.0,before);assert_eq!(h.balance(A)["balance"],"10");}

#[test]fn early_net_reservation_blocks_selective_credit_withdrawal_and_split_settlement(){
 let mut h=Harness::new();let specs=[h.spec(A,B,100),h.spec(B,C,100),h.spec(C,A,80)];let input=h.input(&specs,"cycle");h.deposit(A,20);let g=h.fund(&input);
 assert_eq!(h.balance(A)["available"],"0");h.owner(A);assert_eq!(h.call("request_withdrawal",json!({"id":"steal","amount":"1","receiver_id":A})).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");
 let first=h.deliver(&specs[0]);h.agent(CO);assert_eq!(h.call("propose_round",json!({"id":"split","invoice_ids":[first.spec.id],"deadline_ms":9999})).err().unwrap(),"FUNDED_GROUP_MUST_CLEAR_TOGETHER");
 for s in &specs[1..]{h.deliver(s);}h.owner(C);assert!(h.call("cancel_invoice_by_agreement",json!({"id":specs[1].id,"expected_hash":specs[1].hash("testnet",V)})).is_err());
 h.ctx.now_ms=g.input.deadline_ms;assert_eq!(h.expiry(&g).err().unwrap(),"PURCHASE_GROUP_IS_IRREVOCABLE");h.settle(&g.input.id);h.settle(&g.input.id);
 assert_eq!(h.balance(A)["balance"],"0");assert_eq!(h.balance(B)["balance"],"0");assert_eq!(h.balance(C)["balance"],"20");h.check(&BTreeMap::from([(C.into(),20)]));
}

#[test]fn missing_delivery_expires_and_refunds_once_even_without_native_headroom(){
 let mut h=Harness::new();h.deposit(A,100);let s=h.spec(A,B,60);let input=h.input(&[s.clone()],"expiry");let g=h.fund(&input);assert_eq!(h.balance(A)["gross_purchase_budget_used"],"60");
 h.deliver(&s);assert_eq!(h.expiry(&g).err().unwrap(),"PURCHASE_GROUP_IS_IRREVOCABLE");let ready_id=input.id.clone();
 let s=h.spec(A,C,40);let input=h.input(&[s.clone()],"missing");let g=h.fund(&input);h.ctx.now_ms=input.deadline_ms;h.ctx.native_free=0;h.expiry(&g).unwrap();h.expiry(&g).unwrap();
 assert_eq!(h.balance(A)["reserved"],"60");assert_eq!(h.balance(A)["gross_purchase_budget_used"],"60");h.ctx.native_free=10u128.pow(27);h.agent(C);assert!(h.call("propose_invoice",json!({"spec":s})).is_err());
 h.settle(&ready_id);assert_eq!(h.balance(A)["available"],"40");assert_eq!(h.balance(B)["balance"],"60");
}

#[test]fn final_delivery_and_expiry_have_only_the_two_valid_race_outcomes(){
 for deliver_first in [true,false]{let mut h=Harness::new();h.deposit(A,10);let s=h.spec(A,B,10);let input=h.input(&[s.clone()],"race");let g=h.fund(&input);
  if deliver_first{h.deliver(&s);h.ctx.now_ms=input.deadline_ms;assert!(h.expiry(&g).is_err());h.settle(&input.id);assert_eq!(h.balance(B)["balance"],"10");}
  else{h.ctx.now_ms=input.deadline_ms;h.expiry(&g).unwrap();h.agent(B);assert!(h.call("propose_invoice",json!({"spec":s})).is_err());assert_eq!(h.balance(A)["available"],"10");}
 }
}

#[test]fn altered_terms_foreign_invoice_names_and_future_receipts_are_transactional(){
 let mut h=Harness::new();h.deposit(A,10);let s=h.spec(A,B,10);h.fund(&h.input(&[s.clone()],"terms"));
 for field in ["amount","artifact_hash","terms_hash","seller","id","ready_at_ms"]{let mut altered=serde_json::to_value(&s).unwrap();altered[field]=match field{"amount"=>json!("9"),"seller"=>json!(C),"id"=>json!("someone-elses-bill"),"ready_at_ms"=>json!(h.ctx.now_ms+1),_=>json!("d".repeat(64))};h.agent(if field=="seller"{C}else{B});let before=h.store.0.clone();assert!(h.call("propose_invoice",json!({"spec":altered})).is_err(),"{field}");assert_eq!(h.store.0,before);}
 h.deliver(&s);
}

#[test]fn duplicate_funding_and_replayed_groups_cannot_double_reserve(){
 let mut h=Harness::new();h.deposit(A,10);let s=h.spec(A,B,10);let input=h.input(&[s.clone()],"one");let g=h.fund(&input);h.approve(&g,A).unwrap();assert_eq!(h.balance(A)["reserved"],"10");
 let other=h.spec(A,C,10);let g2=h.propose(&h.input(&[other],"two"));let before=h.store.0.clone();assert_eq!(h.approve(&g2,A).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");assert_eq!(h.store.0,before);
 let g3=h.propose(&h.input(&[s],"rebill"));assert_eq!(h.approve(&g3,A).err().unwrap(),"PURCHASE_ALREADY_INVOICED");assert_eq!(h.balance(A)["reserved"],"10");
}

#[test]fn quota_consumption_after_funding_cannot_veto_delivery_or_recovery(){
 let mut h=Harness::new();h.deposit(A,10);let s=h.spec(A,B,10);let input=h.input(&[s.clone()],"quota");h.fund(&input);
 while h.balance(A)["sponsored_records"].as_u64().unwrap()<128{h.policy(A,1_000_000);}
 let before=h.store.0.clone();h.owner(A);assert_eq!(h.call("set_agent_policy",json!({"key":"a".repeat(64),"max_invoice":"1000000","gross_budget":"1000000","max_net_commitment":"1000000","expires_at_ms":2_000_000,"counterparties":[],"services":[]})).err().unwrap(),"SPONSORED_RECORD_LIMIT");assert_eq!(h.store.0,before);
 h.deliver(&s);h.ctx.native_free=0;h.settle(&input.id);assert_eq!(h.balance(B)["balance"],"10");
}

#[test]fn changed_authority_before_funding_fails_but_a_funded_commitment_survives_revocation(){
 let mut h=Harness::new();h.deposit(A,10);let s=h.spec(A,B,10);let input=h.input(&[s.clone()],"authority");let g=h.propose(&input);h.approve(&g,A).unwrap();h.owner(A);h.call("revoke_agent",json!({})).unwrap();let before=h.store.0.clone();assert_eq!(h.approve(&g,B).err().unwrap(),"PURCHASE_GROUP_AUTHORITY_CHANGED");assert_eq!(h.store.0,before);h.ctx.now_ms=input.deadline_ms;h.expiry(&g).unwrap();assert_eq!(h.balance(A)["available"],"10");
 h.policy(A,1_000_000);let s=h.spec(A,B,10);let input=h.input(&[s.clone()],"funded-authority");h.fund(&input);h.owner(A);h.call("revoke_agent",json!({})).unwrap();h.deliver(&s);h.settle(&input.id);assert_eq!(h.balance(B)["balance"],"10");
}

#[test]fn randomized_funded_groups_match_an_independent_accounting_reference(){
 let mut h=Harness::new();let mut expected=BTreeMap::from([(A.into(),1000),(B.into(),1000),(C.into(),1000)]);for a in [A,B,C]{h.deposit(a,1000);}let mut seed=29u64;
 for step in 0..16{seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);let n=(seed>>32)%40+1;let specs=[h.spec(A,B,n as u128),h.spec(B,C,n as u128),h.spec(C,A,(n-1).max(1) as u128)];let input=h.input(&specs,&format!("model-{step}"));let g=h.propose(&input);
  for p in &input.positions{if h.approve(&g,&p.account_id).is_err(){break;}h.check(&expected);}
  let status=h.view("get_purchase_group",json!({"id":input.id}))["status"].clone();
  if step%3==0||status!="FUNDED"{h.ctx.now_ms=input.deadline_ms;h.expiry(&g).unwrap();}
  else{for s in &specs{h.deliver(s);h.check(&expected);}h.settle(&input.id);for s in &specs{*expected.get_mut(&s.buyer).unwrap()-=s.amount.0;*expected.get_mut(&s.seller).unwrap()+=s.amount.0;}h.settle(&input.id);}
  h.check(&expected);
 }
}

#[test]fn maximum_funded_group_with_multiple_debtors_matches_independent_accounting_at_zero_headroom(){
 let mut h=Harness::new();let mut accounts=vec![A.to_string(),B.to_string(),C.to_string()];
 for n in 3..12{let account=format!("extra-{n}.testnet");h.owner(CO);h.call("authorize_account_registration",json!({"account_id":account,"name":account,"expires_at_ms":1_000_000})).unwrap();h.owner(&account);h.call("register_account",json!({"name":account})).unwrap();h.policy(&account,1_000_000);accounts.push(account);}
 let specs=(0..48).map(|n|h.spec(&accounts[n%12],&accounts[(n%12+1+n/12)%12],((n*37)%97+1) as u128)).collect::<Vec<_>>();
 let mut net=accounts.iter().map(|a|(a.clone(),0i128)).collect::<BTreeMap<_,_>>();let mut gross=accounts.iter().map(|a|(a.clone(),0u128)).collect::<BTreeMap<_,_>>();
 for s in &specs{*net.get_mut(&s.buyer).unwrap()-=s.amount.0 as i128;*net.get_mut(&s.seller).unwrap()+=s.amount.0 as i128;*gross.get_mut(&s.buyer).unwrap()+=s.amount.0;}
 assert!(net.values().filter(|n|**n<0).count()>1);assert!(net.values().filter(|n|**n>0).count()>1);assert_eq!(net.values().sum::<i128>(),0);
 let input=h.input(&specs,"maximum-multiple-debtors");assert_eq!(input.positions.len(),12);for p in &input.positions{assert_eq!(p.net.parse::<i128>().unwrap(),net[&p.account_id]);}
 let missing=input.positions.iter().find(|p|net[&p.account_id]<0).unwrap().account_id.clone();let mut expected=BTreeMap::new();
 for account in &accounts{let debit=(-net[account]).max(0) as u128;let amount=debit-u128::from(account==&missing);if amount>0{h.deposit(account,amount);}expected.insert(account.clone(),amount);}
 let g=h.propose(&input);
 for p in input.positions.iter().rev().filter(|p|p.account_id!=missing){h.approve(&g,&p.account_id).unwrap();h.check(&expected);let before=h.store.0.clone();h.approve(&g,&p.account_id).unwrap();assert_eq!(h.store.0,before,"repeated approval changed state");}
 let before=h.store.0.clone();assert_eq!(h.approve(&g,&missing).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");assert_eq!(h.store.0,before);h.check(&expected);
 h.deposit(&missing,1);*expected.get_mut(&missing).unwrap()+=1;assert_eq!(h.approve(&g,&missing).unwrap().value["status"],"FUNDED");h.check(&expected);
 for account in &accounts{assert_eq!(h.balance(account)["available"],"0");if net[account]<0{h.owner(account);let before=h.store.0.clone();assert_eq!(h.call("request_withdrawal",json!({"id":format!("drain-{account}"),"amount":"1","receiver_id":account})).err().unwrap(),"INSUFFICIENT_AVAILABLE_BALANCE");assert_eq!(h.store.0,before);}}
 for (n,s) in specs.iter().rev().enumerate(){h.deliver(s);h.check(&expected);if n==0{h.agent(CO);let before=h.store.0.clone();assert_eq!(h.call("propose_round",json!({"id":"collect-one-leg","invoice_ids":[s.id],"deadline_ms":input.deadline_ms})).err().unwrap(),"FUNDED_GROUP_MUST_CLEAR_TOGETHER");assert_eq!(h.store.0,before);}}
 assert_eq!(h.view("get_round",json!({"id":input.id}))["status"],"READY");h.ctx.now_ms=input.deadline_ms;h.ctx.native_free=0;assert_eq!(h.expiry(&g).err().unwrap(),"PURCHASE_GROUP_IS_IRREVOCABLE");h.settle(&input.id);
 for account in &accounts{let final_balance=expected[account] as i128+net[account];assert!(final_balance>=0);expected.insert(account.clone(),final_balance as u128);assert_eq!(h.balance(account)["gross_purchase_budget_used"],gross[account].to_string());}
 h.check(&expected);let before=h.store.0.clone();h.settle(&input.id);assert_eq!(h.store.0,before,"repeated settlement changed state");h.check(&expected);
 for s in &specs{assert_eq!(h.view("get_invoice",json!({"id":s.id}))["status"],"SETTLED");}
}

impl Harness {
 fn private_group(&mut self,label:&str)->FundingGroup {
  self.owner(V);self.call("pin_private_worker",json!({"worker":{"outlayer_account":"outlayer.testnet","url":"https://example.com/pinned.wasm","hash":"d".repeat(64),"profile":"private-v4"}})).unwrap();
  let specs=[self.spec(A,B,100),self.spec(B,C,100),self.spec(C,A,80)];
  let mut input=self.input(&specs,label);input.private=true;for o in &mut input.orders{o.public_terms=None;}
  let group=self.fund(&input);
  for order in &group.input.orders{self.agent(&order.buyer);self.call("authorize_private_purchase",json!({"purchase_id":order.purchase_id,"terms_version":order.terms_version,"seller":order.seller,"order_commitment":order.order_commitment})).unwrap();}
  group
 }
 fn private_request(&mut self,g:&FundingGroup,id:&str,verify:bool)->Value{
  let orders=if verify{&g.input.orders[..1]}else{&g.input.orders[..]};
  let envelopes=orders.iter().map(|o|json!({"nullifier":o.charge_id("testnet",V),"commitment":"e".repeat(64),"ephemeral_public_key":"f".repeat(64),"nonce":"a".repeat(24),"ciphertext":"A".repeat(ach_protocol::PRIVATE_CIPHERTEXT_BASE64_BYTES)})).collect::<Vec<_>>();
  let deadline=g.input.deadline_ms;let mut binding=Canonical::new("private-input","testnet",V);binding.field(id).field(&deadline.to_string()).field(&"d".repeat(64)).count(envelopes.len());for _ in &envelopes{binding.field(&"e".repeat(64));}
  let members=if verify{vec![A,B]}else{vec![A,B,C]};
  json!({"id":id,"input_commitment":binding.hash(),"profile":"private-v4","members":members,"deadline_ms":deadline,"encrypted_invoices":envelopes,"verification_only":verify,"disclosure_signatures":if verify{vec![]}else{members.iter().map(|a|json!({"account_id":a,"key_epoch":1,"signature":"A".repeat(88)})).collect::<Vec<_>>()},"funding_group_id":if verify{None}else{Some(g.input.id.clone())}})
 }
 fn send_private(&mut self,input:Value)->Result<Execution,String>{self.agent(CO);self.ctx.attached=20_000_000_000_000_000_000_000;self.call("request_private_round",input)}
 fn private_output(&mut self,id:&str,positions:Value)->Value{
  let req=self.view("get_private_request",json!({"id":id}));
  let charges=req["invoice_commitments"].as_array().unwrap().iter().map(|pair|{
   let auth=self.view("get_private_purchase",json!({"id":pair[0]}));json!({"nullifier":pair[0],"commitment":pair[1],"buyer":auth["buyer"],"policy_epoch":auth["policy_epoch"]})
  }).collect::<Vec<_>>();
  json!({"protocol_version":4,"operation":if req["verification_only"]==true{"verify"}else{"net"},"request_id":id,"input_commitment":req["input_commitment"],"worker_hash":req["worker_hash"],"deadline_ms":req["deadline_ms"],"positions":positions,"charges":charges,"policy_epochs":req["policies"],"previous_nullifiers":req["prior_charges"].as_array().unwrap().iter().map(|c|c["nullifier"].clone()).collect::<Vec<_>>()})
 }
 fn callback(&mut self,id:&str,result:Value)->Result<Execution,String>{self.agent(V);self.ctx.promise_results=vec![Some(serde_json::to_vec(&result.to_string()).unwrap())];self.call("verified_private_round_callback",json!({"id":id}))}
}

#[test]fn private_funded_groups_reject_extra_members_and_mismatched_net_results(){
 let mut h=Harness::new();h.deposit(A,20);let g=h.private_group("private-members");let input=h.private_request(&g,"private-result",false);
 let mut extra=input.clone();extra["members"].as_array_mut().unwrap().push(json!(CO));extra["disclosure_signatures"].as_array_mut().unwrap().push(json!({"account_id":CO,"key_epoch":1,"signature":"A".repeat(88)}));let before=h.store.0.clone();
 assert_eq!(h.send_private(extra).err().unwrap(),"PURCHASE_GROUP_MEMBER_MISMATCH");assert_eq!(h.store.0,before);
 h.send_private(input).unwrap();let result=h.private_output("private-result",json!([{"account_id":A,"net":"-21"},{"account_id":B,"net":"0"},{"account_id":C,"net":"21"}]));let before=h.store.0.clone();
 assert_eq!(h.callback("private-result",result).err().unwrap(),"PURCHASE_GROUP_NET_MISMATCH");assert_eq!(h.store.0,before);assert_eq!(h.balance(A)["reserved"],"20");
 h.ctx.now_ms=g.input.deadline_ms;h.ctx.native_free=0;h.expiry(&g).unwrap();h.expiry(&g).unwrap();h.agent("anyone.testnet");h.call("expire_private_request",json!({"id":"private-result"})).unwrap();assert_eq!(h.balance(A)["available"],"20");assert_eq!(h.balance(A)["gross_purchase_budget_used"],"0");h.check(&BTreeMap::from([(A.into(),20)]));
}

#[test]fn finalized_private_receipts_expire_with_their_incomplete_group_without_double_refund(){
 let mut h=Harness::new();h.deposit(A,20);let g=h.private_group("private-expiry");let input=h.private_request(&g,"verify-partial",true);h.send_private(input).unwrap();
 let result=h.private_output("verify-partial",json!([{"account_id":A,"net":"0"},{"account_id":B,"net":"0"}]));h.callback("verify-partial",result).unwrap();
 let charge=g.input.orders[0].charge_id("testnet",V);assert_eq!(h.view("get_private_invoice",json!({"id":charge}))["status"],"ACCEPTED");
 h.ctx.now_ms=g.input.deadline_ms;h.ctx.native_free=0;h.agent("anyone.testnet");h.call("cancel_pending_private_purchase",json!({"id":charge,"expected_hash":g.input.orders[0].order_commitment})).unwrap();h.expiry(&g).unwrap();
 assert_eq!(h.view("get_private_invoice",json!({"id":charge}))["status"],"CANCELLED");assert_eq!(h.balance(A)["available"],"20");assert_eq!(h.balance(A)["gross_purchase_budget_used"],"0");h.check(&BTreeMap::from([(A.into(),20)]));
}

#[test]fn private_ready_settlement_uses_reserved_storage_and_survives_authority_expiry(){
 let mut h=Harness::new();h.deposit(A,20);let g=h.private_group("private-payable");let input=h.private_request(&g,"private-irrevocable",false);h.send_private(input).unwrap();
 let result=h.private_output("private-irrevocable",serde_json::to_value(&g.input.positions).unwrap());let ready=h.callback("private-irrevocable",result).unwrap();assert_eq!(ready.value["status"],"READY");
 h.owner(A);h.call("revoke_agent",json!({})).unwrap();h.ctx.now_ms=3_000_000;h.ctx.native_free=0;assert!(h.expiry(&g).is_err());h.settle("private-irrevocable");h.settle("private-irrevocable");
 assert_eq!(h.view("get_purchase_group",json!({"id":g.input.id}))["status"],"SETTLED");assert_eq!(h.balance(C)["balance"],"20");h.check(&BTreeMap::from([(C.into(),20)]));
}

#[test]fn shared_coordinator_capacity_is_bounded_separately_from_a_visitors_records(){
 let mut h=Harness::new();for _ in 0..150{h.policy(CO,1_000_000);}assert!(h.balance(CO)["sponsored_records"].as_u64().unwrap()>128);
 let mut wallet:Wallet=serde_json::from_slice(&h.store.0[&format!("account:{CO}")]).unwrap();wallet.sponsored_records=4096;h.store.0.insert(format!("account:{CO}"),serde_json::to_vec(&wallet).unwrap());let before=h.store.0.clone();h.owner(CO);assert_eq!(h.call("set_agent_policy",json!({"key":"a".repeat(64),"max_invoice":"1000000","gross_budget":"1000000","max_net_commitment":"1000000","expires_at_ms":2_000_000,"counterparties":[],"services":[]})).err().unwrap(),"SPONSORED_RECORD_LIMIT");assert_eq!(h.store.0,before);
}
