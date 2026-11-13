import {createHash} from 'node:crypto';

const evmChains=new Set(['abs','adi','arb','avax','base','bera','bsc','eth','gnosis','hlevm','hood','hypercore','monad','op','plasma','pol','scroll','xlayer']);
const base58='[1-9A-HJ-NP-Za-km-z]';
const legacy=(prefix,min=25,max=34)=>new RegExp(`^${prefix}${base58}{${min},${max}}$`);
const sha256=bytes=>createHash('sha256').update(bytes).digest();
function tronBase58(hex){
 const data=Buffer.from(hex,'hex'),bytes=Buffer.concat([data,sha256(sha256(data)).subarray(0,4)]),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let value=BigInt('0x'+bytes.toString('hex')),result='';
 while(value){result=alphabet[Number(value%58n)]+result;value/=58n;}
 return result;
}
/** Canonical forms are bound to the provider request before quote validation. */
export function normalizeIntentsAddress(chain,address){
 if(typeof address!=='string')return address;
 if(chain==='tron'&&/^41[a-fA-F\d]{40}$/.test(address))return tronBase58(address);
 if(chain==='sui'&&/^(?:0x)?[a-fA-F\d]{64}$/.test(address))return '0x'+address.replace(/^0x/,'').toLowerCase();
 if(chain==='btc'&&/^BC1[AC-HJ-NP-Z02-9]{11,87}$/.test(address))return address.toLowerCase();
 return address;
}
/** Syntax checks for known families; 1Click validates checksums and new chains. */
export function validIntentsAddress(chain,address){
 if(typeof address!=='string'||address.length<2||address.length>512||/[\s\u0000-\u001f\u007f]/.test(address))return false;
 address=normalizeIntentsAddress(chain,address);
 if(chain==='near')return address.length<=64&&/^(?:[a-z0-9]+[._-])*[a-z0-9]+$/.test(address)&&!address.endsWith('.testnet');
 if(evmChains.has(chain))return /^0x[a-fA-F\d]{40}$/.test(address);
 if(['sol','fogo'].includes(chain))return new RegExp(`^${base58}{32,44}$`).test(address);
 if(['aptos','movement','sui','starknet'].includes(chain))return /^0x[a-fA-F\d]{1,64}$/.test(address);
 if(chain==='btc')return /^(?:bc1[ac-hj-np-z02-9]{11,87})$/.test(address)||legacy('[13]').test(address);
 if(chain==='bch')return /^(?:bitcoincash:)?[qp][ac-hj-np-z02-9]{41,111}$/.test(address)||legacy('[13]').test(address);
 if(chain==='ltc')return /^ltc1[ac-hj-np-z02-9]{11,87}$/.test(address)||legacy('[LM3]').test(address);
 if(chain==='doge')return legacy('[DA]').test(address);
 if(chain==='dash')return legacy('[X7]').test(address);
 if(chain==='zec')return legacy('t[13]',32,33).test(address)||/^tex1[ac-hj-np-z02-9]{38}$/.test(address);
 if(chain==='tron')return legacy('T',33,33).test(address);
 if(chain==='stellar')return /^(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(address);
 if(chain==='xrp')return legacy('r',24,34).test(address)||legacy('X',44,64).test(address);
 if(chain==='ton')return /^(?:-?\d+:[a-fA-F\d]{64}|[A-Za-z\d_-]{48})$/.test(address);
 if(chain==='cardano')return /^addr1[ac-hj-np-z02-9]{40,160}$/.test(address)||legacy('(?:Ae2|Ddz)',30,160).test(address);
 if(chain==='aleo')return /^aleo1[ac-hj-np-z02-9]{40,100}$/.test(address);
 // Catalogue additions do not inherit EVM's address shape by default.
 return /^[A-Za-z\d:._=+/@-]{3,512}$/.test(address);
}

export const memoDepositMode=chain=>chain==='stellar'?'MEMO':'SIMPLE';
export const quoteLifetimeMs=chain=>['btc','bch','dash','doge','ltc','zec','qtc','prl'].includes(chain)?90*60*1000:10*60*1000;
