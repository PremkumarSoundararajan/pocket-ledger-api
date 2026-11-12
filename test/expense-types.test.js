import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {normalize} from '../src/index.js';
import {expenseType, recurringMerchants, suggestExpenseType} from '../src/expense-types.js';
const headers=['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID'];
const history=[['2026-01-05',100,'Lifestyle / Misc','STREAM REF 100','Unknown'],['2026-02-05',101,'Lifestyle / Misc','STREAM REF 200','Regular'],['2026-03-05',100,'Lifestyle / Misc','STREAM REF 300','Regular']];
test('four states validated, legacy and missing are Unknown',()=>{
 for(const value of [undefined,null,'','Occasional','invalid']) assert.equal(expenseType(value),'Unknown');
 for(const value of ['Regular','Planned Occasional','Unexpected Occasional','Unknown']) assert.equal(expenseType(value),value);
});
test('tax, property, and financial categories do not imply expense type',()=>{
 for(const description of ['PROPERTY TAX','BANK FEE','GROCERY']) {
  assert.equal(normalize([['Date','Amount','Description'],['2026-04-05','100',description]])[0].expenseType,'Unknown');
 }
});
test('strong monthly recurrence suggests Regular, including normalized references',()=>{
 assert.equal(suggestExpenseType({date:'2026-04-05',amount:101,description:'STREAM REF 400'},recurringMerchants(history)),'Regular');
 assert.equal(suggestExpenseType({date:'2026-04-05',amount:500,description:'STREAM REF 400'},recurringMerchants(history)),'Unknown');
});
test('insufficient months, frequent shopping, inconsistent intervals and amounts stay Unknown',()=>{
 const variants=[history.slice(1),[...history,['2026-02-07',100,'','STREAM']],history.map((r,i)=>[i===1?'2026-02-25':r[0],...r.slice(1)]),history.map((r,i)=>[r[0],i===1?500:r[1],...r.slice(2)])];
 for(const rows of variants) assert.equal(recurringMerchants(rows).size,0);
});
test('utilities permit configurable amount variation',()=>{
 const rows=history.map((r,i)=>[r[0],[100,120,90][i],r[2],'WATER UTILITY']);
 assert.equal(recurringMerchants(rows).size,1);
 assert.equal(recurringMerchants(rows,{utilityTolerance:.01}).size,0);
});
async function request({rows=[],body,action='preview'}) {
 const original=globalThis.fetch;const writes=[];
 globalThis.fetch=async(url,init={})=>{
  const u=String(url);
  if(init.method) { writes.push({url:u,...init});return Response.json({updates:{updatedRows:1}}); }
  if(u.includes('?fields=sheets.properties')) return Response.json({sheets:[{properties:{title:'Sheet1'}}]});
  if(u.includes('ExpenseCategories')) return Response.json({values:[]});
  return Response.json({values:[headers,...rows]});
 };
 try { const response=await worker.fetch(new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer test','X-Spreadsheet-ID':'test','X-Action':action},body}));return {status:response.status,payload:await response.json(),writes}; }
 finally {globalThis.fetch=original;}
}
test('same-transaction stored type takes precedence over recurrence and preview causes no writes',async()=>{
 const row=['2026-04-05',100,'Lifestyle / Misc','STREAM REF 400','Unexpected Occasional','tx','lifestyle'];
 const result=await request({rows:[...history,row],body:'Date,Amount,Description\n2026-04-05,100,STREAM REF 400'});
 assert.equal(result.status,200);assert.equal(result.payload.rows[0].expenseType,'Unexpected Occasional');assert.equal(result.writes.length,0);
});
test('preview suggests recurring or Unknown without keyword fallback',async()=>{
 const result=await request({rows:history,body:'Date,Amount,Description\n2026-04-05,100,STREAM REF 400\n2026-04-06,250,PROPERTY TAX'});
 assert.deepEqual(result.payload.rows.map(r=>r.expenseType),['Regular','Unknown']);
});
test('reviewed override updates only type cell of matched transaction alongside category cells',async()=>{
 const result=await request({rows:[['2026-04-05',100,'Lifestyle / Misc','STREAM','Regular','tx','lifestyle']],action:'import',body:'Timestamp,Amount,Category,Description,Expense Type,Expense Type Reviewed,Import Anyway\n2026-04-05,100,Lifestyle / Misc,STREAM,Planned Occasional,TRUE,FALSE'});
 assert.equal(result.status,200);assert.equal(result.payload.updated,1);assert.equal(result.payload.appended,0);
 const update=result.writes.find(x=>x.url.includes('/values:batchUpdate') && JSON.parse(x.body).data.some(c=>c.range==='Sheet1!E2'));
 assert.ok(JSON.parse(update.body).data.some(x=>x.range==='Sheet1!E2' && x.values[0][0]==='Planned Occasional'));
});
test('category-only review never rewrites legacy type, explicit Unknown round trips on new import',async()=>{
 const result=await request({rows:[['2026-04-05',100,'Lifestyle / Misc','STREAM','Occasional','tx','lifestyle']],action:'import',body:'Timestamp,Amount,Category,Description,Expense Type,Expense Type Reviewed\n2026-04-05,100,Transport,STREAM,Unknown,FALSE'});
 const data=JSON.parse(result.writes.find(x=>x.url.includes(':batchUpdate')).body).data;
 assert.ok(!data.some(x=>x.range.startsWith('Sheet1!E')));
 const imported=await request({rows:history,action:'import',body:'Timestamp,Amount,Category,Description,Expense Type,Expense Type Reviewed\n2026-04-05,100,Lifestyle / Misc,STREAM REF 400,Unknown,TRUE'});
 assert.equal(imported.status,200);
 assert.equal(JSON.parse(imported.writes.find(x=>x.url.includes(':append')).body).values[0][4],'Unknown');
});

test('recurrence suggestion requires the next expected billing interval', () => {
 const patterns=recurringMerchants(history);
 assert.equal(suggestExpenseType({date:'2026-03-06',amount:100,description:'STREAM'},patterns),'Unknown');
 assert.equal(suggestExpenseType({date:'2026-06-05',amount:100,description:'STREAM'},patterns),'Unknown');
 const mixed=history.map((row,index)=>index===1?[...row.slice(0,4),'Planned Occasional']:row);
 assert.equal(recurringMerchants(mixed).size,0);
});
test('all four reviewed values survive new-row save without reclassification',async()=>{
 const types=['Regular','Planned Occasional','Unexpected Occasional','Unknown'];
 const body='Timestamp,Amount,Category,Description,Expense Type,Expense Type Reviewed\n'+types.map((type,index)=>`2026-04-05,${100+index},Lifestyle / Misc,SHOP ${index},${type},TRUE`).join('\n');
 const result=await request({action:'import',body});
 assert.equal(result.status,200);
 assert.deepEqual(JSON.parse(result.writes.find(row=>row.url.includes(':append')).body).values.map(row=>row[4]),types);
});
