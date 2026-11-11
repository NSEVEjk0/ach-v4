//! Pinned OutLayer worker. Only encrypted contributions enter public stdin.
//! The deployment-owned X25519 key is injected by the restricted TEE profile.
use ach_protocol::*;
use aes_gcm::{aead::{Aead, KeyInit, Payload}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature as EdSignature, VerifyingKey};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{BTreeMap, BTreeSet};
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub key:String, pub epoch:u64, pub max_invoice:Amount, pub gross_budget:Amount,
    pub max_net_commitment:Amount, pub expires_at_ms:u64, pub counterparties:Vec<String>,
    pub services:Vec<String>, pub revoked:bool, pub activity_sequence:u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PolicySnapshot { pub account_id:String, pub policy:Policy }
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signature { pub account_id:String, pub key_epoch:u64, pub signature:String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contribution { pub spec:InvoiceSpec, pub salt:String, pub signatures:Vec<Signature> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol_version:u32, pub operation:String, pub network:String, pub vault:String,
    pub token:String, pub worker_hash:String,
    #[serde(default)] pub request_id:String,
    #[serde(default)] pub input_commitment:String,
    #[serde(default)] pub deadline_ms:u64,
    #[serde(default)] pub policies:Vec<PolicySnapshot>,
    #[serde(default)] pub prior_charges:Vec<PrivateCharge>,
    #[serde(default)] pub encrypted_invoices:Vec<EncryptedInvoice>,
    #[serde(default)] pub disclosure_signatures:Vec<Signature>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PrivateCharge { pub nullifier:String, pub commitment:String, pub buyer:String, pub policy_epoch:u64 }
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Computed {
    pub protocol_version:u32, pub operation:String, pub request_id:String, pub input_commitment:String,
    pub worker_hash:String, pub deadline_ms:u64, pub positions:Vec<Position>,
    pub charges:Vec<PrivateCharge>, pub policy_epochs:Vec<PolicySnapshot>,
    pub previous_nullifiers:Vec<String>,
}

pub fn encryption_public_key(secret:&str)->Result<String> {
    let bytes:[u8;32]=hex::decode(secret).map_err(|_|"PRIVATE_KEY_UNAVAILABLE")?.try_into().map_err(|_|"PRIVATE_KEY_UNAVAILABLE")?;
    Ok(hex::encode(PublicKey::from(&StaticSecret::from(bytes)).as_bytes()))
}
pub fn input_commitment(r:&Request)->String {
    let mut hashes=r.encrypted_invoices.iter().map(|e|e.commitment.as_str()).collect::<Vec<_>>(); hashes.sort();
    let mut c=Canonical::new("private-input",&r.network,&r.vault);
    c.field(&r.request_id).field(&r.deadline_ms.to_string()).field(&r.worker_hash).count(hashes.len());
    for h in hashes {c.field(h);} c.hash()
}
pub fn decrypt(r:&Request, e:&EncryptedInvoice, secret:&str)->Result<Contribution> {
    e.validate()?;
    let private:[u8;32]=hex::decode(secret).map_err(|_|"PRIVATE_KEY_UNAVAILABLE")?.try_into().map_err(|_|"PRIVATE_KEY_UNAVAILABLE")?;
    let public:[u8;32]=hex::decode(&e.ephemeral_public_key).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?.try_into().map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?;
    let shared=StaticSecret::from(private).diffie_hellman(&PublicKey::from(public));
    ensure(shared.was_contributory(),"PRIVATE_CIPHERTEXT_INVALID")?;
    let mut key=[0u8;32];Hkdf::<Sha256>::new(None,shared.as_bytes()).expand(b"ach-private-invoices-v4",&mut key).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?;
    let nonce=hex::decode(&e.nonce).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?;
    let ciphertext=STANDARD.decode(&e.ciphertext).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?;
    let aad=private_envelope_aad(&r.network,&r.vault,&r.worker_hash,&e.commitment);
    let clear=Aes256Gcm::new_from_slice(&key).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?
        .decrypt(Nonce::from_slice(&nonce),Payload{msg:&ciphertext,aad:&aad}).map_err(|_|"PRIVATE_CIPHERTEXT_INVALID")?;
    ensure(clear.len()==PRIVATE_INVOICE_PADDING_BYTES,"PRIVATE_PADDING_INVALID")?;
    serde_json::from_slice(&clear).map_err(|_|"PRIVATE_CONTRIBUTION_INVALID".into())
}
fn verify(key:&str, commitment:&str, signature:&str)->bool {
    let result=(||->Option<()>{
        let bytes:[u8;32]=hex::decode(key).ok()?.try_into().ok()?;
        let key=VerifyingKey::from_bytes(&bytes).ok()?;
        let signature=EdSignature::from_slice(&STANDARD.decode(signature).ok()?).ok()?;
        key.verify_strict(&hex::decode(commitment).ok()?,&signature).ok()?;Some(())
    })();result.is_some()
}
pub fn compute(r:&Request, secret:&str, now_ms:u64)->Result<Computed> {
    ensure(r.protocol_version==4 && matches!(r.operation.as_str(),"net"|"verify"),"PRIVATE_OPERATION_INVALID")?;
    ensure(matches!(r.network.as_str(),"testnet"|"mainnet"),"PRIVATE_NETWORK_INVALID")?;
    valid_id(&r.request_id)?;valid_account(&r.vault)?;valid_account(&r.token)?;valid_hash(&r.worker_hash)?;
    ensure(r.deadline_ms>now_ms && r.deadline_ms<=now_ms+900_000,"PRIVATE_DEADLINE")?;
    ensure(!r.encrypted_invoices.is_empty() && r.encrypted_invoices.len()<=MAX_PRIVATE_INVOICES,"PRIVATE_INVOICE_LIMIT")?;
    ensure(serde_json::to_vec(&r.encrypted_invoices).map_err(|_|"PRIVATE_INPUT_INVALID")?.len()<=24_576,"PRIVATE_INPUT_TOO_LARGE")?;
    ensure(r.input_commitment==input_commitment(r),"PRIVATE_INPUT_COMMITMENT_MISMATCH")?;
    ensure((2..=MAX_MEMBERS).contains(&r.policies.len()),"PRIVATE_MEMBER_MISMATCH")?;
    let mut policies=BTreeMap::new();
    for p in &r.policies {
        valid_account(&p.account_id)?;valid_hash(&p.policy.key)?;
        ensure(!p.policy.revoked && p.policy.expires_at_ms>=r.deadline_ms && policies.insert(p.account_id.clone(),p).is_none(),"PRIVATE_POLICY")?;
    }
    if r.operation=="net" {
        ensure(r.disclosure_signatures.len()==policies.len(),"PRIVATE_DISCLOSURE_CONSENT_REQUIRED")?;
        let members=policies.keys().cloned().collect::<Vec<_>>();
        let disclosure=private_disclosure_hash(&r.network,&r.vault,&r.input_commitment,&members)?;
        let mut signers=BTreeSet::new();
        for signature in &r.disclosure_signatures {
            let policy=&policies.get(&signature.account_id).ok_or("PRIVATE_DISCLOSURE_PARTY")?.policy;
            ensure(signers.insert(&signature.account_id) && signature.key_epoch==policy.epoch
                && verify(&policy.key,&disclosure,&signature.signature),"PRIVATE_DISCLOSURE_SIGNATURE_INVALID")?;
        }
    } else {ensure(r.disclosure_signatures.is_empty(),"PRIVATE_OPERATION_INVALID")?;}
    let mut prior=BTreeMap::new();
    for ch in &r.prior_charges {valid_hash(&ch.nullifier)?;valid_hash(&ch.commitment)?;ensure(prior.insert(ch.nullifier.clone(),ch).is_none(),"PRIVATE_PREVIOUS_CHARGE_MISMATCH")?;}
    let mut charges=vec![];let mut nullifiers=BTreeSet::new();let mut invoices=vec![];
    for e in &r.encrypted_invoices {
        let contribution=decrypt(r,e,secret)?;let i=&contribution.spec;
        i.validate(&r.token)?;ensure(i.purchase_id.len()>=32 && i.ready_at_ms<=now_ms,"PRIVATE_INVOICE_ELIGIBILITY")?;
        let commitment=private_invoice_commitment(i,&r.network,&r.vault,&contribution.salt)?;
        ensure(commitment==e.commitment && e.nullifier==i.charge_id(&r.network,&r.vault),"PRIVATE_ENVELOPE_BINDING_MISMATCH")?;
        ensure(nullifiers.insert(e.nullifier.clone()),"PRIVATE_DUPLICATE_PURCHASE")?;
        ensure(policies.contains_key(&i.buyer) && policies.contains_key(&i.seller),"PRIVATE_PARTY_OMITTED")?;
        let charge=if let Some(ch)=prior.get(&e.nullifier) {
            // An already accepted immutable invoice remains payable after its
            // acceptance deadline or signer rotation. The vault registry binds it.
            ensure(ch.commitment==commitment && ch.buyer==i.buyer,"PRIVATE_PREVIOUS_CHARGE_MISMATCH")?;
            (*ch).clone()
        } else {
            ensure(i.expires_at_ms>now_ms && contribution.signatures.len()==2,"PRIVATE_SIGNATURE_COUNT_OR_EXPIRY")?;
            let mut signers=BTreeSet::new();
            for signature in &contribution.signatures {
                ensure(signature.account_id==i.buyer || signature.account_id==i.seller,"PRIVATE_SIGNATURE_PARTY")?;
                let p=&policies.get(&signature.account_id).ok_or("PRIVATE_PARTY_OMITTED")?.policy;
                let counterparty=if signature.account_id==i.buyer {&i.seller} else {&i.buyer};
                ensure(signature.key_epoch==p.epoch && i.amount.0<=p.max_invoice.0
                    && (p.counterparties.is_empty() || p.counterparties.contains(counterparty))
                    && (p.services.is_empty() || p.services.contains(&i.service)),"PRIVATE_PURCHASE_PERMISSION")?;
                ensure(signers.insert(signature.account_id.clone()) && verify(&p.key,&commitment,&signature.signature),"PRIVATE_SIGNATURE_INVALID")?;
            }
            PrivateCharge{nullifier:e.nullifier.clone(),commitment,buyer:i.buyer.clone(),policy_epoch:policies[&i.buyer].policy.epoch}
        };
        charges.push(charge);invoices.push(i.clone());
    }
    ensure(prior.keys().all(|id|nullifiers.contains(id)),"PRIVATE_PREVIOUS_CHARGE_MISMATCH")?;
    let plan=net_invoices(&invoices)?;
    ensure(plan.positions.iter().map(|p|p.account_id.as_str()).collect::<Vec<_>>()==policies.keys().map(String::as_str).collect::<Vec<_>>(),"PRIVATE_MEMBER_MISMATCH")?;
    charges.sort_by(|a,b|a.nullifier.cmp(&b.nullifier));
    let positions=if r.operation=="verify"{plan.positions.into_iter().map(|p|Position{account_id:p.account_id,net:"0".into()}).collect()}else{plan.positions};
    Ok(Computed{protocol_version:4,operation:r.operation.clone(),request_id:r.request_id.clone(),input_commitment:r.input_commitment.clone(),deadline_ms:r.deadline_ms,
        worker_hash:r.worker_hash.clone(),positions,charges,policy_epochs:r.policies.clone(),previous_nullifiers:prior.keys().cloned().collect()})
}

pub fn execute(input:&[u8], secret:&str, now_ms:u64)->Result<serde_json::Value> {
    ensure(input.len()<=32_768,"PRIVATE_INPUT_TOO_LARGE")?;
    let r:Request=serde_json::from_slice(input).map_err(|_|"PRIVATE_INPUT_INVALID")?;
    valid_hash(&r.worker_hash)?;valid_account(&r.vault)?;valid_account(&r.token)?;
    ensure(r.protocol_version==4,"PRIVATE_OPERATION_INVALID")?;
    if r.operation=="encryption_key" {
        return Ok(serde_json::json!({"protocol_version":4,"worker_hash":r.worker_hash,"public_key":encryption_public_key(secret)?,"algorithm":"X25519-HKDF-SHA256-AES-256-GCM"}));
    }
    serde_json::to_value(compute(&r,secret,now_ms)?).map_err(|_|"PRIVATE_OUTPUT_INVALID".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer,SigningKey};
    fn fixture()->(Request,String,Contribution) {
        let secret="11".repeat(32);let a=SigningKey::from_bytes(&[2u8;32]);let b=SigningKey::from_bytes(&[3u8;32]);
        let spec=InvoiceSpec{id:"private-one".into(),purchase_id:"f".repeat(32),terms_version:1,buyer:"aa.testnet".into(),seller:"bb.testnet".into(),asset:"usd.testnet".into(),amount:Amount(92713),service:"private".into(),terms_hash:"a".repeat(64),artifact_hash:"b".repeat(64),ready_at_ms:1,expires_at_ms:1000};
        let salt=digest(b"private-fixture-salt");let commitment=private_invoice_commitment(&spec,"testnet","vault.testnet",&salt).unwrap();
        let signatures=[(&a,"aa.testnet"),(&b,"bb.testnet")].iter().map(|(key,id)|Signature{account_id:id.to_string(),key_epoch:1,signature:STANDARD.encode(key.sign(&hex::decode(&commitment).unwrap()).to_bytes())}).collect();
        let contribution=Contribution{spec,salt,signatures};
        let policies=[(&a,"aa.testnet"),(&b,"bb.testnet")].iter().map(|(key,id)|PolicySnapshot{account_id:id.to_string(),policy:Policy{key:hex::encode(key.verifying_key().to_bytes()),epoch:1,max_invoice:Amount(100000),gross_budget:Amount(1000000),max_net_commitment:Amount(1000000),expires_at_ms:2000,counterparties:vec![],services:vec![],revoked:false,activity_sequence:0}}).collect();
        let mut r=Request{protocol_version:4,operation:"net".into(),network:"testnet".into(),vault:"vault.testnet".into(),token:"usd.testnet".into(),request_id:"private-round".into(),input_commitment:String::new(),deadline_ms:500,worker_hash:"c".repeat(64),policies,prior_charges:vec![],encrypted_invoices:vec![],disclosure_signatures:vec![]};
        r.encrypted_invoices.push(encrypt(&r,&contribution,&secret));r.input_commitment=input_commitment(&r);authorize_disclosure(&mut r);(r,secret,contribution)
    }
    fn authorize_disclosure(r:&mut Request){
        let members=r.policies.iter().map(|p|p.account_id.clone()).collect::<Vec<_>>();
        let hash=private_disclosure_hash(&r.network,&r.vault,&r.input_commitment,&members).unwrap();
        r.disclosure_signatures=r.policies.iter().enumerate().map(|(index,p)|{let key=SigningKey::from_bytes(&[index as u8+2+(p.policy.epoch as u8-1)*10;32]);Signature{account_id:p.account_id.clone(),key_epoch:p.policy.epoch,signature:STANDARD.encode(key.sign(&hex::decode(&hash).unwrap()).to_bytes())}}).collect();
    }
    fn encrypt(r:&Request,c:&Contribution,secret:&str)->EncryptedInvoice {
        let private=StaticSecret::from([9u8;32]);let public=hex::decode(encryption_public_key(secret).unwrap()).unwrap();let peer=PublicKey::from(<[u8;32]>::try_from(public).unwrap());
        let shared=private.diffie_hellman(&peer);let mut key=[0u8;32];Hkdf::<Sha256>::new(None,shared.as_bytes()).expand(b"ach-private-invoices-v4",&mut key).unwrap();
        let commitment=private_invoice_commitment(&c.spec,&r.network,&r.vault,&c.salt).unwrap();let nonce=[8u8;12];let aad=private_envelope_aad(&r.network,&r.vault,&r.worker_hash,&commitment);
        let mut clear=serde_json::to_vec(c).unwrap();assert!(clear.len()<=PRIVATE_INVOICE_PADDING_BYTES);clear.resize(PRIVATE_INVOICE_PADDING_BYTES,b' ');
        let ciphertext=Aes256Gcm::new_from_slice(&key).unwrap().encrypt(Nonce::from_slice(&nonce),Payload{msg:&clear,aad:&aad}).unwrap();
        EncryptedInvoice{nullifier:c.spec.charge_id(&r.network,&r.vault),commitment,ephemeral_public_key:hex::encode(PublicKey::from(&private).as_bytes()),nonce:hex::encode(nonce),ciphertext:STANDARD.encode(ciphertext)}
    }
    #[test] fn real_signatures_and_encrypted_ingress_produce_only_net_results(){let(r,s,_)=fixture();let result=compute(&r,&s,2).unwrap();assert_eq!(result.positions[0].net,"-92713");let json=serde_json::to_string(&result).unwrap();assert!(!json.contains("salt"));assert!(!json.contains("terms_hash"));assert!(!json.contains("ciphertext"));}
    #[test] fn tampering_missing_party_replay_and_expiry_fail_closed(){let(r,s,mut c)=fixture();let mut bad=r.clone();let mut bytes=STANDARD.decode(&bad.encrypted_invoices[0].ciphertext).unwrap();bytes[30]^=1;bad.encrypted_invoices[0].ciphertext=STANDARD.encode(bytes);assert_eq!(compute(&bad,&s,2).unwrap_err(),"PRIVATE_CIPHERTEXT_INVALID");bad=r.clone();bad.policies.pop();assert!(compute(&bad,&s,2).is_err());bad=r.clone();bad.encrypted_invoices.push(bad.encrypted_invoices[0].clone());bad.input_commitment=input_commitment(&bad);authorize_disclosure(&mut bad);assert_eq!(compute(&bad,&s,2).unwrap_err(),"PRIVATE_DUPLICATE_PURCHASE");assert_eq!(compute(&r,&s,500).unwrap_err(),"PRIVATE_DEADLINE");c.signatures[0].signature=STANDARD.encode([0u8;64]);bad=r.clone();bad.encrypted_invoices[0]=encrypt(&bad,&c,&s);assert_eq!(compute(&bad,&s,2).unwrap_err(),"PRIVATE_SIGNATURE_INVALID");}
    #[test] fn accepted_charge_survives_invoice_expiry_and_signer_rotation(){let(mut r,s,_)=fixture();r.prior_charges=compute(&r,&s,2).unwrap().charges;for(index,p)in r.policies.iter_mut().enumerate(){p.policy.epoch=2;p.policy.key=hex::encode(SigningKey::from_bytes(&[index as u8+12;32]).verifying_key().to_bytes());}r.deadline_ms=1500;r.input_commitment=input_commitment(&r);authorize_disclosure(&mut r);assert!(compute(&r,&s,1100).is_ok());r.prior_charges[0].commitment="d".repeat(64);assert!(compute(&r,&s,1100).is_err());}
    #[test] fn receipt_verification_never_publishes_bilateral_amounts(){let(mut r,s,c)=fixture();r.operation="verify".into();r.disclosure_signatures.clear();let output=compute(&r,&s,2).unwrap();assert_eq!(output.operation,"verify");assert!(output.positions.iter().all(|p|p.net=="0"));let json=serde_json::to_string(&output).unwrap();assert!(!json.contains(&c.spec.amount.to_string()));assert!(!json.contains(&c.salt));assert!(!json.contains("terms_hash"));let mut bad=c.clone();bad.spec.amount=Amount(1);let envelope=encrypt(&r,&bad,&s);assert_eq!(r.encrypted_invoices[0].ciphertext.len(),envelope.ciphertext.len());bad.signatures[0].signature=STANDARD.encode([0u8;64]);r.encrypted_invoices[0]=encrypt(&r,&bad,&s);r.input_commitment=input_commitment(&r);assert_eq!(compute(&r,&s,2).unwrap_err(),"PRIVATE_SIGNATURE_INVALID");}
    #[test] fn relay_cannot_disclose_unapproved_sets_or_replay_disclosure(){let(mut r,s,_)=fixture();r.disclosure_signatures.clear();assert_eq!(compute(&r,&s,2).unwrap_err(),"PRIVATE_DISCLOSURE_CONSENT_REQUIRED");let(mut r,s,_)=fixture();r.request_id="isolated-price-probe".into();r.input_commitment=input_commitment(&r);assert_eq!(compute(&r,&s,2).unwrap_err(),"PRIVATE_DISCLOSURE_SIGNATURE_INVALID");r.operation="verify".into();assert_eq!(compute(&r,&s,2).unwrap_err(),"PRIVATE_OPERATION_INVALID");}
}
