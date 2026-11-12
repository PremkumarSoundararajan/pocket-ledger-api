import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {merchantFingerprint, MerchantClassificationIndex} from '../src/merchant-classifications.js';
const rule={id:'m:market',kind:'merchant',name:'Market',aliases:['MARKET REF 100'],category:'Food / Household',categoryId:'food-household',group:'Essential'};
const headers=['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID'];
async function run({records=[rule],rows=[],action='preview',body='Date,Amount,Description\n2026-10-05,100,MARKET REF 200',failMasterWrite=false}={}) {
 const original=globalThis.fetch,writes=[];
 globalThis.fetch=async(url,init={})=>{
  const path=decodeURIComponent(String(url));
  if(init.method){writes.push({url:path,...init});if(failMasterWrite&&String(init.body).includes('Merchant Classifications'))return Response.json({error:'offline'},{status:503});return Response.json({updates:{updatedRows:1}});}
  if(path.includes('?fields='))return Response.json({sheets:[{properties:{title:'Sheet1'}},{properties:{title:'Merchant Classifications'}}]});
  if(path.includes('Merchant Classifications'))return Response.json({values:[['Record ID','Classification'],...records.map(r=>[r.id,JSON.stringify(r)])]});
  if(path.includes('Expense Categories'))return Response.json({}, {status:404});
  return Response.json({values:[headers,...rows]});
 };
 try{const response=await worker.fetch(new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer user','X-Spreadsheet-ID':'sheet','X-Action':action},body}));return {status:response.status,payload:await response.json(),writes};}finally{globalThis.fetch=original;}
}
test('merchant fingerprint strips references consistently and collisions are unresolved',()=>{
 assert.equal(merchantFingerprint('MARKET REF 100'),'MARKET');
 assert.equal(merchantFingerprint('SQ *Acme Coffee #45 WEB 999'),'SQ ACME COFFEE');
 const index=new MerchantClassificationIndex([rule]);assert.equal(index.categoryFor('MARKET REF 200').category,'Food / Household');
 const ambiguous=new MerchantClassificationIndex([rule,{...rule,id:'m:other',category:'Transport'}]);assert.equal(ambiguous.categoryFor('MARKET REF 200').category,undefined);
});
test('statement preview inherits confirmed merchant category without modifying Expense Type',async()=>{
 const result=await run();assert.equal(result.status,200);assert.equal(result.payload.rows[0].category,'Food / Household');assert.equal(result.payload.rows[0].expenseType,'Unknown');assert.equal(result.writes.length,0);
});
test('known transaction exceptions outrank merchant defaults during reimport',async()=>{
 const result=await run({records:[rule,{id:'t:original',kind:'transaction',transactionId:'original',category:'Lifestyle / Misc',categoryId:'lifestyle-misc'}],rows:[['2026-10-05',100,'Lifestyle / Misc','MARKET REF 200','Planned Occasional','original','lifestyle-misc']]});
 assert.equal(result.status,200);assert.equal(result.payload.rows[0].category,'Lifestyle / Misc');assert.equal(result.payload.rows[0].expenseType,'Planned Occasional');
});
test('explicit reviewed import category persists as an exception keyed by the appended transaction ID',async()=>{
 const result=await run({action:'import',body:'Date,Amount,Description,Category,Expense Type,Category Reviewed\n2026-10-05,100,MARKET REF 200,Lifestyle / Misc,Unexpected Occasional,TRUE'});
 assert.equal(result.status,200);
 const appended=JSON.parse(result.writes.find(r=>r.url.includes(':append')).body).values[0];
 const metadata=result.writes.flatMap(r=>JSON.parse(r.body).data||[]).filter(r=>r.range.includes('Merchant Classifications'));
 const exception=JSON.parse(metadata[0].values[0][1]);
 assert.equal(exception.transactionId,appended[5]);assert.equal(exception.id,'t:'+appended[5]);assert.equal(exception.category,'Lifestyle / Misc');assert.equal(appended[4],'Unexpected Occasional');
});
test('explicit new duplicate gets its own exception instead of changing the original',async()=>{
 const result=await run({rows:[['2026-10-05',100,'Food / Household','MARKET REF 200','Regular','original','food-household']],action:'import',body:'Date,Amount,Description,Category,Expense Type,Category Reviewed,Import Anyway\n2026-10-05,100,MARKET REF 200,Lifestyle / Misc,Regular,TRUE,TRUE'});
 assert.equal(result.status,200);
 const appended=JSON.parse(result.writes.find(r=>r.url.includes(':append')).body).values[0];assert.notEqual(appended[5],'original');
 const metadata=result.writes.flatMap(r=>JSON.parse(r.body).data||[]).filter(r=>r.range.includes('Merchant Classifications'));
 assert.equal(JSON.parse(metadata[0].values[0][1]).transactionId,appended[5]);
});
test('metadata write failure is reported rather than claiming exceptions were saved',async()=>{
 const result=await run({failMasterWrite:true,action:'import',body:'Date,Amount,Description,Category,Category Reviewed\n2026-10-05,100,MARKET REF 200,Lifestyle / Misc,TRUE'});
 assert.equal(result.status,500);assert.match(result.payload.error,/No new expenses were appended/);assert.equal(result.writes.some(r=>r.url.includes(':append')),false);
});
