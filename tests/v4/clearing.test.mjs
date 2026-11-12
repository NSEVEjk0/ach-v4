import test from 'node:test';
import assert from 'node:assert/strict';
import {localWebModules}from './web-modules.mjs';

const modules=localWebModules();test.after(()=>modules.cleanup());
const {clearingSelection}=await import(modules.url('clearing'));
const parties=['aa.testnet','bb.testnet','cc.testnet'];
function fixture(privateMode=false,group='group-one'){
 const ledger=[[0,1,'100'],[1,2,'100'],[2,0,'80']].map(([buyer,seller,amount],index)=>({spec:{id:'invoice-'+group+'-'+index,purchase_id:'purchase-'+index,buyer:parties[buyer],seller:parties[seller],amount},status:'READY',round_id:group,funding_group_id:group,private:privateMode,charge_id:'charge-'+group+'-'+index}));
 const positions=parties.map((account_id,index)=>({account_id,net:['-20','0','20'][index]}));
 const round={input:{id:group,private:privateMode,positions,invoice_ids:ledger.map(invoice=>privateMode?invoice.charge_id:invoice.spec.id)},status:'READY',approvals:parties.map((account_id,index)=>({account_id,required:index===0?'20':'0'}))};
 return{ledger,rounds:[round],balances:parties.map(account_id=>({account_id,available:'0',reserved:'20'})),selected:parties,excludedBills:[],privacy:privateMode?'private':'public'};
}

test('a complete READY group can clear with zero available cash and only its own reservation',()=>{
 const input=fixture(),result=clearingSelection(input);assert.equal(result.canClear,true);assert.equal(result.plan.net,'20');assert.equal(result.underfunded.length,0);
 input.rounds[0].input.positions=input.rounds[0].input.positions.toReversed().map(position=>({net:position.net,account_id:position.account_id}));assert.equal(clearingSelection(input).canClear,true);
 for(const change of [r=>r.approvals[0].required='0',r=>r.approvals.pop(),r=>r.approvals.push({...r.approvals[0]}),r=>r.status='COLLECTING',r=>r.input.private=true]){const broken=structuredClone(input);change(broken.rounds[0]);const refused=clearingSelection(broken);assert.equal(refused.canClear,false);assert.equal(refused.metadataIncomplete,true);}
});

test('partial bill or participant selection cannot collect one side of a funded group',()=>{
 for(const change of [input=>input.excludedBills=[input.ledger[2].spec.id],input=>input.selected=parties.slice(0,2)]){const input=fixture();change(input);const result=clearingSelection(input);assert.equal(result.canClear,false);assert.equal(result.selectionIncomplete,true);}
});

test('multiple approved groups stay separate and reservations cannot fund unrelated bills',()=>{
 const input=fixture(),second=fixture(false,'group-two');input.ledger.push(...second.ledger);input.rounds.push(...second.rounds);
 let result=clearingSelection(input);assert.equal(result.approvedGroups.length,2);assert.equal(result.included.length,3);assert.equal(result.plan.net,'20');assert.equal(result.canClear,true);
 result=clearingSelection({...input,requestedGroup:'group-two'});assert.equal(result.activeGroup,'group-two');assert.ok(result.included.every(invoice=>invoice.round_id==='group-two'));
 const unrelated=fixture();unrelated.ledger=unrelated.ledger.slice(0,1).map(invoice=>({...invoice,status:'ACCEPTED',round_id:null,funding_group_id:null}));result=clearingSelection(unrelated);assert.equal(result.canClear,false);assert.equal(result.underfunded.length,1);
});

test('missing, duplicated or inconsistent round metadata disables clearing',()=>{
 for(const change of [input=>input.rounds=[],input=>input.ledger.pop(),input=>input.ledger.push(input.ledger[0]),input=>input.ledger[0].round_id=null,input=>input.rounds[0].input.positions[0].net='-21',input=>input.rounds[0].input.invoice_ids.push('missing')]){const input=fixture();change(input);const result=clearingSelection(input);assert.equal(result.canClear,false);assert.equal(result.metadataIncomplete,true);}
 const waiting=fixture();waiting.ledger.forEach(invoice=>{invoice.status='ACCEPTED';invoice.round_id=null;});waiting.rounds=[];waiting.balances[0].available='20';assert.equal(clearingSelection(waiting).canClear,false);
});

test('private groups use charge IDs and preserve the original six-receipt boundary',()=>{
 const input=fixture(true);assert.equal(clearingSelection(input).canClear,true);
 assert.equal(clearingSelection({...input,excludedBills:[input.ledger[0].charge_id]}).canClear,false);
 assert.equal(clearingSelection({...input,privacy:'public'}).included.length,0);
 for(let index=3;index<7;index++){input.ledger.push({...input.ledger[0],spec:{...input.ledger[0].spec,id:'extra-'+index,amount:'1'},charge_id:'extra-charge-'+index});}
 input.rounds[0].input.invoice_ids=input.ledger.map(invoice=>invoice.charge_id);input.rounds[0].input.positions=[{account_id:parties[0],net:'-24'},{account_id:parties[1],net:'4'},{account_id:parties[2],net:'20'}];input.rounds[0].approvals[0].required='24';assert.equal(clearingSelection(input).canClear,false);
});
