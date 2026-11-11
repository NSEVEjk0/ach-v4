use ach_protocol::*;
use ach_runtime::{Call,Context,Store,Transaction};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};

const CONFIG:&str="config";
const ACTIVE_LIMIT:u32=4;
const SAFETY_FLOOR:u128=200_000_000_000_000_000_000_000;
const TGAS:u64=1_000_000_000_000;

#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Config {
    pub protocol_version:u32,pub network:String,pub vault:String,pub token:String,
    pub decimals:u8,pub owner_id:String,pub coordinator_id:String,
    pub private_worker:Option<PrivateWorker>,
    pub total_balances:Amount,pub pending_withdrawals:Amount,pub tracked_token_custody:Amount,
    pub accounts:u64,pub invoices:u64,pub rounds:u64,pub withdrawals:u64,pub settled_rounds:u64,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct PrivateWorker {pub outlayer_account:String,pub url:String,pub hash:String,pub profile:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Wallet {pub account_id:String,pub name:String,pub balance:Amount,pub reserved:Amount,pub pending_withdrawals:Amount,pub policy_epoch:u64,pub active_proposals:u32,pub active_authorizations:u32,pub invoice_count:u64,pub activity_count:u64}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Policy {pub key:String,pub epoch:u64,pub max_invoice:Amount,pub gross_budget:Amount,pub max_net_commitment:Amount,pub expires_at_ms:u64,pub counterparties:Vec<String>,pub services:Vec<String>,pub revoked:bool,pub activity_sequence:u64}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Acceptance {pub owner:bool,pub epoch:u64,pub key:String,pub budget_charge:Amount}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Invoice {pub spec:InvoiceSpec,pub hash:String,pub charge_id:String,pub status:String,pub buyer_acceptance:Option<Acceptance>,pub seller_acceptance:Option<Acceptance>,pub buyer_cancelled:bool,pub seller_cancelled:bool,pub round_id:Option<String>,pub sequence:u64,pub buyer_activity_sequence:u64,pub seller_activity_sequence:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Approval {pub account_id:String,pub expected_net:String,pub authority:Acceptance,pub required:Amount,pub approved_at_ms:u64,pub activity_sequence:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Round {pub input:RoundInput,pub hash:String,pub proposer:String,pub status:String,pub approvals:Vec<Approval>,pub gross_invoice_volume:Option<Amount>,pub net_settlement_volume:Amount,pub created_at_ms:u64,pub ready_at_ms:Option<u64>,pub settled_at_ms:Option<u64>,pub sequence:u64,pub reason:Option<String>}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Withdrawal {pub id:String,pub account_id:String,pub receiver_id:String,pub amount:Amount,pub status:String,pub requested_at_ms:u64,pub completed_at_ms:Option<u64>,pub sequence:u64,pub activity_sequence:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Activity {pub sequence:u64,pub at_ms:u64,pub kind:String,pub reference:String,pub amount:Option<Amount>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct PolicySnapshot {pub account_id:String,pub policy:Policy}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct PrivateRequest {pub id:String,pub requester:String,pub input_commitment:String,pub profile:String,pub deadline_ms:u64,pub worker_hash:String,pub policies:Vec<PolicySnapshot>,pub prior_charges:Vec<PrivateCharge>,pub invoice_commitments:Vec<(String,String)>,#[serde(default)]pub verification_only:bool,pub status:String}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct PrivateCharge {pub nullifier:String,pub commitment:String,pub buyer:String,pub policy_epoch:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct PrivateInvoice {pub charge:PrivateCharge,pub budget_charge:Amount,pub status:String,pub round_id:Option<String>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct PrivatePurchaseAuthorization {pub charge_id:String,pub purchase_id:String,pub terms_version:u32,pub buyer:String,pub seller:String,pub order_commitment:String,pub policy_epoch:u64,pub budget_charge:Amount,pub status:String,#[serde(default)]pub buyer_cancelled:bool,#[serde(default)]pub seller_cancelled:bool}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateResult {pub protocol_version:u32,pub operation:String,pub request_id:String,pub input_commitment:String,pub worker_hash:String,pub deadline_ms:u64,pub positions:Vec<Position>,pub charges:Vec<PrivateCharge>,pub policy_epochs:Vec<PolicySnapshot>,pub previous_nullifiers:Vec<String>}
#[derive(Deserialize,Serialize)]#[serde(deny_unknown_fields)]struct PrivateDisclosureSignature {account_id:String,key_epoch:u64,signature:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivateEncryptionKey {pub protocol_version:u32,pub worker_hash:String,pub public_key:String,pub algorithm:String}

#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Init {network:String,token:String,owner_id:String,coordinator_id:String,private_worker:Option<PrivateWorker>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Register {name:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct AuthorizePrivatePurchase {purchase_id:String,terms_version:u32,seller:String,order_commitment:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct SetPolicy {key:String,max_invoice:Amount,gross_budget:Amount,max_net_commitment:Amount,expires_at_ms:u64,counterparties:Vec<String>,services:Vec<String>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct InvoiceArgs {spec:InvoiceSpec}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct ExactInvoice {id:String,expected_hash:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct RoundArgs {id:String,invoice_ids:Vec<String>,deadline_ms:u64}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Authorize {id:String,expected_hash:String,expected_net:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct ExactRound {id:String,expected_hash:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct Id {id:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct AccountArgs {account_id:String}
#[derive(Deserialize,Default)]#[serde(deny_unknown_fields)]struct ListArgs {#[serde(default)]cursor:u64,#[serde(default="page_size")]limit:u32,account_id:Option<String>}
fn page_size()->u32{25}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct TokenDeposit {sender_id:String,amount:Amount,msg:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct WithdrawalArgs {id:String,amount:Amount,receiver_id:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct RecoveryWithdrawalArgs {nonce:u64,expected_available:Amount}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct PrivateArgs {id:String,input_commitment:String,profile:String,members:Vec<String>,deadline_ms:u64,encrypted_invoices:Vec<EncryptedInvoice>,#[serde(default)]verification_only:bool,#[serde(default)]disclosure_signatures:Vec<PrivateDisclosureSignature>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct PinWorker {worker:PrivateWorker}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]struct KeyRequest {profile:String}

fn args<T:serde::de::DeserializeOwned>(v:Value)->Result<T>{serde_json::from_value(v).map_err(|_|"INVALID_ARGUMENTS".into())}
fn value<T:Serialize>(v:&T)->Result<Value>{serde_json::to_value(v).map_err(|_|"ENCODING_FAILED".into())}
fn key(prefix:&str,id:&str)->String{format!("{prefix}:{id}")}

pub struct Execution {pub value:Value,pub calls:Vec<Call>,pub events:Vec<Value>}
struct Vault<'a,S:Store>{s:Transaction<'a,S>,ctx:&'a Context,c:Config,calls:Vec<Call>,events:Vec<Value>,recovery:bool}
impl<'a,S:Store> Vault<'a,S>{
    fn wallet(&self,id:&str)->Result<Wallet>{self.s.read(&key("account",id))?.ok_or_else(||"ACCOUNT_NOT_REGISTERED".into())}
    fn save_wallet(&mut self,w:&Wallet)->Result<()>{self.s.write(&key("account",&w.account_id),w)}
    fn invoice(&self,id:&str)->Result<Invoice>{self.s.read(&key("invoice",id))?.ok_or_else(||"INVOICE_NOT_FOUND".into())}
    fn save_invoice(&mut self,i:&Invoice)->Result<()>{self.s.write(&key("invoice",&i.spec.id),i)}
    fn round(&self,id:&str)->Result<Round>{self.s.read(&key("round",id))?.ok_or_else(||"ROUND_NOT_FOUND".into())}
    fn save_round(&mut self,r:&Round)->Result<()>{self.s.write(&key("round",&r.input.id),r)}
    fn policy(&self,id:&str)->Result<Policy>{self.s.read(&key("policy",id))?.ok_or_else(||"AGENT_POLICY_REQUIRED".into())}
    fn owner(&self)->Result<()> {ensure(self.ctx.predecessor==self.ctx.signer && self.ctx.attached==1,"OWNER_AUTHORIZATION_REQUIRED")}
    fn authority(&self,account:&str,invoice:Option<&InvoiceSpec>,buy:bool)->Result<Acceptance>{
        ensure(self.ctx.predecessor==account && self.ctx.signer==account,"DIRECT_ACCOUNT_AUTHORIZATION_REQUIRED")?;
        if self.ctx.attached==1 {return Ok(Acceptance{owner:true,epoch:0,key:self.ctx.signer_key.clone(),budget_charge:Amount(0)});}
        ensure(self.ctx.attached==0,"INVALID_ATTACHED_DEPOSIT")?;
        let p=self.policy(account)?;
        ensure(!p.revoked && p.key==self.ctx.signer_key && p.expires_at_ms>self.ctx.now_ms,"AGENT_AUTHORITY_EXPIRED_OR_REVOKED")?;
        if let Some(i)=invoice {
            let counterparty=if buy {&i.seller}else{&i.buyer};
            ensure(p.counterparties.is_empty() || p.counterparties.contains(counterparty),"COUNTERPARTY_NOT_ALLOWED")?;
            ensure(p.services.is_empty() || p.services.contains(&i.service),"SERVICE_NOT_ALLOWED")?;
            ensure(i.amount.0<=p.max_invoice.0,"INVOICE_PERMISSION_LIMIT")?;
        }
        Ok(Acceptance{owner:false,epoch:p.epoch,key:p.key,budget_charge:Amount(0)})
    }
    fn approval_valid(&self,a:&Approval)->Result<bool>{
        if a.authority.owner{return Ok(true)}
        let p=self.policy(&a.account_id)?;
        Ok(!p.revoked && p.epoch==a.authority.epoch && p.key==a.authority.key && p.expires_at_ms>self.ctx.now_ms && a.required.0<=p.max_net_commitment.0)
    }
    fn budget_spent(&self,account:&str,epoch:u64)->Result<Amount>{Ok(self.s.read(&format!("budget:{account}:{epoch}"))?.unwrap_or_default())}
    fn charge_budget(&mut self,account:&str,a:&mut Acceptance,amount:u128)->Result<()> {
        if a.owner{return Ok(())}
        let p=self.policy(account)?;let spent=self.budget_spent(account,a.epoch)?;
        let next=add(spent.0,amount)?;ensure(next<=p.gross_budget.0,"GROSS_PURCHASE_BUDGET_EXCEEDED")?;
        self.s.write(&format!("budget:{account}:{}",a.epoch),&Amount(next))?;a.budget_charge=Amount(amount);Ok(())
    }
    fn activity(&mut self,account:&str,kind:&str,reference:&str,amount:Option<Amount>)->Result<()> {
        let mut w=self.wallet(account)?;let n=w.activity_count;w.activity_count+=1;self.save_wallet(&w)?;
        self.s.write(&format!("activity:{account}:{n}"),&Activity{sequence:n,at_ms:self.ctx.now_ms,kind:kind.into(),reference:reference.into(),amount})?;
        self.events.push(json!({"standard":"ach","version":"4.0.0","event":kind,"data":[{"account_id":account,"reference":reference,"amount":amount,"at_ms":self.ctx.now_ms}]}));Ok(())
    }
    fn finish_activity(&mut self,account:&str,sequence:u64,kind:&str,reference:&str,amount:Option<Amount>)->Result<()> {
        let k=format!("activity:{account}:{sequence}");ensure(self.s.get(&k).is_some(),"ACTIVITY_SLOT_MISSING")?;
        self.s.write(&k,&Activity{sequence,at_ms:self.ctx.now_ms,kind:kind.into(),reference:reference.into(),amount})?;
        self.events.push(json!({"standard":"ach","version":"4.0.0","event":kind,"data":[{"account_id":account,"reference":reference,"amount":amount,"at_ms":self.ctx.now_ms}]}));Ok(())
    }
    fn register(&mut self,a:Register)->Result<Value>{
        ensure(self.ctx.predecessor==self.ctx.signer && self.ctx.attached<=1,"DIRECT_ACCOUNT_AUTHORIZATION_REQUIRED")?;
        valid_account(&self.ctx.predecessor)?;ensure(!a.name.is_empty() && a.name.len()<=64 && !a.name.chars().any(char::is_control),"INVALID_NAME")?;
        if let Some(w)=self.s.read::<Wallet>(&key("account",&self.ctx.predecessor))?{ensure(w.name==a.name,"REQUEST_ID_CONFLICT")?;return value(&w)}
        let w=Wallet{account_id:self.ctx.predecessor.clone(),name:a.name,balance:Amount(0),reserved:Amount(0),pending_withdrawals:Amount(0),policy_epoch:0,active_proposals:0,active_authorizations:0,invoice_count:0,activity_count:0};
        self.s.write(&format!("account-index:{}",self.c.accounts),&w.account_id)?;self.c.accounts+=1;self.save_wallet(&w)?;
        let recovery=Withdrawal{id:format!("recovery-0-{}",w.account_id),account_id:w.account_id.clone(),receiver_id:w.account_id.clone(),amount:Amount(0),status:"UNUSED".into(),requested_at_ms:0,completed_at_ms:None,sequence:0,activity_sequence:0};
        self.s.write(&key("recovery-withdrawal",&w.account_id),&recovery)?;self.activity(&w.account_id,"recovery-slot-reserved",&recovery.id,None)?;value(&w)
    }
    fn set_policy(&mut self,a:SetPolicy)->Result<Value>{
        self.owner()?;let mut w=self.wallet(&self.ctx.predecessor)?;valid_hash(&a.key)?;
        ensure(a.max_invoice.0>0 && a.expires_at_ms>self.ctx.now_ms && a.expires_at_ms<=self.ctx.now_ms+30*86_400_000 && a.counterparties.len()<=32 && a.services.len()<=32,"INVALID_POLICY")?;
        for c in &a.counterparties{valid_account(c)?;}for s in &a.services{valid_id(s)?;}
        w.policy_epoch=w.policy_epoch.checked_add(1).ok_or("POLICY_EPOCH_OVERFLOW")?;
        let p=Policy{key:a.key,epoch:w.policy_epoch,max_invoice:a.max_invoice,gross_budget:a.gross_budget,max_net_commitment:a.max_net_commitment,expires_at_ms:a.expires_at_ms,counterparties:a.counterparties,services:a.services,revoked:false,activity_sequence:w.activity_count};
        self.s.write(&key("policy",&w.account_id),&p)?;self.save_wallet(&w)?;self.activity(&w.account_id,"policy-set",&p.epoch.to_string(),None)?;value(&p)
    }
    fn revoke(&mut self)->Result<Value>{self.owner()?;let id=self.ctx.predecessor.clone();let mut p=self.policy(&id)?;if p.revoked{return value(&p)}p.revoked=true;self.s.write(&key("policy",&id),&p)?;self.recovery=true;self.finish_activity(&id,p.activity_sequence,"agent-revoked",&p.epoch.to_string(),None)?;value(&p)}
    fn deposit(&mut self,a:TokenDeposit)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.token,"TOKEN_CALLBACK_ONLY")?;
        ensure(a.msg.is_empty() || a.msg=="deposit","INVALID_DEPOSIT_MESSAGE")?;
        ensure(a.amount.0>0,"INVALID_AMOUNT")?;let mut w=self.wallet(&a.sender_id)?;
        w.balance=Amount(add(w.balance.0,a.amount.0)?);self.c.total_balances=Amount(add(self.c.total_balances.0,a.amount.0)?);self.c.tracked_token_custody=Amount(add(self.c.tracked_token_custody.0,a.amount.0)?);
        self.save_wallet(&w)?;self.activity(&w.account_id,"deposit",&self.c.token.clone(),Some(a.amount))?;Ok(json!("0"))
    }
    fn propose_invoice(&mut self,a:InvoiceArgs)->Result<Value>{
        a.spec.validate(&self.c.token)?;
        ensure(self.ctx.predecessor==a.spec.buyer || self.ctx.predecessor==a.spec.seller,"INVOICE_PARTY_REQUIRED")?;
        self.authority(&self.ctx.predecessor,Some(&a.spec),self.ctx.predecessor==a.spec.buyer)?;
        let h=a.spec.hash(&self.c.network,&self.c.vault);
        if let Some(i)=self.s.read::<Invoice>(&key("invoice",&a.spec.id))?{ensure(i.hash==h,"REQUEST_ID_CONFLICT")?;return value(&i)}
        ensure(a.spec.expires_at_ms>self.ctx.now_ms && a.spec.expires_at_ms<=self.ctx.now_ms+7*86_400_000,"INVALID_DEADLINE")?;
        self.wallet(&a.spec.buyer)?;self.wallet(&a.spec.seller)?;
        let charge=a.spec.charge_id(&self.c.network,&self.c.vault);ensure(self.s.get(&key("charge",&charge)).is_none(),"PURCHASE_ALREADY_INVOICED")?;
        let buyer_activity_sequence=self.wallet(&a.spec.buyer)?.activity_count;let seller_activity_sequence=self.wallet(&a.spec.seller)?.activity_count;
        let i=Invoice{spec:a.spec,hash:h,charge_id:charge.clone(),status:"PROPOSED".into(),buyer_acceptance:None,seller_acceptance:None,buyer_cancelled:false,seller_cancelled:false,round_id:None,sequence:self.c.invoices,buyer_activity_sequence,seller_activity_sequence};
        self.s.write(&key("charge",&charge),&json!({"mode":"public","id":i.spec.id,"commitment":i.hash}))?;
        self.s.write(&format!("invoice-index:{}",self.c.invoices),&i.spec.id)?;self.c.invoices+=1;self.save_invoice(&i)?;
        for party in [&i.spec.buyer,&i.spec.seller]{let mut w=self.wallet(party)?;self.s.write(&format!("account-invoice:{party}:{}",w.invoice_count),&i.spec.id)?;w.invoice_count+=1;self.save_wallet(&w)?;self.activity(party,"invoice-proposed",&i.spec.id,Some(i.spec.amount))?;}value(&i)
    }
    fn accept_invoice(&mut self,a:ExactInvoice)->Result<Value>{
        let mut i=self.invoice(&a.id)?;ensure(i.hash==a.expected_hash,"INVOICE_HASH_MISMATCH")?;
        let buy=self.ctx.predecessor==i.spec.buyer;ensure(buy || self.ctx.predecessor==i.spec.seller,"INVOICE_PARTY_REQUIRED")?;
        let mut authority=self.authority(&self.ctx.predecessor,Some(&i.spec),buy)?;
        if if buy {i.buyer_acceptance.is_some()}else{i.seller_acceptance.is_some()}{return value(&i)}
        ensure(i.status=="PROPOSED" && self.ctx.now_ms<i.spec.expires_at_ms,"INVOICE_NOT_ACCEPTABLE")?;
        if buy {self.charge_budget(&i.spec.buyer,&mut authority,i.spec.amount.0)?;i.buyer_acceptance=Some(authority);}else{i.seller_acceptance=Some(authority);}
        if i.buyer_acceptance.is_some() && i.seller_acceptance.is_some(){i.status="ACCEPTED".into();}
        self.save_invoice(&i)?;self.finish_activity(&self.ctx.predecessor.clone(),if buy{i.buyer_activity_sequence}else{i.seller_activity_sequence},"invoice-authorized",&i.spec.id,Some(i.spec.amount))?;value(&i)
    }
    fn cancel_invoice(&mut self,a:ExactInvoice)->Result<Value>{
        let mut i=self.invoice(&a.id)?;ensure(i.hash==a.expected_hash,"INVOICE_HASH_MISMATCH")?;
        let buy=self.ctx.predecessor==i.spec.buyer;ensure(buy || self.ctx.predecessor==i.spec.seller,"INVOICE_PARTY_REQUIRED")?;self.authority(&self.ctx.predecessor,Some(&i.spec),buy)?;
        if i.status=="CANCELLED"{return value(&i)}
        ensure(matches!(i.status.as_str(),"PROPOSED"|"ACCEPTED"),"INVOICE_ALREADY_COMMITTED")?;
        if buy{i.buyer_cancelled=true}else{i.seller_cancelled=true}
        if i.buyer_cancelled && i.seller_cancelled{
            i.status="CANCELLED".into();
            if let Some(a)=&i.buyer_acceptance{if a.budget_charge.0>0{let k=format!("budget:{}:{}",i.spec.buyer,a.epoch);let spent=self.budget_spent(&i.spec.buyer,a.epoch)?;self.s.write(&k,&Amount(sub(spent.0,a.budget_charge.0)?))?;}}
        }
        self.recovery=true;self.save_invoice(&i)?;self.finish_activity(&self.ctx.predecessor.clone(),if buy{i.buyer_activity_sequence}else{i.seller_activity_sequence},"invoice-cancellation",&i.spec.id,None)?;value(&i)
    }
    fn validate_deadline(&self,deadline:u64)->Result<()>{ensure(deadline>self.ctx.now_ms && deadline<=self.ctx.now_ms+900_000,"INVALID_ROUND_DEADLINE")}
    fn add_proposal(&mut self,proposer:&str)->Result<()> {let mut w=self.wallet(proposer)?;ensure(w.active_proposals<ACTIVE_LIMIT,"ACTIVE_PROPOSAL_LIMIT")?;w.active_proposals+=1;self.save_wallet(&w)}
    fn propose_round(&mut self,a:RoundArgs)->Result<Value>{
        valid_id(&a.id)?;ensure(!a.invoice_ids.is_empty() && a.invoice_ids.len()<=MAX_INVOICES,"ROUND_INVOICE_LIMIT")?;
        let mut ids=a.invoice_ids;ids.sort();ensure(!ids.windows(2).any(|w|w[0]==w[1]),"DUPLICATE_INVOICE")?;
        let invoices=ids.iter().map(|id|self.invoice(id)).collect::<Result<Vec<_>>>()?;
        let plan=net_invoices(&invoices.iter().map(|i|i.spec.clone()).collect::<Vec<_>>())?;
        let input=RoundInput{id:a.id,invoice_ids:ids,invoice_hashes:invoices.iter().map(|i|i.hash.clone()).collect(),positions:plan.positions,deadline_ms:a.deadline_ms,private:false,input_commitment:String::new(),worker_hash:String::new()};
        ensure(input.positions.iter().any(|p|p.account_id==self.ctx.predecessor) || self.ctx.predecessor==self.c.coordinator_id,"ROUND_PARTICIPANT_REQUIRED")?;
        if self.ctx.predecessor!=self.c.coordinator_id {self.authority(&self.ctx.predecessor,None,false)?;}else{ensure(self.ctx.signer==self.ctx.predecessor && self.ctx.attached==0,"DIRECT_COORDINATOR_REQUIRED")?;}
        let h=input.hash(&self.c.network,&self.c.vault)?;
        if let Some(r)=self.s.read::<Round>(&key("round",&input.id))?{ensure(r.hash==h,"REQUEST_ID_CONFLICT")?;return value(&r)}
        self.validate_deadline(a.deadline_ms)?;
        for i in &invoices{ensure(i.status=="ACCEPTED" && i.spec.ready_at_ms<=self.ctx.now_ms,"INVOICE_NOT_ELIGIBLE")?;}
        let proposer=self.ctx.predecessor.clone();self.add_proposal(&proposer)?;
        let r=Round{input,hash:h,proposer,status:"COLLECTING".into(),approvals:vec![],gross_invoice_volume:Some(plan.gross_invoice_volume),net_settlement_volume:plan.net_settlement_volume,created_at_ms:self.ctx.now_ms,ready_at_ms:None,settled_at_ms:None,sequence:self.c.rounds,reason:None};
        self.index_round(&r)?;value(&r)
    }
    fn index_round(&mut self,r:&Round)->Result<()> {self.s.write(&format!("round-index:{}",self.c.rounds),&r.input.id)?;self.c.rounds+=1;self.save_round(r)?;for p in &r.input.positions{self.activity(&p.account_id,"round-proposed",&r.input.id,None)?;}Ok(())}
    fn eligible(&self,r:&Round)->Result<bool>{
        for (id,h) in r.input.invoice_ids.iter().zip(&r.input.invoice_hashes){
            if r.input.private {let i=self.s.read::<PrivateInvoice>(&key("private-invoice",id))?.ok_or("PRIVATE_INVOICE_NOT_FOUND")?;if i.status!="ACCEPTED" || i.charge.commitment!=*h{return Ok(false)}}
            else{let i=self.invoice(id)?;if i.status!="ACCEPTED" || i.hash!=*h || i.spec.ready_at_ms>self.ctx.now_ms{return Ok(false)}}
        }Ok(true)
    }
    fn release(&mut self,r:&mut Round,status:&str,reason:&str)->Result<()> {
        ensure(r.status=="COLLECTING","ROUND_IS_IRREVOCABLE")?;
        for a in &r.approvals{let mut w=self.wallet(&a.account_id)?;w.reserved=Amount(sub(w.reserved.0,a.required.0)?);w.active_authorizations=w.active_authorizations.checked_sub(1).ok_or("AUTHORIZATION_COUNT_CORRUPT")?;self.save_wallet(&w)?;self.finish_activity(&a.account_id,a.activity_sequence,"round-released",&r.input.id,Some(a.required))?;}
        let mut proposer=self.wallet(&r.proposer)?;proposer.active_proposals=proposer.active_proposals.checked_sub(1).ok_or("PROPOSAL_COUNT_CORRUPT")?;self.save_wallet(&proposer)?;
        r.status=status.into();r.reason=Some(reason.into());self.save_round(r)?;self.recovery=true;Ok(())
    }
    fn authorize_round(&mut self,a:Authorize)->Result<Value>{
        let mut r=self.round(&a.id)?;ensure(r.hash==a.expected_hash,"ROUND_HASH_MISMATCH")?;
        let p=r.input.positions.iter().find(|p|p.account_id==self.ctx.predecessor).cloned().ok_or("ROUND_PARTICIPANT_REQUIRED")?;
        ensure(p.net==a.expected_net,"EXACT_NET_AUTHORIZATION_REQUIRED")?;let authority=self.authority(&p.account_id,None,false)?;
        if r.approvals.iter().any(|a|a.account_id==p.account_id){return value(&r)}
        ensure(r.status=="COLLECTING","ROUND_NOT_COLLECTING")?;
        if self.ctx.now_ms>=r.input.deadline_ms{self.release(&mut r,"EXPIRED","approval deadline elapsed")?;return value(&r)}
        if !self.eligible(&r)?{self.release(&mut r,"STALE","an invoice is no longer eligible")?;return value(&r)}
        for approval in &r.approvals{if !self.approval_valid(approval)?{self.release(&mut r,"STALE","an authorization expired or was revoked")?;return value(&r)}}
        let required=p.required()?;
        if !authority.owner{ensure(required<=self.policy(&p.account_id)?.max_net_commitment.0,"NET_COMMITMENT_PERMISSION_LIMIT")?;}
        let mut w=self.wallet(&p.account_id)?;ensure(w.active_authorizations<ACTIVE_LIMIT,"ACTIVE_AUTHORIZATION_LIMIT")?;
        ensure(required<=sub(w.balance.0,w.reserved.0)?,"INSUFFICIENT_AVAILABLE_BALANCE")?;
        w.reserved=Amount(add(w.reserved.0,required)?);w.active_authorizations+=1;self.save_wallet(&w)?;
        r.approvals.push(Approval{account_id:p.account_id.clone(),expected_net:p.net,authority,required:Amount(required),approved_at_ms:self.ctx.now_ms,activity_sequence:w.activity_count});
        self.activity(&p.account_id,"round-authorized",&r.input.id,Some(Amount(required)))?;
        if r.approvals.len()==r.input.positions.len(){
            for approval in &r.approvals{if !self.approval_valid(approval)?{self.release(&mut r,"STALE","an authorization expired or was revoked")?;return value(&r)}}
            ensure(self.eligible(&r)?,"INVOICE_CLAIM_CONFLICT")?;
            for id in &r.input.invoice_ids{
                if r.input.private{let mut i=self.s.read::<PrivateInvoice>(&key("private-invoice",id))?.ok_or("PRIVATE_INVOICE_NOT_FOUND")?;i.status="READY".into();i.round_id=Some(r.input.id.clone());self.s.write(&key("private-invoice",id),&i)?;}
                else{let mut i=self.invoice(id)?;i.status="READY".into();i.round_id=Some(r.input.id.clone());self.save_invoice(&i)?;}
            }
            r.status="READY".into();r.ready_at_ms=Some(self.ctx.now_ms);
        }
        self.save_round(&r)?;value(&r)
    }
    fn cancel_round(&mut self,a:ExactRound)->Result<Value>{
        let mut r=self.round(&a.id)?;ensure(r.hash==a.expected_hash,"ROUND_HASH_MISMATCH")?;
        ensure(r.proposer==self.ctx.predecessor || r.approvals.iter().any(|a|a.account_id==self.ctx.predecessor),"OWN_APPROVAL_REQUIRED")?;
        if self.ctx.predecessor==self.c.coordinator_id{ensure(self.ctx.predecessor==self.ctx.signer && self.ctx.attached==0,"DIRECT_COORDINATOR_REQUIRED")?;}else{self.authority(&self.ctx.predecessor,None,false)?;}
        if matches!(r.status.as_str(),"CANCELLED"|"EXPIRED"|"STALE"){return value(&r)}
        self.release(&mut r,"CANCELLED","a participant withdrew consent")?;value(&r)
    }
    fn expire(&mut self,a:Id,stale:bool)->Result<Value>{
        let mut r=self.round(&a.id)?;if matches!(r.status.as_str(),"CANCELLED"|"EXPIRED"|"STALE"){return value(&r)}
        ensure(r.status=="COLLECTING","ROUND_IS_IRREVOCABLE")?;
        if stale{
            let mut invalid=!self.eligible(&r)?;for approval in &r.approvals{invalid|=!self.approval_valid(approval)?;}
            ensure(invalid,"ROUND_NOT_STALE")?;self.release(&mut r,"STALE","a competing claim or authorization changed")?;
        }else{ensure(self.ctx.now_ms>=r.input.deadline_ms,"ROUND_NOT_EXPIRED")?;self.release(&mut r,"EXPIRED","approval deadline elapsed")?;}
        value(&r)
    }
    fn settle(&mut self,a:ExactRound)->Result<Value>{
        let mut r=self.round(&a.id)?;ensure(r.hash==a.expected_hash,"ROUND_HASH_MISMATCH")?;
        if r.status=="SETTLED"{return value(&r)}ensure(r.status=="READY","ROUND_NOT_FUNDED")?;
        ensure(r.approvals.len()==r.input.positions.len(),"INCOMPLETE_COMMITMENT")?;validate_positions(&r.input.positions)?;
        for p in &r.input.positions{
            let mut w=self.wallet(&p.account_id)?;let required=p.required()?;
            ensure(w.reserved.0>=required && w.balance.0>=required,"RESERVATION_INVARIANT")?;
            w.reserved=Amount(sub(w.reserved.0,required)?);
            w.balance=Amount(if p.value()?<0{sub(w.balance.0,required)?}else{add(w.balance.0,p.value()? as u128)?});
            w.active_authorizations=w.active_authorizations.checked_sub(1).ok_or("AUTHORIZATION_COUNT_CORRUPT")?;self.save_wallet(&w)?;
        }
        for id in &r.input.invoice_ids{
            if r.input.private{let mut i=self.s.read::<PrivateInvoice>(&key("private-invoice",id))?.ok_or("PRIVATE_INVOICE_NOT_FOUND")?;ensure(i.status=="READY" && i.round_id.as_deref()==Some(&r.input.id),"INVOICE_CLAIM_INVARIANT")?;i.status="SETTLED".into();self.s.write(&key("private-invoice",id),&i)?;}
            else{let mut i=self.invoice(id)?;ensure(i.status=="READY" && i.round_id.as_deref()==Some(&r.input.id),"INVOICE_CLAIM_INVARIANT")?;i.status="SETTLED".into();self.save_invoice(&i)?;}
        }
        let mut w=self.wallet(&r.proposer)?;w.active_proposals=w.active_proposals.checked_sub(1).ok_or("PROPOSAL_COUNT_CORRUPT")?;self.save_wallet(&w)?;
        r.status="SETTLED".into();r.settled_at_ms=Some(self.ctx.now_ms);self.c.settled_rounds+=1;self.save_round(&r)?;self.recovery=true;
        // Activity is compact and separate from the settlement calculation.
        for p in &r.input.positions{let approval=r.approvals.iter().find(|a|a.account_id==p.account_id).ok_or("APPROVAL_MISSING")?;self.finish_activity(&p.account_id,approval.activity_sequence,"round-settled",&r.input.id,Some(Amount(p.value()?.unsigned_abs())))?;}value(&r)
    }
    fn withdraw(&mut self,a:WithdrawalArgs)->Result<Value>{
        self.owner()?;let account=self.ctx.predecessor.clone();valid_id(&a.id)?;valid_account(&a.receiver_id)?;
        ensure(!a.id.starts_with("recovery-"),"RESERVED_WITHDRAWAL_ID")?;
        ensure(a.receiver_id==account,"OWNER_CONTROLLED_RECEIVER_REQUIRED")?;ensure(a.amount.0>0,"INVALID_AMOUNT")?;
        if let Some(w)=self.s.read::<Withdrawal>(&key("withdrawal",&a.id))?{ensure(w.account_id==account && w.amount==a.amount && w.receiver_id==a.receiver_id,"REQUEST_ID_CONFLICT")?;return value(&w)}
        let mut wallet=self.wallet(&account)?;ensure(a.amount.0<=sub(wallet.balance.0,wallet.reserved.0)?,"INSUFFICIENT_AVAILABLE_BALANCE")?;
        wallet.balance=Amount(sub(wallet.balance.0,a.amount.0)?);wallet.pending_withdrawals=Amount(add(wallet.pending_withdrawals.0,a.amount.0)?);self.c.total_balances=Amount(sub(self.c.total_balances.0,a.amount.0)?);self.c.pending_withdrawals=Amount(add(self.c.pending_withdrawals.0,a.amount.0)?);
        let w=Withdrawal{id:a.id,account_id:account.clone(),receiver_id:a.receiver_id,amount:a.amount,status:"PENDING".into(),requested_at_ms:self.ctx.now_ms,completed_at_ms:None,sequence:self.c.withdrawals,activity_sequence:wallet.activity_count};
        self.s.write(&key("withdrawal",&w.id),&w)?;self.s.write(&format!("withdrawal-index:{}",self.c.withdrawals),&w.id)?;self.c.withdrawals+=1;self.save_wallet(&wallet)?;self.activity(&account,"withdrawal-requested",&w.id,Some(w.amount))?;
        let callback=Call{receiver:self.c.vault.clone(),method:"withdrawal_callback".into(),args:json!({"id":w.id}),deposit:"0".into(),gas:30*TGAS,callback:None};
        self.calls.push(Call{receiver:self.c.token.clone(),method:"ft_transfer".into(),args:json!({"receiver_id":w.receiver_id,"amount":w.amount,"memo":format!("ach-v4:{}",w.id)}),deposit:"1".into(),gas:25*TGAS,callback:Some(Box::new(callback))});value(&w)
    }
    fn withdrawal_callback(&mut self,a:Id)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.vault && self.ctx.promise_results.len()==1,"PRIVATE_CALLBACK_ONLY")?;
        let recovery=a.id.starts_with("recovery-");
        let storage_key=if recovery{let account=a.id.splitn(3,'-').nth(2).ok_or("WITHDRAWAL_NOT_FOUND")?;key("recovery-withdrawal",account)}else{key("withdrawal",&a.id)};
        let mut w=self.s.read::<Withdrawal>(&storage_key)?.ok_or("WITHDRAWAL_NOT_FOUND")?;ensure(w.id==a.id,"WITHDRAWAL_CALLBACK_MISMATCH")?;if w.status!="PENDING"{return value(&w)}
        let mut wallet=self.wallet(&w.account_id)?;wallet.pending_withdrawals=Amount(sub(wallet.pending_withdrawals.0,w.amount.0)?);self.c.pending_withdrawals=Amount(sub(self.c.pending_withdrawals.0,w.amount.0)?);
        if self.ctx.promise_results[0].is_some(){w.status="COMPLETED".into();self.c.tracked_token_custody=Amount(sub(self.c.tracked_token_custody.0,w.amount.0)?);}else{w.status="RESTORED".into();wallet.balance=Amount(add(wallet.balance.0,w.amount.0)?);self.c.total_balances=Amount(add(self.c.total_balances.0,w.amount.0)?);}
        w.completed_at_ms=Some(self.ctx.now_ms);self.save_wallet(&wallet)?;self.s.write(&storage_key,&w)?;self.recovery=true;self.finish_activity(&w.account_id,w.activity_sequence,if w.status=="COMPLETED"{"withdrawal-completed"}else{"withdrawal-restored"},&w.id,Some(w.amount))?;value(&w)
    }
    fn recovery_withdraw(&mut self,a:RecoveryWithdrawalArgs)->Result<Value>{
        self.owner()?;let account=self.ctx.predecessor.clone();let storage_key=key("recovery-withdrawal",&account);
        let mut withdrawal=self.s.read::<Withdrawal>(&storage_key)?.ok_or("RECOVERY_SLOT_MISSING")?;
        if a.nonce==withdrawal.sequence && withdrawal.status!="UNUSED"{ensure(withdrawal.amount==a.expected_available,"REQUEST_ID_CONFLICT")?;return value(&withdrawal)}
        ensure(a.nonce==withdrawal.sequence.checked_add(1).ok_or("RECOVERY_NONCE_OVERFLOW")? && withdrawal.status!="PENDING","RECOVERY_NONCE_OR_PENDING")?;
        let mut wallet=self.wallet(&account)?;let available=sub(wallet.balance.0,wallet.reserved.0)?;
        ensure(available>0 && available==a.expected_available.0,"EXACT_AVAILABLE_BALANCE_REQUIRED")?;
        wallet.balance=Amount(sub(wallet.balance.0,available)?);wallet.pending_withdrawals=Amount(add(wallet.pending_withdrawals.0,available)?);
        self.c.total_balances=Amount(sub(self.c.total_balances.0,available)?);self.c.pending_withdrawals=Amount(add(self.c.pending_withdrawals.0,available)?);
        withdrawal.id=format!("recovery-{}-{account}",a.nonce);withdrawal.sequence=a.nonce;withdrawal.amount=Amount(available);withdrawal.status="PENDING".into();withdrawal.requested_at_ms=self.ctx.now_ms;withdrawal.completed_at_ms=None;
        self.save_wallet(&wallet)?;self.s.write(&storage_key,&withdrawal)?;self.recovery=true;
        self.finish_activity(&account,withdrawal.activity_sequence,"withdrawal-requested",&withdrawal.id,Some(withdrawal.amount))?;
        let cb=Call{receiver:self.c.vault.clone(),method:"withdrawal_callback".into(),args:json!({"id":withdrawal.id}),deposit:"0".into(),gas:30*TGAS,callback:None};
        self.calls.push(Call{receiver:self.c.token.clone(),method:"ft_transfer".into(),args:json!({"receiver_id":account,"amount":withdrawal.amount,"memo":withdrawal.id}),deposit:"1".into(),gas:25*TGAS,callback:Some(Box::new(cb))});value(&withdrawal)
    }
    fn authorize_private_purchase(&mut self,a:AuthorizePrivatePurchase)->Result<Value>{
        ensure(self.c.private_worker.is_some(),"PRIVATE_MODE_UNAVAILABLE")?;
        valid_id(&a.purchase_id)?;valid_account(&a.seller)?;valid_hash(&a.order_commitment)?;
        ensure(a.purchase_id.len()>=32 && a.terms_version>0 && self.ctx.predecessor!=a.seller,"INVALID_PRIVATE_PURCHASE")?;
        let buyer=self.ctx.predecessor.clone();let mut permission=self.authority(&buyer,None,true)?;
        ensure(!permission.owner,"PRIVATE_TRADING_KEY_REQUIRED")?;
        let policy=self.policy(&buyer)?;
        ensure(policy.counterparties.is_empty() || policy.counterparties.contains(&a.seller),"COUNTERPARTY_NOT_ALLOWED")?;
        self.wallet(&a.seller)?;
        let mut canonical=Canonical::new("purchase-charge",&self.c.network,&self.c.vault);
        canonical.field(&buyer).field(&a.purchase_id).field(&a.terms_version.to_string());let charge_id=canonical.hash();
        if let Some(previous)=self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase",&charge_id))?{
            ensure(previous.purchase_id==a.purchase_id && previous.terms_version==a.terms_version && previous.seller==a.seller && previous.order_commitment==a.order_commitment,"REQUEST_ID_CONFLICT")?;
            return value(&previous)
        }
        ensure(self.s.get(&key("charge",&charge_id)).is_none(),"PURCHASE_ALREADY_INVOICED")?;
        self.charge_budget(&buyer,&mut permission,policy.max_invoice.0)?;
        let authorization=PrivatePurchaseAuthorization{charge_id:charge_id.clone(),purchase_id:a.purchase_id,terms_version:a.terms_version,buyer:buyer.clone(),seller:a.seller,order_commitment:a.order_commitment,policy_epoch:permission.epoch,budget_charge:permission.budget_charge,status:"AUTHORIZED".into(),buyer_cancelled:false,seller_cancelled:false};
        self.s.write(&key("private-purchase",&charge_id),&authorization)?;
        self.s.write(&key("charge",&charge_id),&json!({"mode":"private-reserved","id":charge_id}))?;
        self.activity(&buyer,"private-purchase-authorized",&charge_id,None)?;value(&authorization)
    }
    fn cancel_pending_private_purchase(&mut self,a:ExactInvoice)->Result<Value>{
        valid_hash(&a.id)?;valid_hash(&a.expected_hash)?;
        let mut order=self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase",&a.id))?.ok_or("PRIVATE_PURCHASE_NOT_AUTHORIZED")?;
        ensure(order.order_commitment==a.expected_hash,"PRIVATE_ORDER_COMMITMENT_MISMATCH")?;
        let caller=self.ctx.predecessor.clone();let buyer=caller==order.buyer;
        ensure(buyer || caller==order.seller,"INVOICE_PARTY_REQUIRED")?;self.authority(&caller,None,buyer)?;
        if order.status=="CANCELLED"{return value(&order)}
        ensure(order.status=="AUTHORIZED" && self.s.get(&key("private-invoice",&a.id)).is_none(),"PRIVATE_PURCHASE_ALREADY_FINALIZED")?;
        if buyer{order.buyer_cancelled=true}else{order.seller_cancelled=true}
        if order.buyer_cancelled && order.seller_cancelled{
            let budget_key=format!("budget:{}:{}",order.buyer,order.policy_epoch);
            let spent=self.budget_spent(&order.buyer,order.policy_epoch)?;
            self.s.write(&budget_key,&Amount(sub(spent.0,order.budget_charge.0)?))?;
            order.status="CANCELLED".into();
            // Keep the charge tombstone. Changing its representation cannot
            // bill a cancelled order again or release the permission twice.
            self.events.push(json!({"standard":"ach","version":"4.0.0","event":"private-order-cancelled","data":[{"charge_id":order.charge_id}]}));
        }
        self.s.write(&key("private-purchase",&a.id),&order)?;self.recovery=true;value(&order)
    }
    fn private_request(&mut self,a:PrivateArgs)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.coordinator_id && self.ctx.signer==self.ctx.predecessor,"PRIVATE_COORDINATOR_REQUIRED")?;
        let worker=self.c.private_worker.clone().ok_or("PRIVATE_MODE_UNAVAILABLE")?;
        ensure(self.ctx.attached>0 && self.ctx.attached<=50_000_000_000_000_000_000_000,"BOUNDED_SPONSOR_PAYMENT_REQUIRED")?;
        valid_id(&a.id)?;valid_id(&a.profile)?;valid_hash(&a.input_commitment)?;ensure(a.profile==worker.profile,"PRIVATE_PROFILE_MISMATCH")?;
        ensure(!a.encrypted_invoices.is_empty() && a.encrypted_invoices.len()<=MAX_PRIVATE_INVOICES,"PRIVATE_INVOICE_LIMIT")?;
        ensure(serde_json::to_vec(&a.encrypted_invoices).map_err(|_|"ENCODING_FAILED")?.len()<=24_576,"PRIVATE_INPUT_TOO_LARGE")?;
        let mut ids=std::collections::BTreeSet::new();let mut prior_charges=vec![];
        for envelope in &a.encrypted_invoices{envelope.validate()?;ensure(ids.insert(envelope.nullifier.clone()),"DUPLICATE_PRIVATE_CHARGE")?;
            if let Some(i)=self.s.read::<PrivateInvoice>(&key("private-invoice",&envelope.nullifier))?{ensure(i.status=="ACCEPTED" && i.charge.commitment==envelope.commitment,"PRIVATE_CHARGE_ALREADY_COMMITTED")?;prior_charges.push(i.charge);}
            else{let auth=self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase",&envelope.nullifier))?.ok_or("PRIVATE_PURCHASE_NOT_AUTHORIZED")?;ensure(auth.status=="AUTHORIZED","PRIVATE_PURCHASE_ALREADY_FINALIZED")?;}
        }prior_charges.sort_by(|a,b|a.nullifier.cmp(&b.nullifier));
        let mut invoice_commitments=a.encrypted_invoices.iter().map(|e|(e.nullifier.clone(),e.commitment.clone())).collect::<Vec<_>>();invoice_commitments.sort();
        let mut hashes=invoice_commitments.iter().map(|(_,h)|h.as_str()).collect::<Vec<_>>();hashes.sort();
        let mut binding=Canonical::new("private-input",&self.c.network,&self.c.vault);binding.field(&a.id).field(&a.deadline_ms.to_string()).field(&worker.hash).count(hashes.len());for h in hashes{binding.field(h);}
        ensure(binding.hash()==a.input_commitment,"PRIVATE_INPUT_COMMITMENT_MISMATCH")?;
        let mut members=a.members;members.sort();ensure((2..=MAX_MEMBERS).contains(&members.len()) && !members.windows(2).any(|w|w[0]==w[1]),"ROUND_MEMBER_LIMIT")?;
        let policies=members.iter().map(|id|{self.wallet(id)?;let p=self.policy(id)?;ensure(!p.revoked && p.expires_at_ms>a.deadline_ms,"PRIVATE_SIGNER_UNAVAILABLE")?;Ok(PolicySnapshot{account_id:id.clone(),policy:p})}).collect::<Result<Vec<_>>>()?;
        if a.verification_only{ensure(a.disclosure_signatures.is_empty(),"PRIVATE_OPERATION_INVALID")?;}
        else{
            ensure(a.disclosure_signatures.len()==members.len(),"PRIVATE_DISCLOSURE_CONSENT_REQUIRED")?;
            let mut signers=std::collections::BTreeSet::new();
            for signature in &a.disclosure_signatures{
                ensure(policies.iter().any(|p|p.account_id==signature.account_id && p.policy.epoch==signature.key_epoch)
                    && signers.insert(&signature.account_id) && signature.signature.len()==88,"PRIVATE_DISCLOSURE_SIGNATURE_INVALID")?;
            }
        }
        if let Some(r)=self.s.read::<PrivateRequest>(&key("private-request",&a.id))?{ensure(r.input_commitment==a.input_commitment && r.deadline_ms==a.deadline_ms && r.profile==a.profile && r.invoice_commitments==invoice_commitments && r.verification_only==a.verification_only && r.policies.iter().map(|p|&p.account_id).eq(members.iter()),"REQUEST_ID_CONFLICT")?;return value(&r)}
        ensure(self.s.get(&key("round",&a.id)).is_none(),"REQUEST_ID_CONFLICT")?;self.validate_deadline(a.deadline_ms)?;
        let requester=self.ctx.predecessor.clone();self.add_proposal(&requester)?;
        let r=PrivateRequest{id:a.id,requester,input_commitment:a.input_commitment,profile:a.profile,deadline_ms:a.deadline_ms,worker_hash:worker.hash.clone(),policies,prior_charges,invoice_commitments,verification_only:a.verification_only,status:"PROCESSING".into()};
        self.s.write(&key("private-request",&r.id),&r)?;
        // Only commitments and policy snapshots go into public execution args.
        let input=json!({"protocol_version":4,"operation":if r.verification_only{"verify"}else{"net"},"network":self.c.network,"vault":self.c.vault,"token":self.c.token,"request_id":r.id,"input_commitment":r.input_commitment,"deadline_ms":r.deadline_ms,"worker_hash":r.worker_hash,"policies":r.policies,"prior_charges":r.prior_charges,"encrypted_invoices":a.encrypted_invoices,"disclosure_signatures":a.disclosure_signatures});
        ensure(input.to_string().len()<=32_768,"PRIVATE_INPUT_TOO_LARGE")?;
        let cb=Call{receiver:self.c.vault.clone(),method:"verified_private_round_callback".into(),args:json!({"id":r.id}),deposit:"0".into(),gas:85*TGAS,callback:None};
        self.calls.push(Call{receiver:worker.outlayer_account,method:"request_execution".into(),args:json!({"source":{"WasmUrl":{"url":worker.url,"hash":worker.hash,"build_target":"wasm32-wasip2"}},"input_data":input.to_string(),"resource_limits":{"max_instructions":1_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":45},"response_format":"Text","secrets_ref":{"profile":r.profile,"account_id":self.c.vault},"payer_account_id":self.c.vault}),deposit:self.ctx.attached.to_string(),gas:100*TGAS,callback:Some(Box::new(cb))});value(&r)
    }
    fn private_fail(&mut self,r:&mut PrivateRequest,status:&str)->Result<Value>{
        if r.status=="PROCESSING"{let mut w=self.wallet(&r.requester)?;w.active_proposals=w.active_proposals.checked_sub(1).ok_or("PROPOSAL_COUNT_CORRUPT")?;self.save_wallet(&w)?;r.status=status.into();self.s.write(&key("private-request",&r.id),r)?;}
        self.recovery=true;value(r)
    }
    fn private_callback(&mut self,a:Id)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.vault && self.ctx.promise_results.len()==1,"PRIVATE_CALLBACK_ONLY")?;
        let mut req=self.s.read::<PrivateRequest>(&key("private-request",&a.id))?.ok_or("PRIVATE_REQUEST_NOT_FOUND")?;
        if req.status!="PROCESSING"{return value(&req)}
        if self.ctx.now_ms>=req.deadline_ms{return self.private_fail(&mut req,"EXPIRED")}
        let raw=match &self.ctx.promise_results[0]{Some(bytes)=>bytes,None=>return self.private_fail(&mut req,"FAILED")};
        // OutLayer response shape must be verified live before enabling a build.
        // The verified adapter uses a JSON output string; no arbitrary nested
        // object or coordinator-supplied result is accepted by this callback.
        let output: String=match serde_json::from_slice(raw){Ok(s)=>s,Err(_)=>return self.private_fail(&mut req,"INVALID_OUTPUT")};
        let result:PrivateResult=match serde_json::from_str(&output){Ok(v)=>v,Err(_)=>return self.private_fail(&mut req,"INVALID_OUTPUT")};
        ensure(result.protocol_version==4 && result.request_id==req.id && result.input_commitment==req.input_commitment && result.worker_hash==req.worker_hash && result.deadline_ms==req.deadline_ms,"PRIVATE_RESULT_BINDING_MISMATCH")?;
        ensure(result.operation==if req.verification_only{"verify"}else{"net"},"PRIVATE_RESULT_OPERATION_MISMATCH")?;
        ensure(result.policy_epochs==req.policies,"PRIVATE_POLICY_MISMATCH")?;
        ensure(result.previous_nullifiers==req.prior_charges.iter().map(|c|c.nullifier.clone()).collect::<Vec<_>>(),"PRIVATE_PREVIOUS_CHARGE_MISMATCH")?;
        let mut ps=result.positions;ps.sort_by(|a,b|a.account_id.cmp(&b.account_id));let members=ps.iter().map(|p|p.account_id.as_str()).collect::<Vec<_>>();
        ensure(members==req.policies.iter().map(|p|p.account_id.as_str()).collect::<Vec<_>>(),"PRIVATE_MEMBER_MISMATCH")?;
        let volume=validate_positions(&ps)?;
        ensure(!req.verification_only || ps.iter().all(|p|p.net=="0"),"PRIVATE_VERIFICATION_DISCLOSURE_REFUSED")?;
        ensure(!result.charges.is_empty() && result.charges.len()<=MAX_PRIVATE_INVOICES,"PRIVATE_INVOICE_LIMIT")?;
        for snapshot in &req.policies{ensure(self.policy(&snapshot.account_id)?==snapshot.policy && !snapshot.policy.revoked && snapshot.policy.expires_at_ms>self.ctx.now_ms,"PRIVATE_POLICY_CHANGED")?;}
        let mut charges=result.charges;charges.sort_by(|a,b|a.nullifier.cmp(&b.nullifier));ensure(!charges.windows(2).any(|w|w[0].nullifier==w[1].nullifier),"DUPLICATE_PRIVATE_CHARGE")?;
        ensure(charges.iter().map(|c|(c.nullifier.clone(),c.commitment.clone())).collect::<Vec<_>>()==req.invoice_commitments,"PRIVATE_INVOICE_INCLUSION_MISMATCH")?;
        for ch in &charges{
            valid_hash(&ch.nullifier)?;valid_hash(&ch.commitment)?;
            if let Some(previous)=self.s.read::<PrivateInvoice>(&key("private-invoice",&ch.nullifier))?{ensure(previous.charge==*ch && previous.status=="ACCEPTED","PRIVATE_CHARGE_CONFLICT")?;}
            else{
                let snap=req.policies.iter().find(|s|s.account_id==ch.buyer && s.policy.epoch==ch.policy_epoch).ok_or("PRIVATE_CHARGE_OWNER_MISMATCH")?;
                let mut auth=self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase",&ch.nullifier))?.ok_or("PRIVATE_PURCHASE_NOT_AUTHORIZED")?;
                ensure(auth.buyer==ch.buyer && auth.policy_epoch==ch.policy_epoch && auth.status=="AUTHORIZED" && auth.budget_charge==snap.policy.max_invoice,"PRIVATE_PURCHASE_AUTHORIZATION_MISMATCH")?;
                // Charge the conservative cap before service delivery, not at
                // clearing. The same pending permission cannot finance another
                // private purchase, and finalization does not charge it twice.
                auth.status="FINALIZED".into();self.s.write(&key("private-purchase",&ch.nullifier),&auth)?;
                self.s.write(&key("charge",&ch.nullifier),&json!({"mode":"private","id":ch.nullifier,"commitment":ch.commitment}))?;
                self.s.write(&key("private-invoice",&ch.nullifier),&PrivateInvoice{charge:ch.clone(),budget_charge:auth.budget_charge,status:"ACCEPTED".into(),round_id:None})?;
            }
        }
        if req.verification_only{
            let mut requester=self.wallet(&req.requester)?;requester.active_proposals=requester.active_proposals.checked_sub(1).ok_or("PROPOSAL_COUNT_CORRUPT")?;self.save_wallet(&requester)?;
            req.status="VERIFIED".into();self.s.write(&key("private-request",&req.id),&req)?;return value(&req)
        }
        let input=RoundInput{id:req.id.clone(),invoice_ids:charges.iter().map(|c|c.nullifier.clone()).collect(),invoice_hashes:charges.iter().map(|c|c.commitment.clone()).collect(),positions:ps,deadline_ms:req.deadline_ms,private:true,input_commitment:req.input_commitment.clone(),worker_hash:req.worker_hash.clone()};
        let hash=input.hash(&self.c.network,&self.c.vault)?;
        let round=Round{input,hash,proposer:req.requester.clone(),status:"COLLECTING".into(),approvals:vec![],gross_invoice_volume:None,net_settlement_volume:Amount(volume),created_at_ms:self.ctx.now_ms,ready_at_ms:None,settled_at_ms:None,sequence:self.c.rounds,reason:None};
        self.index_round(&round)?;req.status="VERIFIED".into();self.s.write(&key("private-request",&req.id),&req)?;value(&round)
    }
    fn expire_private(&mut self,a:Id)->Result<Value>{let mut r=self.s.read::<PrivateRequest>(&key("private-request",&a.id))?.ok_or("PRIVATE_REQUEST_NOT_FOUND")?;ensure(self.ctx.now_ms>=r.deadline_ms,"PRIVATE_REQUEST_NOT_EXPIRED")?;self.private_fail(&mut r,"EXPIRED")}
    fn pin_worker(&mut self,a:PinWorker)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.vault && self.ctx.signer==self.c.vault && self.ctx.attached==1,"VAULT_DEPLOYMENT_KEY_REQUIRED")?;
        ensure(self.c.private_worker.is_none(),"PRIVATE_WORKER_ALREADY_PINNED")?;valid_hash(&a.worker.hash)?;valid_id(&a.worker.profile)?;
        ensure(a.worker.url.starts_with("https://") && a.worker.url.len()<=512 && a.worker.outlayer_account==if self.c.network=="testnet"{"outlayer.testnet"}else{"outlayer.near"},"INVALID_WORKER_REFERENCE")?;
        self.c.private_worker=Some(a.worker);self.s.write(CONFIG,&self.c)?;value(&self.c.private_worker)
    }
    fn request_encryption_key(&mut self,a:KeyRequest)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.coordinator_id && self.ctx.signer==self.c.coordinator_id,"PRIVATE_COORDINATOR_REQUIRED")?;
        let worker=self.c.private_worker.clone().ok_or("PRIVATE_MODE_UNAVAILABLE")?;ensure(a.profile==worker.profile,"PRIVATE_PROFILE_MISMATCH")?;
        ensure(self.ctx.attached>0 && self.ctx.attached<=50_000_000_000_000_000_000_000,"BOUNDED_SPONSOR_PAYMENT_REQUIRED")?;
        if let Some(k)=self.s.read::<PrivateEncryptionKey>("private-encryption-key")?{return value(&k)}
        let input=json!({"protocol_version":4,"operation":"encryption_key","network":self.c.network,"vault":self.c.vault,"token":self.c.token,"worker_hash":worker.hash});
        let cb=Call{receiver:self.c.vault.clone(),method:"verified_private_key_callback".into(),args:json!({}),deposit:"0".into(),gas:25*TGAS,callback:None};
        self.calls.push(Call{receiver:worker.outlayer_account,method:"request_execution".into(),args:json!({"source":{"WasmUrl":{"url":worker.url,"hash":worker.hash,"build_target":"wasm32-wasip2"}},"input_data":input.to_string(),"resource_limits":{"max_instructions":1_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":45},"response_format":"Text","secrets_ref":{"profile":worker.profile,"account_id":self.c.vault},"payer_account_id":self.c.vault}),deposit:self.ctx.attached.to_string(),gas:100*TGAS,callback:Some(Box::new(cb))});Ok(json!({"status":"PROCESSING"}))
    }
    fn encryption_key_callback(&mut self)->Result<Value>{
        ensure(self.ctx.predecessor==self.c.vault && self.ctx.promise_results.len()==1,"PRIVATE_CALLBACK_ONLY")?;
        let worker=self.c.private_worker.as_ref().ok_or("PRIVATE_MODE_UNAVAILABLE")?;
        let raw=self.ctx.promise_results[0].as_ref().ok_or("PRIVATE_KEY_RUN_FAILED")?;
        let output:String=serde_json::from_slice(raw).map_err(|_|"PRIVATE_KEY_OUTPUT_INVALID")?;
        let k:PrivateEncryptionKey=serde_json::from_str(&output).map_err(|_|"PRIVATE_KEY_OUTPUT_INVALID")?;
        ensure(k.protocol_version==4 && k.worker_hash==worker.hash && k.algorithm=="X25519-HKDF-SHA256-AES-256-GCM","PRIVATE_KEY_BINDING_MISMATCH")?;valid_hash(&k.public_key)?;
        if let Some(existing)=self.s.read::<PrivateEncryptionKey>("private-encryption-key")?{ensure(existing.public_key==k.public_key,"PRIVATE_KEY_CHANGED")?;return value(&existing)}
        self.s.write("private-encryption-key",&k)?;value(&k)
    }
    fn balance_view(&self,id:&str)->Result<Value>{let w=self.wallet(id)?;let p=self.s.read::<Policy>(&key("policy",id))?;let spent=if let Some(p)=&p{self.budget_spent(id,p.epoch)?}else{Amount(0)};Ok(json!({"account_id":id,"name":w.name,"balance":w.balance,"reserved":w.reserved,"available":Amount(sub(w.balance.0,w.reserved.0)?),"pending_withdrawals":w.pending_withdrawals,"policy":p,"gross_purchase_budget_used":spent,"active_proposals":w.active_proposals,"active_authorizations":w.active_authorizations}))}
    fn list(&self,a:ListArgs,kind:&str)->Result<Value>{
        ensure((1..=100).contains(&a.limit),"INVALID_PAGE_SIZE")?;
        let (count,prefix)=match kind{
            "accounts"=>(self.c.accounts,"account-index".into()),"rounds"=>(self.c.rounds,"round-index".into()),"withdrawals"=>(self.c.withdrawals,"withdrawal-index".into()),
            "activity"=>{let account=a.account_id.as_ref().ok_or("ACCOUNT_ID_REQUIRED")?;(self.wallet(account)?.activity_count,format!("activity:{account}"))},
            _=>if let Some(account)=&a.account_id{(self.wallet(account)?.invoice_count,format!("account-invoice:{account}"))}else{(self.c.invoices,"invoice-index".into())},
        };
        ensure(a.cursor<=count,"INVALID_CURSOR")?;let end=count.min(a.cursor+a.limit as u64);let mut items=vec![];
        for n in a.cursor..end{
            if kind=="activity"{items.push(value(&self.s.read::<Activity>(&format!("{prefix}:{n}"))?.ok_or("INDEX_CORRUPT")?)?);continue}
            let id=self.s.read::<String>(&format!("{prefix}:{n}"))?.ok_or("INDEX_CORRUPT")?;
            items.push(match kind{"accounts"=>self.balance_view(&id)?,"rounds"=>value(&self.round(&id)?)?,"withdrawals"=>value(&self.s.read::<Withdrawal>(&key("withdrawal",&id))?.ok_or("INDEX_CORRUPT")?)?,_=>value(&self.invoice(&id)?)?});
        }Ok(json!({"items":items,"next_cursor":if end<count{Some(end)}else{None},"total":count}))
    }
    fn dispatch(&mut self,method:&str,input:Value)->Result<Value>{match method{
        "register_account"=>self.register(args(input)?),"set_agent_policy"=>self.set_policy(args(input)?),"revoke_agent"=>{ensure(input==json!({}),"INVALID_ARGUMENTS")?;self.revoke()},
        "ft_on_transfer"=>self.deposit(args(input)?),"propose_invoice"=>self.propose_invoice(args(input)?),"accept_invoice"=>self.accept_invoice(args(input)?),"cancel_invoice_by_agreement"=>self.cancel_invoice(args(input)?),
        "propose_round"=>self.propose_round(args(input)?),"authorize_round"=>self.authorize_round(args(input)?),"cancel_round_authorization"=>self.cancel_round(args(input)?),"expire_round"=>self.expire(args(input)?,false),"release_stale_round"=>self.expire(args(input)?,true),"settle_round"=>self.settle(args(input)?),
        "request_withdrawal"=>self.withdraw(args(input)?),"request_recovery_withdrawal"=>self.recovery_withdraw(args(input)?),"withdrawal_callback"=>self.withdrawal_callback(args(input)?),
        "authorize_private_purchase"=>self.authorize_private_purchase(args(input)?),"cancel_pending_private_purchase"=>self.cancel_pending_private_purchase(args(input)?),"request_private_round"=>self.private_request(args(input)?),"verified_private_round_callback"=>self.private_callback(args(input)?),"expire_private_request"=>self.expire_private(args(input)?),
        "pin_private_worker"=>self.pin_worker(args(input)?),"request_private_encryption_key"=>self.request_encryption_key(args(input)?),"verified_private_key_callback"=>{ensure(input==json!({}),"INVALID_ARGUMENTS")?;self.encryption_key_callback()},
        "get_private_encryption_key"=>{ensure(input==json!({}),"INVALID_ARGUMENTS")?;value(&self.s.read::<PrivateEncryptionKey>("private-encryption-key")?)},
        "get_config"=>{ensure(input==json!({}),"INVALID_ARGUMENTS")?;value(&self.c)},
        "get_balance"|"get_available_balance"=>{let a:AccountArgs=args(input)?;self.balance_view(&a.account_id)},
        "get_backing_status"=>{ensure(input==json!({}),"INVALID_ARGUMENTS")?;Ok(json!({"token":self.c.token,"decimals":6,"total_balances":self.c.total_balances,"pending_withdrawals":self.c.pending_withdrawals,"tracked_token_custody":self.c.tracked_token_custody,"claims_equal_tracked_custody":add(self.c.total_balances.0,self.c.pending_withdrawals.0)?==self.c.tracked_token_custody.0,"native_sponsor_headroom":self.ctx.native_free.to_string(),"actual_token_balance_requires_independent_ft_balance_of":true}))},
        "get_invoice"=>{let a:Id=args(input)?;value(&self.invoice(&a.id)?)},"get_round"=>{let a:Id=args(input)?;value(&self.round(&a.id)?)},
        "get_withdrawal"=>{let a:Id=args(input)?;value(&self.s.read::<Withdrawal>(&key("withdrawal",&a.id))?)},
        "get_recovery_withdrawal"=>{let a:AccountArgs=args(input)?;value(&self.s.read::<Withdrawal>(&key("recovery-withdrawal",&a.account_id))?)},
        "get_private_request"=>{let a:Id=args(input)?;value(&self.s.read::<PrivateRequest>(&key("private-request",&a.id))?)},
        "get_private_invoice"=>{let a:Id=args(input)?;value(&self.s.read::<PrivateInvoice>(&key("private-invoice",&a.id))?)},
        "get_private_purchase"=>{let a:Id=args(input)?;value(&self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase",&a.id))?)},
        "list_invoices"=>self.list(args(input)?,"invoices"),"list_rounds"=>self.list(args(input)?,"rounds"),"list_accounts"=>self.list(args(input)?,"accounts"),"list_withdrawals"=>self.list(args(input)?,"withdrawals"),"list_account_activity"=>self.list(args(input)?,"activity"),
        _=>Err("METHOD_NOT_FOUND".into()),
    }}
}

/// Execute against an overlay; validation failures never leave partial writes,
/// even in native tests. On chain NEAR additionally rolls back the whole receipt.
pub fn execute<S:Store>(store:&mut S,ctx:&Context,method:&str,input:Value)->Result<Execution>{
    let mut s=Transaction::new(store);
    if method=="init"{
        ensure(s.get(CONFIG).is_none(),"ALREADY_INITIALIZED")?;let a:Init=args(input)?;
        ensure(ctx.predecessor==ctx.current && ctx.signer==ctx.current,"SELF_INITIALIZATION_ONLY")?;
        valid_account(&ctx.current)?;valid_account(&a.token)?;valid_account(&a.owner_id)?;valid_account(&a.coordinator_id)?;
        ensure(matches!(a.network.as_str(),"testnet"|"mainnet"),"INVALID_NETWORK")?;
        if a.network=="testnet"{ensure(a.token.ends_with(".testnet") && ctx.current.ends_with(".testnet"),"NETWORK_ACCOUNT_MISMATCH")?;}
        if let Some(w)=&a.private_worker{valid_account(&w.outlayer_account)?;valid_hash(&w.hash)?;valid_id(&w.profile)?;ensure(w.url.starts_with("https://") && w.url.len()<=512,"INVALID_WORKER_REFERENCE")?;}
        let c=Config{protocol_version:4,network:a.network,vault:ctx.current.clone(),token:a.token,decimals:6,owner_id:a.owner_id,coordinator_id:a.coordinator_id,private_worker:a.private_worker,total_balances:Amount(0),pending_withdrawals:Amount(0),tracked_token_custody:Amount(0),accounts:0,invoices:0,rounds:0,withdrawals:0,settled_rounds:0};
        s.write(CONFIG,&c)?;ensure(ctx.native_free>=SAFETY_FLOOR+s.additional_bytes()*10u128.pow(19),"SPONSOR_STORAGE_HEADROOM_REQUIRED")?;s.commit();return Ok(Execution{value:value(&c)?,calls:vec![],events:vec![]})
    }
    let c=s.read(CONFIG)?.ok_or("NOT_INITIALIZED")?;
    let mut v=Vault{s,ctx,c,calls:vec![],events:vec![],recovery:false};
    let output=v.dispatch(method,input)?;
    if !v.s.writes.is_empty(){
        ensure(add(v.c.total_balances.0,v.c.pending_withdrawals.0)?==v.c.tracked_token_custody.0,"TOKEN_BACKING_INVARIANT")?;
        v.s.write(CONFIG,&v.c)?;
        if v.recovery{ensure(v.s.storage_growth_bytes()==0,"RECOVERY_STORAGE_CAPACITY_REQUIRED")?;}
        else{ensure(ctx.native_free>=SAFETY_FLOOR+v.s.additional_bytes()*10u128.pow(19),"SPONSOR_STORAGE_HEADROOM_REQUIRED")?;}
    }
    let calls=v.calls;let events=v.events;v.s.commit();Ok(Execution{value:output,calls,events})
}

#[cfg(target_arch="wasm32")]
fn entry(method:&str){use ach_runtime::near;let bytes=near::read_input();if bytes.len()>32_768{near::fail("INPUT_TOO_LARGE")};let input=serde_json::from_slice(&bytes).unwrap_or_else(|_|near::fail("INVALID_JSON"));let ctx=if method.starts_with("get_") || method.starts_with("list_"){near::view_context()}else{near::context()};let mut store=near::Storage;match execute(&mut store,&ctx,method,input){Ok(result)=>{for event in &result.events{near::log(event)}for call in &result.calls{near::schedule(call,false)}near::finish(&result.value)},Err(code)=>near::fail(&code)}}
#[cfg(target_arch="wasm32")]
macro_rules! export {($($name:ident),+)=>{$(#[no_mangle]pub extern "C" fn $name(){entry(stringify!($name));})+}}
#[cfg(target_arch="wasm32")]
export!(init,register_account,set_agent_policy,revoke_agent,ft_on_transfer,propose_invoice,accept_invoice,cancel_invoice_by_agreement,propose_round,authorize_round,cancel_round_authorization,expire_round,release_stale_round,settle_round,request_withdrawal,request_recovery_withdrawal,withdrawal_callback,authorize_private_purchase,cancel_pending_private_purchase,request_private_round,verified_private_round_callback,expire_private_request,pin_private_worker,request_private_encryption_key,verified_private_key_callback,get_private_encryption_key,get_config,get_balance,get_available_balance,get_backing_status,get_invoice,get_round,get_withdrawal,get_recovery_withdrawal,get_private_request,get_private_invoice,get_private_purchase,list_invoices,list_rounds,list_accounts,list_withdrawals,list_account_activity);
