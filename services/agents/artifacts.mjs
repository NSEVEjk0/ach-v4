import { v4Digest } from '../../packages/client/dist/v4.js';
const xml = s => String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export const SOURCE_CORPUS = Object.freeze([
  {name:'NEAR fungible-token standard',url:'https://github.com/near/NEPs/blob/master/neps/nep-0141.md',finding:'Settlement tokens use authenticated transfer callbacks; quotes do not create a deposit.'},
  {name:'NEAR Intents',url:'https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api',finding:'Conversion and cross-chain movement happen before or after ACH clearing.'},
  {name:'OutLayer confidential computation',url:'https://app.outlayer.ai/docs/secrets',finding:'Private inputs need encrypted ingress and an exact approved build.'},
]);
export const EXAMPLE_DATA=Object.freeze([{label:'Research calls',value:120},{label:'Chart generation',value:85},{label:'Quality checks',value:64}]);
export function referencePacket(brief,data){return{kind:'references',title:brief.slice(0,100),summary:'A reference packet for the requested chart. The audit checks schema and source URLs; the supplied values remain the dataset owner’s responsibility.',references:SOURCE_CORPUS.map(r=>({...r})),data,source_date:'2026-11-10',data_label:'User-supplied structured data'};}
export function auditPacket(data,references){
  const problems=[];if(!Array.isArray(data)||data.length<1||data.length>12)problems.push('Dataset must contain 1–12 rows.');
  for(const row of Array.isArray(data)?data:[])if(!row||typeof row.label!=='string'||row.label.length>80||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.label)||!Number.isFinite(row.value)||row.value<0||row.value>10000)problems.push('Invalid label or numeric value.');
  if(!Array.isArray(references)||references.some(r=>!r||!SOURCE_CORPUS.some(s=>s.url===r.url)))problems.push('Provenance does not match the known reference corpus.');
  return{kind:'audit',valid:problems.length===0,checks:['bounded numeric schema','complete labels','known source URLs'],problems,rows:data?.length??0};
}
export function chartArtifact(brief,data,audit){
  if(audit&&!audit.valid)throw new Error('AUDIT_REFUSED_DELIVERY');
  const checked=auditPacket(data,SOURCE_CORPUS);if(!checked.valid)throw new Error('INVALID_CHART_DATA');
  const largest=Math.max(0.001,...data.map(r=>r.value));const rows=data.map((r,index)=>{const y=106+index*65;const width=Math.round(r.value/largest*420);return`<text x="32" y="${y}" fill="#56636b" font-size="13">${xml(r.label)}</text><rect x="180" y="${y-15}" width="${width}" height="24" fill="${index===data.length-1?'#cb4b32':'#172328'}"/><text x="${192+width}" y="${y+2}" fill="#172328" font-size="14">${r.value.toFixed(2)}</text>`;}).join('');
  const height=156+data.length*65;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${height}" viewBox="0 0 720 ${height}" role="img" aria-labelledby="title description"><title id="title">${xml(brief.slice(0,100))}</title><desc id="description">Chart created by Visual Studio from the supplied dataset.</desc><rect width="720" height="${height}" fill="#fcfdfd"/><path d="M32 65H688" stroke="#d4dce0"/><text x="32" y="40" fill="#172328" font-family="Arial,sans-serif" font-size="20">${xml(brief.slice(0,58))}</text><g font-family="Arial,sans-serif">${rows}<text x="32" y="${height-28}" fill="#56636b" font-size="12">SUPPLIED DATASET${audit?' · SCHEMA VERIFIED':''}</text></g></svg>`;
  return{kind:'chart',title:brief.slice(0,100),svg,data,audit:audit??null,sha256:v4Digest(svg)};
}
export function isSafeSvg(svg){
  if(typeof svg!=='string'||svg.length>50_000||!/^<svg\b/.test(svg)||!/<\/svg>$/.test(svg)||/<!|<\?|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(svg))return false;
  const allowed=new Set(['svg','g','title','desc','rect','path','text','line','polyline','polygon','circle','ellipse']);
  const attributes=new Set(['xmlns','width','height','viewBox','role','aria-labelledby','id','x','y','cx','cy','r','rx','ry','x1','x2','y1','y2','d','points','fill','stroke','stroke-width','font-size','font-family','transform']);
  const tags=svg.match(/<[^>]*>/g)??[];
  return tags.every(tag=>{
    const match=/^<(\/?)([a-z]+)\b/.exec(tag);if(!match||!allowed.has(match[2]))return false;
    let rest=tag.slice(match[0].length).replace(/\/?\s*>$/,'');if(match[1])return !rest.trim();
    const seen=new Set();
    while(rest.trim()){
      const attribute=/^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if(!attribute||!attributes.has(attribute[1])||seen.has(attribute[1]))return false;
      const name=attribute[1],value=attribute[2]??attribute[3];seen.add(name);rest=rest.slice(attribute[0].length);
      if(name==='xmlns'&&value!=='http://www.w3.org/2000/svg')return false;
      if(['fill','stroke'].includes(name)&&!/^(?:#[a-fA-F\d]{3,8}|[a-zA-Z]+)$/.test(value))return false;
    }
    return true;
  });
}
export function validateArtifact(service,artifact){
  if(service==='references')return artifact?.kind==='references'&&auditPacket(artifact.data,artifact.references).valid;
  if(service==='audit')return artifact?.kind==='audit'&&artifact.valid===true&&Array.isArray(artifact.checks);
  if(service==='chart')return artifact?.kind==='chart'&&isSafeSvg(artifact.svg)&&artifact.sha256===v4Digest(artifact.svg)&&auditPacket(artifact.data,SOURCE_CORPUS).valid;
  return false;
}
