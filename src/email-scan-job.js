import {seal,unseal,digest,manualScanRange,refreshEmailAccess,emailGoogle} from './email-capture.js';
import {inspectEmailReceipt,receiptParserVersion} from './email-receipts.js';
import {receiptTimezone} from './email-receipt-dates.js';

const PAGE_SIZE=100,BATCH_SIZE=25,CONCURRENCY=5;
const messageFields='id,internalDate,snippet,payload';
const metadataFields='id,internalDate,snippet,payload(headers)';
export function publicEmailJob(job){
  if(!job)return null;
  const {id,status,from,to,processed,estimated,ready,review,ignored,error,retryAt,createdAt,updatedAt}=job;
  return {id,status,from,through:to,processed,estimated,ready,review,ignored,error,retryAt,createdAt,updatedAt};
}
export async function mapEmailConcurrent(values,fn){
  const out=new Array(values.length);let next=0,failure;
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,values.length)},async()=>{
    for(;;){const index=next++;if(index>=values.length||failure)return;try{out[index]=await fn(values[index]);}catch(error){failure=error;return;}}
  }));if(failure)throw failure;return out;
}
export function metadataIsNonReceipt(message){
  const headers=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
  const subject=headers.subject||'',snippet=message.snippet||'';
  return /\b(?:newsletter|things to watch|stock market|market outlook|daily digest|investment ideas)\b/i.test(subject)
    &&! /\b(?:receipt|invoice|payment|transaction|purchase|charged|paid)\b/i.test(`${subject} ${snippet}`);
}

// One object per owner/mailbox. Only explicit start/resume schedules alarms.
export class EmailScanJob {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.job=null;this.access=null;this.control=Promise.resolve();
    ctx.blockConcurrencyWhile(async()=>{this.job=await ctx.storage.get('job')||null;});
  }
  current(job){return this.job?.id===job.id&&this.job.revision===job.revision&&this.job.status==='running';}
  async storeControl(job){
    await this.ctx.storage.transaction(async tx=>{
      await tx.put('job',job);
      if(job.status==='running')await tx.setAlarm(Date.now()+1);else await tx.deleteAlarm();
    });
  }
  async fetch(req){
    const data=await req.json();
    if(this.job&&(this.job.owner!==data.owner||this.job.accountId!==data.accountId))return Response.json({error:'Mailbox job not found.'},{status:404});
    const op=new URL(req.url).pathname;
    if(op==='/progress')return Response.json({job:publicEmailJob(this.job)});
    const operation=this.control.then(()=>this.mutate(op,data));
    this.control=operation.catch(()=>{});
    try{return Response.json(await operation);}catch(error){return Response.json({error:error.message||'Could not update scan job.'},{status:error.status||500});}
  }
  async mutate(op,data){
    if(op==='/delete'){this.job=null;this.access=null;await this.ctx.storage.deleteAll();return {deleted:true};}
    const account=await this.env.EMAIL_DB.prepare('SELECT * FROM email_accounts WHERE id=? AND owner=?').bind(data.accountId,data.owner).first();
    if(!account)throw Object.assign(Error('Mailbox not found.'),{status:404});
    if(op==='/pause'){
      if(!this.job||this.job.status==='complete')return {job:publicEmailJob(this.job)};
      this.job={...this.job,status:'paused',revision:this.job.revision+1,updatedAt:Date.now()};
      await this.env.EMAIL_DB.prepare('UPDATE email_accounts SET job_id=?,scan_start=NULL WHERE id=? AND owner=?').bind(`${this.job.id}:${this.job.revision}`,account.id,account.owner).run();
      await this.storeControl(this.job);return {job:publicEmailJob(this.job)};
    }
    if(op!=='/start')throw Object.assign(Error('Unknown job action.'),{status:404});
    if(data.resume&&this.job&&this.job.to-this.job.from>30*86400000)throw Object.assign(Error('Start a new scan of up to 30 days. Use statements for older expenses.'),{status:400});
    if(data.resume&&this.job&&account.job_id===`${this.job.id}:${this.job.revision}`){
      if(this.job.status!=='complete'){
        const next={...this.job,status:'running',retry:0,error:null,retryAt:null,revision:this.job.revision+1,updatedAt:Date.now()};
        const update=await this.env.EMAIL_DB.prepare('UPDATE email_accounts SET job_id=?,scan_start=?,scan_from=? WHERE id=? AND owner=? AND lease_until<?').bind(`${next.id}:${next.revision}`,next.to,next.from,account.id,account.owner,Date.now()).run();
        if(!update.meta?.changes)throw Object.assign(Error('An import is finishing. Retry shortly.'),{status:409});
        this.job=next;
        await this.storeControl(this.job);
      }return {job:publicEmailJob(this.job)};
    }
    if(data.requestId&&this.job?.requestId===data.requestId){
      if(this.job.status==='running')await this.ctx.storage.setAlarm(Date.now()+1);
      return {job:publicEmailJob(this.job)};
    }
    if(data.currency&&!['USD','CAD','AUD','EUR','GBP','INR','SGD','MYR'].includes(data.currency))throw Object.assign(Error('Choose a supported currency in Settings.'),{status:400});
    const now=Date.now(),range=manualScanRange(data,account,now),timezone=receiptTimezone(data.timezone||account.timezone||'UTC');
    const job={currency:data.currency||account.currency,id:crypto.randomUUID(),requestId:String(data.requestId||'').slice(0,100),owner:account.owner,accountId:account.id,from:range.from,to:range.to,page:range.page,ids:[],offset:0,listed:false,processed:0,estimated:0,ready:0,review:0,ignored:0,status:'running',revision:0,retry:0,error:null,createdAt:now,updatedAt:now,timezone};
    const fence=`${job.id}:0`;
    const statements=[this.env.EMAIL_DB.prepare("UPDATE email_accounts SET job_id=?,scan_from=?,scan_start=?,page_token=NULL,last_error=NULL,lease_token=NULL,lease_until=0 WHERE id=? AND owner=? AND (lease_until<? OR lease_token LIKE 'scan:%')").bind(fence,job.from,job.to,account.id,account.owner,now)];
    if(!data.resume){
      statements.push(this.env.EMAIL_DB.prepare("DELETE FROM email_seen WHERE account_id=? AND result NOT LIKE 'ignored:%' AND message_id NOT IN (SELECT message_id FROM email_items WHERE account_id=? AND status IN ('added','excluded','importing')) AND EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND job_id=?)").bind(account.id,account.id,account.id,fence));
      statements.push(this.env.EMAIL_DB.prepare("DELETE FROM email_items WHERE account_id=? AND status IN ('pending','needs_review','ignored') AND EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND job_id=?)").bind(account.id,account.id,fence));
    }
    const result=await this.env.EMAIL_DB.batch(statements);
    if(!result[0].meta?.changes)throw Object.assign(Error('An import is finishing. Retry shortly.'),{status:409});
    this.job=job;await this.storeControl(job);
    return {job:publicEmailJob(job),reset:!data.resume};
  }
  async token(account){
    if(!this.access){const stored=await this.ctx.storage.get('access');if(stored)this.access=await unseal(stored,this.env.EMAIL_TOKEN_KEY,`${account.owner}:${account.id}:access`);}
    if(!this.access||this.access.expiresAt<Date.now()+60000){
      this.access=await refreshEmailAccess(account,this.env);
      await this.ctx.storage.put('access',await seal(this.access,this.env.EMAIL_TOKEN_KEY,`${account.owner}:${account.id}:access`));
    }return this.access.token;
  }
  async save(job){
    let saved=false;
    await this.ctx.storage.transaction(async tx=>{
      const current=await tx.get('job');
      if(current?.id===job.id&&current.revision===job.revision&&current.status==='running'){
        await tx.put('job',job);
        if(job.status==='running')await tx.setAlarm(job.retryAt||Date.now()+1);else await tx.deleteAlarm();
        saved=true;
      }
    });
    if(saved&&this.current(job)){this.job=job;return true;}
    return false;
  }
  async alarm(){
    if(!this.job||this.job.status!=='running')return;
    const job=structuredClone(this.job),started=Date.now(),timings={};
    const stage=async(name,fn)=>{const t=Date.now();try{return await fn();}finally{timings[name]=(timings[name]||0)+Date.now()-t;}};
    // Watchdog makes a killed/evicted invocation resumable from durable state.
    await this.ctx.storage.setAlarm(Date.now()+60000);
    try{
      const account=await stage('dbRead',()=>this.env.EMAIL_DB.prepare('SELECT * FROM email_accounts WHERE id=? AND owner=? AND job_id=?').bind(job.accountId,job.owner,`${job.id}:${job.revision}`).first());
      if(!account){if(this.current(job)){this.job=null;this.access=null;await this.ctx.storage.deleteAll();}return;}
      const token=await stage('token',()=>this.token(account));
      if(!job.listed||job.offset>=job.ids.length){
        const q=`after:${Math.floor(job.from/1000)-1} before:${Math.floor(job.to/1000)+1} -in:spam -in:trash (receipt OR invoice OR payment OR charged OR debited OR spent OR "order confirmation" OR "subscription renewed" OR "transaction amount" OR "amount paid" OR "you made" OR "you sent" OR category:purchases)`;
        const query=new URLSearchParams({q,maxResults:String(PAGE_SIZE),fields:'messages(id),nextPageToken,resultSizeEstimate',...(job.page?{pageToken:job.page}:{})});
        const listing=await stage('list',()=>emailGoogle(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,token));
        job.ids=(listing.messages||[]).map(x=>x.id);job.offset=0;job.page=listing.nextPageToken||null;job.listed=true;job.estimated=Math.max(job.estimated,job.processed+(Number(listing.resultSizeEstimate)||job.ids.length));
      }
      if(!this.current(job))return;
      const ids=job.ids.slice(job.offset,job.offset+BATCH_SIZE),seen=new Map();
      if(ids.length){
        const rows=await stage('dbRead',()=>this.env.EMAIL_DB.prepare(`SELECT s.message_id,s.parser_version,s.result,i.status FROM email_seen s LEFT JOIN email_items i ON i.account_id=s.account_id AND i.message_id=s.message_id WHERE s.account_id=? AND s.message_id IN (${ids.map(()=>'?').join(',')})`).bind(job.accountId,...ids).all());
        for(const row of rows.results||[])seen.set(row.message_id,row);
      }
      const outcomes=await mapEmailConcurrent(ids,async id=>{
        if(!this.current(job))return {id,skip:true,status:'ignored'};
        const old=seen.get(id);
        if(old&&(['added','excluded','importing'].includes(old.status)||(old.parser_version>=receiptParserVersion&&(old.status||old.result?.startsWith('ignored:')))))return {id,skip:true,status:old.status||'ignored'};
        const root=`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`;
        try{
          const meta=await stage('metadata',()=>emailGoogle(`${root}?${new URLSearchParams({format:'metadata',metadataHeaders:'Subject',fields:metadataFields})}`,token));
          if(!this.current(job))return {id,skip:true,status:'ignored'};
          if(metadataIsNonReceipt(meta))return {id,outcome:{reason:'metadata_non_receipt'}};
          const full=await stage('get',()=>emailGoogle(`${root}?${new URLSearchParams({format:'full',fields:messageFields})}`,token));
          const outcome=await stage('parse',()=>inspectEmailReceipt(full,job.currency||account.currency,{timezone:job.timezone}));
          return {id,outcome};
        }catch(error){if(error.googleStatus===404)return {id,outcome:{reason:'message_unavailable'}};throw error;}
      });
      if(!this.current(job))return;
      const records=[],markers=[];
      await stage('encrypt',()=>Promise.all(outcomes.map(async entry=>{
        if(entry.skip){if(entry.status==='pending')job.ready++;else if(entry.status==='needs_review')job.review++;else job.ignored++;return;}
        const outcome=entry.outcome,proposal=outcome.proposal||outcome.review,status=outcome.proposal?'pending':outcome.review?'needs_review':'ignored';
        if(status==='pending')job.ready++;else if(status==='needs_review')job.review++;else job.ignored++;
        markers.push({account_id:job.accountId,message_id:entry.id,seen_at:Date.now(),parser_version:receiptParserVersion,result:`${status}:${outcome.reason||'receipt'}`});
        if(proposal){const id=`email:${await digest(`${job.owner}|${account.mailbox_sub}|${entry.id}`)}`;records.push({id,owner:job.owner,account_id:job.accountId,message_id:entry.id,proposal:await seal(proposal,this.env.EMAIL_TOKEN_KEY,`${job.owner}:${id}`),status,created_at:Date.now(),updated_at:Date.now()});}
      })));
      if(!this.current(job))return;
      const fence=`${job.id}:${job.revision}`,writes=[];
      if(records.length)writes.push(this.env.EMAIL_DB.prepare("INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.owner'),json_extract(value,'$.account_id'),json_extract(value,'$.message_id'),json_extract(value,'$.proposal'),json_extract(value,'$.status'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND job_id=? AND scan_start IS NOT NULL) ON CONFLICT(account_id,message_id) DO UPDATE SET proposal=excluded.proposal,status=excluded.status,updated_at=excluded.updated_at WHERE email_items.status IN ('pending','needs_review','ignored')").bind(JSON.stringify(records),job.accountId,fence));
      if(markers.length)writes.push(this.env.EMAIL_DB.prepare("INSERT INTO email_seen(account_id,message_id,seen_at,parser_version,result) SELECT json_extract(value,'$.account_id'),json_extract(value,'$.message_id'),json_extract(value,'$.seen_at'),json_extract(value,'$.parser_version'),json_extract(value,'$.result') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND job_id=? AND scan_start IS NOT NULL) ON CONFLICT(account_id,message_id) DO UPDATE SET seen_at=excluded.seen_at,parser_version=excluded.parser_version,result=excluded.result").bind(JSON.stringify(markers),job.accountId,fence));
      if(writes.length)await stage('dbWrite',()=>this.env.EMAIL_DB.batch(writes));
      if(!this.current(job))return;
      job.processed+=ids.length;job.offset+=ids.length;job.retry=0;job.error=null;job.retryAt=null;job.updatedAt=Date.now();
      if(job.offset>=job.ids.length&&!job.page){
        job.status='complete';
        await stage('dbWrite',()=>this.env.EMAIL_DB.prepare('UPDATE email_accounts SET last_scan=?,scan_start=NULL,scan_from=?,page_token=NULL,last_error=NULL WHERE id=? AND job_id=?').bind(job.to,job.from,job.accountId,fence).run());
      }
      await this.save(job);
      console.log(JSON.stringify({event:'email_scan_batch',processed:ids.length,status:job.status,wallMs:Date.now()-started,stagesWallMs:timings}));
    }catch(error){
      if(!this.current(job))return;
      if(error.code==='google_auth_expired'){this.access=null;await this.ctx.storage.delete('access');}
      const retryable=error.code==='google_rate_limited'||error.code==='google_service_unavailable'||(error.code==='google_auth_expired'&&job.retry===0)||!error.code;
      job.retry++;job.error=error.code?error.message:'Email service interrupted. Retrying the saved job.';
      if(retryable&&job.retry<=5){job.retryAt=Date.now()+Math.max(Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0,Math.min(300000,1000*2**job.retry+Math.floor(Math.random()*1000)));job.status='running';}
      else {job.status='failed';job.retryAt=null;}
      job.updatedAt=Date.now();
      await this.save(job);
    }
  }
}
