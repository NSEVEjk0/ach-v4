export interface RouteToken {assetId:string;blockchain:string;symbol:string;decimals:number;price?:number}
const names:Record<string,string>={abs:'Abstract',adi:'ADI',aleo:'Aleo',aptos:'Aptos',arb:'Arbitrum',avax:'Avalanche',base:'Base',bch:'Bitcoin Cash',bera:'Berachain',bsc:'BNB Chain',btc:'Bitcoin',cardano:'Cardano',dash:'Dash',doge:'Dogecoin',eth:'Ethereum',fogo:'Fogo',gnosis:'Gnosis',hlevm:'HyperEVM',hood:'Hood',hypercore:'HyperCore',ltc:'Litecoin',miden:'Miden',monad:'Monad',movement:'Movement',near:'NEAR',op:'Optimism',plasma:'Plasma',pol:'Polygon',prl:'Pearl',qtc:'Quantus',scroll:'Scroll',sol:'Solana',starknet:'Starknet',stellar:'Stellar',sui:'Sui',ton:'TON',tron:'Tron',xlayer:'X Layer',xrp:'XRP Ledger',zec:'Zcash'};
export const chainName=(chain:string)=>names[chain]??chain;
export function parseTokenAmount(value:string,decimals:number):string{
 if(!Number.isInteger(decimals)||decimals<0||decimals>36||value.length>80||!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value))throw new Error('INVALID_ROUTE_AMOUNT');
 const[whole,fraction='']=value.split('.');
 if(fraction.length>decimals)throw new Error('INVALID_ROUTE_AMOUNT');
 const amount=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 if(amount<=0n||amount.toString().length>78)throw new Error('INVALID_ROUTE_AMOUNT');
 return amount.toString();
}
export function tokenAmount(value:string,decimals:number):string{
 if(!/^(0|[1-9]\d*)$/.test(value)||!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('INVALID_ROUTE_AMOUNT');
 if(!decimals)return BigInt(value).toString();
 const digits=BigInt(value).toString().padStart(decimals+1,'0');
 const fraction=digits.slice(-decimals).replace(/0+$/,'').padEnd(Math.min(decimals,2),'0');
 return `${digits.slice(0,-decimals)}${fraction?'.'+fraction:''}`;
}
export function suggestedAmount(token:RouteToken):string{
 if(/^(?:USDC|USDT)$/.test(token.symbol))return '10';
 const amount=token.price&&Number.isFinite(token.price)&&token.price>0?10/token.price:1;
 const value=amount.toFixed(Math.min(token.decimals,8)).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 return Number(value)>0?value:token.decimals?`0.${'0'.repeat(token.decimals-1)}1`:'1';
}
export function addressHint(chain:string):string{
 if(chain==='near')return 'A mainnet NEAR account, such as your-account.near.';
 if(chain==='xrp')return 'Use a classic address or an X-address that encodes its destination tag. Separate tags are unsupported by 1Click.';
 if(chain==='stellar')return 'Use your Stellar receiving address. Funding from Stellar uses a memo deposit route.';
 if(chain==='zec')return 'Use a transparent Zcash address (t1, t3 or tex1). Shielded recipients are unsupported by 1Click.';
 return `Use a ${chainName(chain)} mainnet address. The quote provider checks its format and route availability.`;
}
