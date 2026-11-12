import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {seal} from '../src/email-capture.js';
import {EmailScanJob} from '../src/email-scan-job.js';
export const key=Buffer.alloc(32,9).toString('base64');
export function memoryStorage(){
  const map=new Map();let serial=Promise.resolve();
  const store={alarm:null,async get(k){return structuredClone(map.get(k));},async put(k,v){map.set(k,structuredClone(v));},async delete(k){map.delete(k);},async deleteAll(){map.clear();store.alarm=null;},async setAlarm(at){store.alarm=at;},async deleteAlarm(){store.alarm=null;},transaction(fn){const result=serial.then(()=>fn(store));serial=result.catch(()=>{});return result;}};
  return store;
}
export async function jobEnvironment(t){
  const db=new DatabaseSync(':memory:');
  for(const name of ['0001_email_capture','0002_manual_email_scans','0003_receipt_parser_versions','0004_background_email_jobs'])db.exec(readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));
  const stats={batches:0,statements:0};
  const prepare=sql=>{let args=[];return {bind(...v){args=v;return this;},async first(){stats.statements++;return db.prepare(sql).get(...args)||null;},async all(){stats.statements++;return {results:db.prepare(sql).all(...args)};},async run(){stats.statements++;return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};};
  const EMAIL_DB={prepare,async batch(items){stats.batches++;db.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const env={EMAIL_DB,EMAIL_TOKEN_KEY:key,EMAIL_OAUTH_CLIENT_ID:'client',EMAIL_OAUTH_CLIENT_SECRET:'secret',EMAIL_CAPTURE_ENABLED:'true',EMAIL_CALLBACK_URL:'https://example.test/callback'};
  const account={id:'mailbox',owner:'google:owner',mailbox_sub:'user',timezone:'UTC',currency:'USD'};
  await prepare('INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(account.id,account.owner,account.mailbox_sub,'test@example.test',await seal('refresh',key,`${account.owner}:${account.id}`),'UTC',0,0,'USD',0).run();
  const storage=memoryStorage();
  const make=async()=>{const ctx={storage,blockConcurrencyWhile(fn){ctx.ready=fn();}};const instance=new EmailScanJob(ctx,env);await ctx.ready;return instance;};
  const job=await make();
  env.EMAIL_SCAN_JOBS={idFromName:value=>value,get:()=>({fetch:req=>job.fetch(req)})};
  t?.after(()=>db.close());
  const call=async(op,data={})=>{const response=await job.fetch(new Request(`https://mailbox/${op}`,{method:'POST',body:JSON.stringify({...data,owner:account.owner,accountId:account.id})}));return {response,...await response.json()};};
  return {env,db,stats,account,storage,job,make,call,close:()=>db.close()};
}
export function mockGoogle(t,fn){const old=globalThis.fetch;globalThis.fetch=async(url,init)=>{const result=await fn(String(url),init);return result instanceof Response?result:Response.json(result);};t.after(()=>{globalThis.fetch=old;});}
export function receiptMessage(id='one'){
  const body='Your payment has been received\nMerchant: Example Energy\nPayment date: 2026-11-10\nAmount paid: USD 132.26';
  return {id,internalDate:String(Date.parse('2026-11-10T12:00:00Z')),snippet:'Your payment has been received',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Payment received'},{name:'From',value:'Example Energy <receipt@energy.example>'}],body:{data:Buffer.from(body).toString('base64url')}}};
}
