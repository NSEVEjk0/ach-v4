import {v4NetPlan} from '../../packages/client/dist/v4.js';

// Search bounded graph candidates, then rank feasible groups by the amount of
// business cleared. This is not an exhaustive search over all 2^48 subsets.
export function clearingCandidates(invoices, balances) {
  const eligible=invoices.slice(0,48), wallets=new Map(balances.map(b=>[b.account_id,b]));
  const candidates=new Map(), adjacency=new Map();
  const add=items=>{if(items.length)candidates.set(items.map(i=>i.spec.id).sort().join('\0'),items);};
  add(eligible);
  for(const invoice of eligible){
    const {buyer,seller}=invoice.spec;
    if(!adjacency.has(buyer))adjacency.set(buyer,[]);
    if(!adjacency.has(seller))adjacency.set(seller,[]);
    adjacency.get(buyer).push(invoice);
  }
  const members=[...adjacency.keys()].sort();
  for(const root of members){
    const connected=new Set([root]),queue=[root];
    while(queue.length){const current=queue.shift();for(const i of eligible){if(i.spec.buyer!==current&&i.spec.seller!==current)continue;for(const party of [i.spec.buyer,i.spec.seller])if(!connected.has(party)){connected.add(party);queue.push(party);}}}
    add(eligible.filter(i=>connected.has(i.spec.buyer)&&connected.has(i.spec.seller)));
  }
  let visits=0;
  for(const root of members){
    const walk=(current,path,seen)=>{
      if(++visits>4096)return;
      for(const invoice of adjacency.get(current)??[]){
        const next=invoice.spec.seller;
        if(next===root){if(path.length)add([...path,invoice]);continue;}
        if(next<root||seen.has(next)||seen.size>=12)continue;
        walk(next,[...path,invoice],new Set([...seen,next]));
      }
    };
    walk(root,[],new Set([root]));
  }
  for(const invoice of eligible)add([invoice]);
  const feasible=[];
  for(const items of candidates.values()){
    let plan;try{plan=v4NetPlan(items.map(i=>i.spec));}catch{continue;}
    if(plan.positions.some(p=>{
      const w=wallets.get(p.account_id),required=BigInt(p.net)<0n?-BigInt(p.net):0n;
      return !w||required>BigInt(w.available)||w.policy&&required>BigInt(w.policy.max_net_commitment);
    }))continue;
    feasible.push({invoices:items,plan});
  }
  return feasible.sort((a,b)=>{
    const gross=BigInt(b.plan.gross_invoice_volume)-BigInt(a.plan.gross_invoice_volume);
    if(gross)return gross>0n?1:-1;
    const net=BigInt(a.plan.net_settlement_volume)-BigInt(b.plan.net_settlement_volume);
    return net?net>0n?1:-1:a.invoices.map(i=>i.spec.id).sort().join().localeCompare(b.invoices.map(i=>i.spec.id).sort().join());
  });
}
