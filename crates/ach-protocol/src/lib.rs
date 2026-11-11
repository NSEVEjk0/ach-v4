//! ACH v4's canonical, integer-only protocol. No chain or coordinator authority.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fmt};

pub const VERSION: u32 = 4;
pub const MAX_MEMBERS: usize = 12;
pub const MAX_INVOICES: usize = 48;
pub const MAX_PRIVATE_INVOICES: usize = 6;
pub const PRIVATE_INVOICE_PADDING_BYTES: usize = 2048;
pub const PRIVATE_CIPHERTEXT_BASE64_BYTES: usize = ((PRIVATE_INVOICE_PADDING_BYTES + 16 + 2) / 3) * 4;
pub const MAX_AMOUNT: u128 = (1u128 << 100) - 1;
pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Amount(pub u128);
impl Serialize for Amount {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> { s.serialize_str(&self.0.to_string()) }
}
impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self,D::Error> {
        let s = String::deserialize(d)?;
        parse_units(&s).map(Self).map_err(serde::de::Error::custom)
    }
}
impl fmt::Display for Amount { fn fmt(&self, f:&mut fmt::Formatter<'_>)->fmt::Result { write!(f,"{}",self.0) } }
pub fn parse_units(s:&str)->Result<u128> {
    ensure(!s.is_empty() && s.len()<=39 && s.bytes().all(|c|c.is_ascii_digit()) && (s=="0" || !s.starts_with('0')), "INVALID_AMOUNT")?;
    let n=s.parse::<u128>().map_err(|_|"AMOUNT_OVERFLOW".to_string())?;
    ensure(n<=MAX_AMOUNT, "AMOUNT_OVERFLOW")?; Ok(n)
}
pub fn ensure(ok:bool,code:&str)->Result<()> { if ok {Ok(())} else {Err(code.to_string())} }
pub fn add(a:u128,b:u128)->Result<u128> { a.checked_add(b).filter(|v|*v<=MAX_AMOUNT).ok_or_else(||"AMOUNT_OVERFLOW".to_string()) }
pub fn sub(a:u128,b:u128)->Result<u128> { a.checked_sub(b).ok_or_else(||"INSUFFICIENT_BALANCE".to_string()) }
pub fn valid_account(s:&str)->Result<()> {
    ensure((2..=64).contains(&s.len()) && s.bytes().all(|c|c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c,b'.'|b'-'|b'_'))
        && !s.starts_with(['.','-','_']) && !s.ends_with(['.','-','_']) && !s.as_bytes().windows(2).any(|w|matches!(w[0],b'.'|b'-'|b'_') && matches!(w[1],b'.'|b'-'|b'_')), "INVALID_ACCOUNT")
}
pub fn valid_id(s:&str)->Result<()> { ensure((1..=96).contains(&s.len()) && s.bytes().all(|c|c.is_ascii_alphanumeric() || matches!(c,b'-'|b'_'|b'.')), "INVALID_ID") }
pub fn valid_hash(s:&str)->Result<()> { ensure(s.len()==64 && s.bytes().all(|c|c.is_ascii_digit() || matches!(c,b'a'..=b'f')),"INVALID_HASH") }

/// Each field is its UTF-8 length (u32, big endian), then its bytes. Numbers are
/// canonical decimal strings. Nested arrays are count-prefixed field sequences.
/// Hashes/signatures never depend on JSON object insertion order.
pub struct Canonical(Vec<u8>);
impl Canonical {
    pub fn new(purpose:&str,network:&str,vault:&str)->Self {
        let mut c=Self(Vec::new()); c.field("ACH").field("4").field(purpose).field(network).field(vault); c
    }
    pub fn field(&mut self,s:&str)->&mut Self { self.0.extend_from_slice(&(s.len() as u32).to_be_bytes());self.0.extend_from_slice(s.as_bytes());self }
    pub fn count(&mut self,n:usize)->&mut Self {self.field(&n.to_string())}
    pub fn bytes(self)->Vec<u8>{self.0}
    pub fn hash(self)->String{hex::encode(Sha256::digest(self.0))}
}
pub fn digest(bytes:&[u8])->String {hex::encode(Sha256::digest(bytes))}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InvoiceSpec {
    pub id:String, pub purchase_id:String, pub terms_version:u32,
    pub buyer:String, pub seller:String, pub asset:String, pub amount:Amount,
    pub service:String, pub terms_hash:String, pub artifact_hash:String,
    pub ready_at_ms:u64, pub expires_at_ms:u64,
}
impl InvoiceSpec {
    pub fn validate(&self,asset:&str)->Result<()> {
        valid_id(&self.id)?;valid_id(&self.purchase_id)?;valid_id(&self.service)?;
        valid_account(&self.buyer)?;valid_account(&self.seller)?;
        ensure(self.buyer!=self.seller,"SELF_INVOICE")?;
        ensure(self.terms_version>0 && self.amount.0>0 && self.amount.0<=MAX_AMOUNT,"INVALID_TERMS")?;
        ensure(self.asset==asset,"WRONG_ASSET")?;valid_hash(&self.terms_hash)?;valid_hash(&self.artifact_hash)?;
        ensure(self.ready_at_ms<=self.expires_at_ms,"INVALID_DEADLINE")
    }
    pub fn canonical(&self,network:&str,vault:&str)->Canonical {
        let mut c=Canonical::new("invoice",network,vault);
        for s in [&self.id,&self.purchase_id,&self.terms_version.to_string(),&self.buyer,&self.seller,&self.asset,&self.amount.to_string(),&self.service,&self.terms_hash,&self.artifact_hash,&self.ready_at_ms.to_string(),&self.expires_at_ms.to_string()] {c.field(s);}c
    }
    pub fn hash(&self,network:&str,vault:&str)->String {self.canonical(network,vault).hash()}
    pub fn charge_id(&self,network:&str,vault:&str)->String {
        let mut c=Canonical::new("purchase-charge",network,vault);
        c.field(&self.buyer).field(&self.purchase_id).field(&self.terms_version.to_string());c.hash()
    }
}

/// The salt stays inside the encrypted contribution. A public commitment cannot
/// be used as a dictionary of small prices, even for predictable purchase IDs.
pub fn private_invoice_commitment(i:&InvoiceSpec,network:&str,vault:&str,salt:&str)->Result<String>{
    valid_hash(salt)?;let mut c=Canonical::new("private-invoice",network,vault);
    c.field(&i.hash(network,vault)).field(salt);Ok(c.hash())
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct EncryptedInvoice {pub nullifier:String,pub commitment:String,pub ephemeral_public_key:String,pub nonce:String,pub ciphertext:String}
impl EncryptedInvoice {
    pub fn validate(&self)->Result<()> {
        valid_hash(&self.nullifier)?;valid_hash(&self.commitment)?;valid_hash(&self.ephemeral_public_key)?;
        ensure(self.nonce.len()==24 && self.nonce.bytes().all(|c|c.is_ascii_digit() || matches!(c,b'a'..=b'f')),"INVALID_PRIVATE_NONCE")?;
        ensure(self.ciphertext.len()==PRIVATE_CIPHERTEXT_BASE64_BYTES && self.ciphertext.bytes().all(|c|c.is_ascii_alphanumeric() || matches!(c,b'+'|b'/'|b'=')),"INVALID_PRIVATE_CIPHERTEXT")
    }
}
pub fn private_envelope_aad(network:&str,vault:&str,worker_hash:&str,commitment:&str)->Vec<u8>{
    let mut c=Canonical::new("private-envelope",network,vault);c.field(worker_hash).field(commitment);c.bytes()
}

/// Permission to publish the net movements of this exact encrypted set. Invoice
/// acceptance alone does not permit a relay to isolate and disclose its price.
pub fn private_disclosure_hash(network:&str,vault:&str,input_commitment:&str,members:&[String])->Result<String>{
    valid_hash(input_commitment)?;
    let mut members=members.to_vec();members.sort();
    ensure((2..=MAX_MEMBERS).contains(&members.len()) && !members.windows(2).any(|w|w[0]==w[1]),"PRIVATE_MEMBER_MISMATCH")?;
    let mut c=Canonical::new("private-net-disclosure",network,vault);c.field(input_commitment).count(members.len());
    for member in members{valid_account(&member)?;c.field(&member);}Ok(c.hash())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Position {pub account_id:String, pub net:String}
impl Position {
    pub fn value(&self)->Result<i128> {
        let negative=self.net.starts_with('-');let s=if negative {&self.net[1..]} else {&self.net};
        let a=parse_units(s)?;ensure(!negative || a>0,"INVALID_NET")?;
        Ok(if negative {-(a as i128)} else {a as i128})
    }
    pub fn required(&self)->Result<u128> {Ok(self.value()?.min(0).unsigned_abs())}
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetPlan {pub positions:Vec<Position>, pub gross_invoice_volume:Amount,pub net_settlement_volume:Amount}
pub fn net_invoices(invoices:&[InvoiceSpec])->Result<NetPlan> {
    ensure(!invoices.is_empty() && invoices.len()<=MAX_INVOICES,"ROUND_INVOICE_LIMIT")?;
    let mut nets=BTreeMap::<String,i128>::new();let mut ids=BTreeSet::new();let mut gross=0;
    for i in invoices {
        ensure(i.amount.0>0 && i.amount.0<=MAX_AMOUNT && i.buyer!=i.seller,"INVALID_INVOICE")?;
        ensure(ids.insert(i.id.clone()),"DUPLICATE_INVOICE")?;
        gross=add(gross,i.amount.0)?;
        for (a,n) in [(&i.buyer,-(i.amount.0 as i128)),(&i.seller,i.amount.0 as i128)] {
            let next=nets.get(a).copied().unwrap_or(0).checked_add(n).ok_or("NET_OVERFLOW")?;
            ensure(next.unsigned_abs()<=MAX_AMOUNT,"NET_OVERFLOW")?;nets.insert(a.clone(),next);
        }
    }
    ensure(nets.len()<=MAX_MEMBERS,"ROUND_MEMBER_LIMIT")?;
    let positions=nets.into_iter().map(|(account_id,net)|Position {account_id,net:net.to_string()}).collect::<Vec<_>>();
    let volume=validate_positions(&positions)?;
    Ok(NetPlan {positions,gross_invoice_volume:Amount(gross),net_settlement_volume:Amount(volume)})
}
pub fn validate_positions(positions:&[Position])->Result<u128> {
    ensure((2..=MAX_MEMBERS).contains(&positions.len()),"ROUND_MEMBER_LIMIT")?;
    let mut ids=BTreeSet::new();let mut sum=0i128;let mut debits=0;
    for p in positions {valid_account(&p.account_id)?;ensure(ids.insert(&p.account_id),"DUPLICATE_MEMBER")?;sum=sum.checked_add(p.value()?).ok_or("NET_OVERFLOW")?;debits=add(debits,p.required()?)?;}
    ensure(sum==0,"UNBALANCED_ROUND")?;Ok(debits)
}

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct RoundInput {
    pub id:String, pub invoice_ids:Vec<String>,pub invoice_hashes:Vec<String>,
    pub positions:Vec<Position>,pub deadline_ms:u64,pub private:bool,
    pub input_commitment:String,pub worker_hash:String,
}
impl RoundInput {
    pub fn hash(&self,network:&str,vault:&str)->Result<String> {
        valid_id(&self.id)?;ensure(self.invoice_ids.len()==self.invoice_hashes.len() && !self.invoice_ids.is_empty() && self.invoice_ids.len()<=MAX_INVOICES,"INVALID_ROUND_INPUT")?;
        validate_positions(&self.positions)?;
        let mut pairs=self.invoice_ids.iter().zip(&self.invoice_hashes).collect::<Vec<_>>();pairs.sort();
        ensure(!pairs.windows(2).any(|w|w[0].0==w[1].0),"DUPLICATE_INVOICE")?;
        let mut ps=self.positions.clone();ps.sort_by(|a,b|a.account_id.cmp(&b.account_id));
        let mut c=Canonical::new("round",network,vault);
        c.field(&self.id).field(&self.deadline_ms.to_string()).field(if self.private {"private"} else {"public"}).field(&self.input_commitment).field(&self.worker_hash).count(pairs.len());
        for (id,hash) in pairs {valid_hash(hash)?;c.field(id).field(hash);}
        c.count(ps.len());for p in ps {c.field(&p.account_id).field(&p.net);}Ok(c.hash())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn invoice(id:&str,b:&str,s:&str,n:u128)->InvoiceSpec {InvoiceSpec{id:id.into(),purchase_id:format!("purchase-{id}"),terms_version:1,buyer:b.into(),seller:s.into(),asset:"usd.testnet".into(),amount:Amount(n),service:"research".into(),terms_hash:"a".repeat(64),artifact_hash:"b".repeat(64),ready_at_ms:1,expires_at_ms:99}}
    #[test]fn only_net_debtor_needs_funds(){let p=net_invoices(&[invoice("ab","aa","bb",100_000),invoice("bc","bb","cc",100_000),invoice("ca","cc","aa",80_000)]).unwrap();assert_eq!(p.net_settlement_volume.0,20_000);assert_eq!(p.positions.iter().map(|p|p.net.as_str()).collect::<Vec<_>>(),vec!["-20000","0","20000"]);}
    #[test]fn canonical_round_is_order_independent(){let a=invoice("ab","aa","bb",100);let b=invoice("ba","bb","aa",40);let mut r=RoundInput{id:"r1".into(),invoice_ids:vec![a.id.clone(),b.id.clone()],invoice_hashes:vec![a.hash("testnet","vault.testnet"),b.hash("testnet","vault.testnet")],positions:net_invoices(&[a,b]).unwrap().positions,deadline_ms:1000,private:false,input_commitment:String::new(),worker_hash:String::new()};let h=r.hash("testnet","vault.testnet").unwrap();r.invoice_ids.reverse();r.invoice_hashes.reverse();r.positions.reverse();assert_eq!(h,r.hash("testnet","vault.testnet").unwrap());assert_ne!(h,r.hash("mainnet","vault.testnet").unwrap());}
    #[test]fn strict_amounts(){for v in ["-1","01","1.0","NaN","","+1"," 1","340282366920938463463374607431768211456"]{assert!(parse_units(v).is_err(),"{v}");}assert_eq!(parse_units("100001").unwrap(),100001);assert!(Position{account_id:"aa".into(),net:"-0".into()}.value().is_err());}
    #[test]fn rejects_forged_and_duplicate_inputs(){let a=invoice("ab","aa","bb",1);assert!(net_invoices(&[a.clone(),a]).is_err());assert!(validate_positions(&[Position{account_id:"aa".into(),net:"1".into()},Position{account_id:"bb".into(),net:"0".into()}]).is_err());}
}
