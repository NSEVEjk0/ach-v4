use super::*;
use std::collections::BTreeSet;

pub const SPONSORED_RECORD_LIMIT: u64 = 128;
// The coordinator serves all sponsored identities, rather than one visitor.
// Keep it bounded while allowing the 512-account deployment to use its quota.
pub const COORDINATOR_RECORD_LIMIT: u64 = 4096;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicPurchaseTerms {
    pub amount: Amount,
    pub service: String,
    pub terms_hash: String,
    pub artifact_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FundingOrder {
    pub purchase_id: String,
    pub terms_version: u32,
    pub buyer: String,
    pub seller: String,
    pub order_commitment: String,
    pub public_terms: Option<PublicPurchaseTerms>,
}

impl FundingOrder {
    pub fn charge_id(&self, network: &str, vault: &str) -> String {
        let mut c = Canonical::new("purchase-charge", network, vault);
        c.field(&self.buyer).field(&self.purchase_id).field(&self.terms_version.to_string());
        c.hash()
    }

    fn spec(&self, network: &str, vault: &str, token: &str, deadline: u64) -> Option<InvoiceSpec> {
        self.public_terms.as_ref().map(|t| InvoiceSpec {
            id: format!("bill-{}", self.charge_id(network, vault)), purchase_id: self.purchase_id.clone(),
            terms_version: self.terms_version, buyer: self.buyer.clone(), seller: self.seller.clone(),
            asset: token.into(), amount: t.amount, service: t.service.clone(),
            terms_hash: t.terms_hash.clone(), artifact_hash: t.artifact_hash.clone(),
            ready_at_ms: 0, expires_at_ms: deadline,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FundingGroupInput {
    pub id: String,
    pub orders: Vec<FundingOrder>,
    pub positions: Vec<Position>,
    pub deadline_ms: u64,
    pub private: bool,
}

impl FundingGroupInput {
    pub fn hash(&self, network: &str, vault: &str) -> Result<String> {
        valid_id(&self.id)?;
        let limit = if self.private { MAX_PRIVATE_INVOICES } else { MAX_INVOICES };
        ensure(!self.orders.is_empty() && self.orders.len() <= limit, "PURCHASE_GROUP_LIMIT")?;
        validate_positions(&self.positions)?;
        let mut orders = self.orders.clone();
        orders.sort_by_key(|o| o.charge_id(network, vault));
        let mut members = BTreeSet::new();
        let mut charges = BTreeSet::new();
        let mut c = Canonical::new("purchase-group", network, vault);
        c.field(&self.id).field(&self.deadline_ms.to_string())
            .field(if self.private { "private" } else { "public" }).count(orders.len());
        for o in &orders {
            valid_id(&o.purchase_id)?; valid_account(&o.buyer)?; valid_account(&o.seller)?;
            valid_hash(&o.order_commitment)?;
            ensure(o.buyer != o.seller && o.terms_version > 0, "INVALID_PURCHASE_ORDER")?;
            ensure(charges.insert(o.charge_id(network, vault)), "DUPLICATE_PURCHASE")?;
            members.insert(o.buyer.clone()); members.insert(o.seller.clone());
            c.field(&o.purchase_id).field(&o.terms_version.to_string()).field(&o.buyer)
                .field(&o.seller).field(&o.order_commitment);
            if self.private {
                ensure(o.public_terms.is_none() && o.purchase_id.len() >= 32, "PRIVATE_ORDER_DISCLOSURE")?;
            } else {
                let t = o.public_terms.as_ref().ok_or("PUBLIC_PURCHASE_TERMS_REQUIRED")?;
                ensure(t.amount.0 > 0, "INVALID_AMOUNT")?; valid_id(&t.service)?;
                valid_hash(&t.terms_hash)?; valid_hash(&t.artifact_hash)?;
                c.field(&t.amount.to_string()).field(&t.service).field(&t.terms_hash).field(&t.artifact_hash);
            }
        }
        let mut ps = self.positions.clone(); ps.sort_by(|a, b| a.account_id.cmp(&b.account_id));
        ensure(members.into_iter().eq(ps.iter().map(|p| p.account_id.clone())), "PURCHASE_GROUP_MEMBER_MISMATCH")?;
        c.count(ps.len()); for p in ps { c.field(&p.account_id).field(&p.net); }
        Ok(c.hash())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FundingGroup {
    pub input: FundingGroupInput,
    pub hash: String,
    pub proposer: String,
    pub status: String,
    pub approvals: Vec<Approval>,
    pub round_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PurchaseAuthorization {
    pub group_id: String,
    pub order: FundingOrder,
    pub authority: Acceptance,
    pub status: String,
    pub invoice_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProposePurchaseGroup { pub input: FundingGroupInput }

impl<'a, S: Store> Vault<'a, S> {
    pub(super) fn order_activity_sequence(&self, charge: &str, account: &str) -> Result<u64> {
        self.s.read(&format!("funded-activity:{charge}:{account}"))?.ok_or("FUNDED_ACTIVITY_SLOT_MISSING".into())
    }

    pub(super) fn funding_group(&self, id: &str) -> Result<FundingGroup> {
        self.s.read(&key("funding-group", id))?.ok_or_else(|| "PURCHASE_GROUP_NOT_FOUND".into())
    }

    pub(super) fn save_funding_group(&mut self, g: &FundingGroup) -> Result<()> {
        let storage_key = key("funding-group", &g.input.id);
        self.s.write(&storage_key, g)?;
        let mut terminal = g.clone();
        terminal.status = "COLLECTING".into(); // Longest supported state name.
        terminal.round_id = Some(if g.input.private { "r".repeat(96) } else { g.input.id.clone() });
        self.s.reserve_for(&storage_key, &terminal)
    }

    pub(super) fn sponsored_record(&mut self, account: &str) -> Result<()> {
        let mut w = self.wallet(account)?;
        let limit = if account == self.c.coordinator_id { COORDINATOR_RECORD_LIMIT } else { SPONSORED_RECORD_LIMIT };
        ensure(w.sponsored_records < limit, "SPONSORED_RECORD_LIMIT")?;
        w.sponsored_records += 1; self.save_wallet(&w)
    }

    pub(super) fn propose_purchase_group(&mut self, a: ProposePurchaseGroup) -> Result<Value> {
        let input = a.input;
        let hash = input.hash(&self.c.network, &self.c.vault)?;
        let mut namespace = Canonical::new("purchase-group-proposer", &self.c.network, &self.c.vault);
        namespace.field(&self.ctx.predecessor);
        ensure(input.id.starts_with(&format!("pg-{}-", &namespace.hash()[..32])), "PURCHASE_GROUP_PROPOSER_NAMESPACE_REQUIRED")?;
        ensure(input.positions.iter().any(|p| p.account_id == self.ctx.predecessor), "PURCHASE_GROUP_PARTICIPANT_REQUIRED")?;
        self.authority(&self.ctx.predecessor, None, false)?;
        if let Some(g) = self.s.read::<FundingGroup>(&key("funding-group", &input.id))? {
            ensure(g.hash == hash, "REQUEST_ID_CONFLICT")?; return value(&g);
        }
        ensure(self.s.get(&key("round", &input.id)).is_none(), "REQUEST_ID_CONFLICT")?;
        ensure(self.s.get(&key("private-request", &input.id)).is_none(), "REQUEST_ID_CONFLICT")?;
        self.validate_deadline(input.deadline_ms)?;
        for p in &input.positions { self.wallet(&p.account_id)?; }
        if !input.private {
            let specs = input.orders.iter().map(|o| o.spec(&self.c.network, &self.c.vault, &self.c.token, input.deadline_ms).unwrap()).collect::<Vec<_>>();
            ensure(net_invoices(&specs)?.positions == {
                let mut ps = input.positions.clone(); ps.sort_by(|a, b| a.account_id.cmp(&b.account_id)); ps
            }, "PURCHASE_GROUP_NET_MISMATCH")?;
        } else { ensure(self.c.private_worker.is_some(), "PRIVATE_MODE_UNAVAILABLE")?; }
        let proposer = self.ctx.predecessor.clone();
        self.sponsored_record(&proposer)?; self.add_proposal(&proposer)?;
        let g = FundingGroup { input, hash, proposer, status: "COLLECTING".into(), approvals: vec![], round_id: None };
        self.save_funding_group(&g)?; value(&g)
    }

    pub(super) fn authorize_purchase_group(&mut self, a: Authorize) -> Result<Value> {
        let mut g = self.funding_group(&a.id)?;
        ensure(g.hash == a.expected_hash, "PURCHASE_GROUP_HASH_MISMATCH")?;
        let p = g.input.positions.iter().find(|p| p.account_id == self.ctx.predecessor).cloned().ok_or("PURCHASE_GROUP_PARTICIPANT_REQUIRED")?;
        ensure(p.net == a.expected_net, "EXACT_NET_AUTHORIZATION_REQUIRED")?;
        let authority = self.authority(&p.account_id, None, false)?;
        ensure(!g.input.private || !authority.owner, "PRIVATE_TRADING_KEY_REQUIRED")?;
        if g.approvals.iter().any(|a| a.account_id == p.account_id) { return value(&g); }
        ensure(g.status == "COLLECTING" && self.ctx.now_ms < g.input.deadline_ms, "PURCHASE_GROUP_NOT_COLLECTING")?;
        let required = p.required()?;
        if !authority.owner { ensure(required <= self.policy(&p.account_id)?.max_net_commitment.0, "NET_COMMITMENT_PERMISSION_LIMIT")?; }
        for o in &g.input.orders {
            if o.buyer != p.account_id && o.seller != p.account_id { continue; }
            if let Some(spec) = o.spec(&self.c.network, &self.c.vault, &self.c.token, g.input.deadline_ms) {
                self.authority(&p.account_id, Some(&spec), o.buyer == p.account_id)?;
            } else if !authority.owner {
                let policy = self.policy(&p.account_id)?;
                let other = if o.buyer == p.account_id { &o.seller } else { &o.buyer };
                ensure(policy.counterparties.is_empty() || policy.counterparties.contains(other), "COUNTERPARTY_NOT_ALLOWED")?;
            }
            if o.buyer == p.account_id {
                let charge = o.charge_id(&self.c.network, &self.c.vault);
                ensure(self.s.get(&key("charge", &charge)).is_none(), "PURCHASE_ALREADY_INVOICED")?;
                let mut permission = authority.clone();
                let amount = if let Some(t) = &o.public_terms { t.amount.0 } else { self.policy(&p.account_id)?.max_invoice.0 };
                self.charge_budget(&p.account_id, &mut permission, amount)?;
                self.sponsored_record(&p.account_id)?;
                self.s.write(&key("purchase-order", &charge), &PurchaseAuthorization {
                    group_id: g.input.id.clone(), order: o.clone(), authority: permission,
                    status: "AUTHORIZED".into(), invoice_id: None,
                })?;
                // Only the buyer's exact authorization occupies this purchase ID.
                self.s.write(&key("charge", &charge), &json!({"mode":"funded-order","id":g.input.id,"seller":o.seller}))?;
            }
            // Allocate each party's delivery record and activity slot while it
            // consents, so later quota consumption cannot veto a funded receipt.
            self.sponsored_record(&p.account_id)?;
            let sequence = self.wallet(&p.account_id)?.activity_count;
            self.activity(&p.account_id, "purchase-order-authorized", &g.input.id, None)?;
            self.s.write(&format!("funded-activity:{}:{}", o.charge_id(&self.c.network, &self.c.vault), p.account_id), &sequence)?;
        }
        let mut w = self.wallet(&p.account_id)?;
        ensure(w.active_authorizations < ACTIVE_LIMIT, "ACTIVE_AUTHORIZATION_LIMIT")?;
        ensure(required <= sub(w.balance.0, w.reserved.0)?, "INSUFFICIENT_AVAILABLE_BALANCE")?;
        w.reserved = Amount(add(w.reserved.0, required)?); w.active_authorizations += 1;
        self.save_wallet(&w)?;
        g.approvals.push(Approval { account_id: p.account_id.clone(), expected_net: p.net, authority,
            required: Amount(required), approved_at_ms: self.ctx.now_ms, activity_sequence: w.activity_count });
        self.activity(&p.account_id, "purchase-group-authorized", &g.input.id, Some(Amount(required)))?;
        if g.approvals.len() == g.input.positions.len() {
            for approval in &g.approvals { ensure(self.approval_valid(approval)?, "PURCHASE_GROUP_AUTHORITY_CHANGED")?; }
            g.status = "FUNDED".into();
        }
        self.save_funding_group(&g)?; value(&g)
    }

    pub(super) fn purchase_for_invoice(&self, spec: &InvoiceSpec) -> Result<PurchaseAuthorization> {
        let order: PurchaseAuthorization = self.s.read(&key("purchase-order", &spec.charge_id(&self.c.network, &self.c.vault)))?
            .ok_or("BUYER_FUNDED_ORDER_REQUIRED")?;
        let g = self.funding_group(&order.group_id)?;
        ensure(g.status == "FUNDED" && self.ctx.now_ms < g.input.deadline_ms && order.status == "AUTHORIZED", "PURCHASE_GROUP_NOT_DELIVERABLE")?;
        let t = order.order.public_terms.as_ref().ok_or("PUBLIC_PURCHASE_TERMS_REQUIRED")?;
        ensure(spec.id == format!("bill-{}", spec.charge_id(&self.c.network, &self.c.vault)), "FUNDED_INVOICE_ID_MISMATCH")?;
        ensure(spec.ready_at_ms <= self.ctx.now_ms, "FUNDED_DELIVERY_NOT_READY")?;
        ensure(spec.buyer == order.order.buyer && spec.seller == order.order.seller
            && spec.purchase_id == order.order.purchase_id && spec.terms_version == order.order.terms_version
            && spec.amount == t.amount && spec.service == t.service && spec.terms_hash == t.terms_hash
            && spec.artifact_hash == t.artifact_hash && spec.expires_at_ms == g.input.deadline_ms,
            "FUNDED_ORDER_TERMS_MISMATCH")?;
        Ok(order)
    }

    pub(super) fn ready_public_purchase_group(&mut self, id: &str) -> Result<Option<Round>> {
        let mut g = self.funding_group(id)?;
        if g.status == "READY" || g.status == "SETTLED" { return Ok(Some(self.round(g.round_id.as_deref().unwrap())?)); }
        ensure(g.status == "FUNDED" && !g.input.private && self.ctx.now_ms < g.input.deadline_ms, "PURCHASE_GROUP_NOT_DELIVERABLE")?;
        let mut invoices = vec![];
        for o in &g.input.orders {
            let authorization: PurchaseAuthorization = self.s.read(&key("purchase-order", &o.charge_id(&self.c.network, &self.c.vault)))?.ok_or("BUYER_FUNDED_ORDER_REQUIRED")?;
            let Some(invoice_id) = authorization.invoice_id else { return Ok(None); };
            let invoice = self.invoice(&invoice_id)?;
            if invoice.status != "ACCEPTED" || invoice.spec.ready_at_ms > self.ctx.now_ms { return Ok(None); }
            invoices.push(invoice);
        }
        invoices.sort_by(|a, b| a.spec.id.cmp(&b.spec.id));
        let plan = net_invoices(&invoices.iter().map(|i| i.spec.clone()).collect::<Vec<_>>())?;
        ensure(plan.positions == { let mut p = g.input.positions.clone(); p.sort_by(|a,b|a.account_id.cmp(&b.account_id)); p }, "PURCHASE_GROUP_NET_MISMATCH")?;
        let input = RoundInput { id: g.input.id.clone(), invoice_ids: invoices.iter().map(|i| i.spec.id.clone()).collect(),
            invoice_hashes: invoices.iter().map(|i| i.hash.clone()).collect(), positions: plan.positions,
            deadline_ms: g.input.deadline_ms, private: false, input_commitment: g.hash.clone(), worker_hash: String::new() };
        let r = Round { hash: input.hash(&self.c.network, &self.c.vault)?, input, proposer: g.proposer.clone(),
            status: "READY".into(), approvals: g.approvals.clone(), gross_invoice_volume: Some(plan.gross_invoice_volume),
            net_settlement_volume: plan.net_settlement_volume, created_at_ms: g.approvals[0].approved_at_ms,
            ready_at_ms: Some(self.ctx.now_ms), settled_at_ms: None, sequence: self.c.rounds, reason: None };
        for mut i in invoices { i.status = "READY".into(); i.round_id = Some(r.input.id.clone()); self.save_invoice(&i)?; }
        g.status = "READY".into(); g.round_id = Some(r.input.id.clone());
        self.save_funding_group(&g)?; self.index_round(&r)?; Ok(Some(r))
    }

    pub(super) fn expire_purchase_group(&mut self, a: Id) -> Result<Value> {
        let mut g = self.funding_group(&a.id)?;
        if g.status == "EXPIRED" { return value(&g); }
        ensure(matches!(g.status.as_str(), "COLLECTING" | "FUNDED"), "PURCHASE_GROUP_IS_IRREVOCABLE")?;
        ensure(self.ctx.now_ms >= g.input.deadline_ms, "PURCHASE_GROUP_NOT_EXPIRED")?;
        for a in &g.approvals {
            let mut w = self.wallet(&a.account_id)?;
            w.reserved = Amount(sub(w.reserved.0, a.required.0)?);
            w.active_authorizations = w.active_authorizations.checked_sub(1).ok_or("AUTHORIZATION_COUNT_CORRUPT")?;
            self.save_wallet(&w)?;
            self.finish_activity(&a.account_id, a.activity_sequence, "purchase-group-expired", &g.input.id, Some(a.required))?;
        }
        for o in &g.input.orders {
            let charge = o.charge_id(&self.c.network, &self.c.vault);
            if let Some(mut auth) = self.s.read::<PurchaseAuthorization>(&key("purchase-order", &charge))? {
                if auth.group_id != g.input.id { continue; }
                if auth.authority.budget_charge.0 > 0 {
                    let k = format!("budget:{}:{}", o.buyer, auth.authority.epoch);
                    let spent = self.budget_spent(&o.buyer, auth.authority.epoch)?;
                    self.s.write(&k, &Amount(sub(spent.0, auth.authority.budget_charge.0)?))?;
                }
                auth.status = "EXPIRED".into(); self.s.write(&key("purchase-order", &charge), &auth)?;
                if let Some(id) = &auth.invoice_id { let mut i = self.invoice(id)?; i.status = "CANCELLED".into(); self.save_invoice(&i)?; }
                if let Some(mut auth) = self.s.read::<PrivatePurchaseAuthorization>(&key("private-purchase", &charge))? {
                    auth.status = "CANCELLED".into(); self.s.write(&key("private-purchase", &charge), &auth)?;
                }
                if let Some(mut i) = self.s.read::<PrivateInvoice>(&key("private-invoice", &charge))? {
                    i.status = "CANCELLED".into(); self.s.write(&key("private-invoice", &charge), &i)?;
                }
            }
        }
        let mut proposer = self.wallet(&g.proposer)?;
        proposer.active_proposals = proposer.active_proposals.checked_sub(1).ok_or("PROPOSAL_COUNT_CORRUPT")?;
        self.save_wallet(&proposer)?;
        g.status = "EXPIRED".into(); self.save_funding_group(&g)?;
        self.recovery = true; value(&g)
    }
}
