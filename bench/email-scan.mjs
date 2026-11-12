import {performance} from 'node:perf_hooks';
import {jobEnvironment,memoryStorage,key} from '../test-support/email-job-env.js';
import {EmailScanJob} from '../src/email-scan-job.js';
import {seal} from '../src/email-capture.js';
import {inspectEmailReceipt} from '../src/email-receipts.js';
import assert from 'node:assert/strict';
const encode=s=>Buffer.from(s).toString('base64url');
function corpus(i){
 const bodies=[
  ['Your payment has been received','Merchant: Example Energy\nPayment amount: USD 132.26\nPayment date: 2026-11-10'],
  ['Transfer alert','You sent $308.12 to\nExample Services'],
  ['Thank you for your payment','<table><tr><th>Fee Date</th><th>Amount Paid</th></tr><tr><td>11/01/2026</td><td>320.00</td></tr></table>'],
  ['Your receipt','Your transaction on Nov 8, 2026\n$19.22 — Total spent this trip\n$4 — Total saved this trip'],
  ['Payment confirmation','Amount Paid: USD 20\nAmount charged: USD 30'],
  ['Payment received','Amount Paid: EUR 19,99'],
  ['Stock market newsletter','Daily investment analysis'],
  ['Your bill is available','Amount Due: USD 234.40'],
  ['Payment successful','Amount paid: CAD 42.50'],
  ['Payment successful','<style>'+'.x{color:red}'.repeat(4000)+'</style><p>Amount Paid: MYR 120.00</p>'],
 ];
 const [subject,body]=bodies[i%bodies.length];
 return {id:`m${i}`,internalDate:String(Date.parse('2026-11-10T12:00:00Z')),snippet:subject,payload:{mimeType:body.includes('<')?'text/html':'text/plain',headers:[{name:'Subject',value:subject},{name:'From',value:'Example <receipts@example.test>'}],body:{data:encode(body)}}};
}
const samples=[];for(let i=0;i<50;i++)inspectEmailReceipt(corpus(i),'USD',{timezone:'America/Chicago'});
const cpuStart=process.cpuUsage();for(let i=0;i<1000;i++){const msg=corpus(i),start=performance.now();inspectEmailReceipt(msg,'USD',{timezone:'America/Chicago'});samples.push(performance.now()-start);}
const cpu=process.cpuUsage(cpuStart);samples.sort((a,b)=>a-b);
const h=await jobEnvironment();
// Serialize mocked D1 transactions as the real shared database does.
const baseBatch=h.env.EMAIL_DB.batch.bind(h.env.EMAIL_DB);let serial=Promise.resolve();h.env.EMAIL_DB.batch=items=>{const result=serial.then(()=>baseBatch(items));serial=result.catch(()=>{});return result;};
const jobs=[];for(let i=0;i<20;i++){
 const owner=`google:owner${i}`,accountId=`mailbox${i}`;
 await h.env.EMAIL_DB.prepare('INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(accountId,owner,`user${i}`,'synthetic@example.test',await seal('refresh',key,`${owner}:${accountId}`),'UTC',0,0,'USD',0).run();
 const ctx={storage:memoryStorage(),blockConcurrencyWhile(fn){ctx.ready=fn();}},runner=new EmailScanJob(ctx,h.env);await ctx.ready;jobs.push({runner,owner,accountId});
}
let tokens=0,lists=0,full=0,active=0,maxActive=0;
const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{
 const u=new URL(url);
 if(u.pathname==='/token'){tokens++;return Response.json({access_token:'mock',expires_in:3600});}
 if(u.pathname.endsWith('/messages')){lists++;return Response.json({messages:Array.from({length:100},(_,i)=>({id:`m${i}`})),resultSizeEstimate:100});}
 const i=Number(u.pathname.split('/').at(-1).slice(1));
 active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;
 if(u.searchParams.get('format')==='full')full++;
 return Response.json(corpus(i));
};
const oldLog=console.log;console.log=()=>{};
const started=performance.now();
try{
 await Promise.all(jobs.map(async({runner,owner,accountId})=>{
  const response=await runner.fetch(new Request('https://job/start',{method:'POST',body:JSON.stringify({owner,accountId,days:2})}));assert.equal(response.status,200);
  for(let n=0;n<10&&runner.job.status==='running';n++)await runner.alarm();
  assert.equal(runner.job.status,'complete');assert.equal(runner.job.processed,100);
 }));
}finally{globalThis.fetch=oldFetch;console.log=oldLog;h.close();}
console.log(JSON.stringify({synthetic:true,users:20,emailsPerUser:100,wallMs:Math.round(performance.now()-started),tokenRefreshes:tokens,listCalls:lists,fullBodyReads:full,maxConcurrentFetches:maxActive,localSyncParseP95Ms:Number(samples[Math.floor(samples.length*.95)].toFixed(3)),localParseCpuAverageMs:Number(((cpu.user+cpu.system)/1000/1000).toFixed(3)),note:'Mock network and SQLite: not a production latency or Cloudflare CPU measurement.'},null,2));
