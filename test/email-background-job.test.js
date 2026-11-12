import test from 'node:test';
import assert from 'node:assert/strict';
import {jobEnvironment,mockGoogle,receiptMessage,key} from '../test-support/email-job-env.js';
import {unseal,emailCaptureRequest} from '../src/email-capture.js';
import {receiptParserVersion,gmailText} from '../src/email-receipts.js';

test('durable job batches 25, lists 100, caches encrypted tokens across eviction and completes without a client',async t=>{
  const h=await jobEnvironment(t);let tokens=0,lists=0,active=0,max=0,gets=0;
  mockGoogle(t,async url=>{
    if(url.includes('/token')){tokens++;return {access_token:'private-access',expires_in:3600};}
    if(url.includes('/messages?')){lists++;assert.equal(new URL(url).searchParams.get('maxResults'),'100');return {messages:Array.from({length:60},(_,i)=>({id:`m${i}`})),resultSizeEstimate:60};}
    active++;max=Math.max(max,active);await Promise.resolve();active--;
    if(new URL(url).searchParams.get('format')==='full')gets++;
    return receiptMessage(url.match(/messages\/([^?]+)/)[1]);
  });
  const start=await h.call('start',{days:2,requestId:'one'});assert.equal(start.job.status,'running');assert.equal(tokens,0);assert.ok(h.storage.alarm);
  await h.job.alarm();assert.equal(h.job.job.processed,25);assert.equal(h.job.job.ready,25);
  const encrypted=await h.storage.get('access');assert.ok(!encrypted.includes('private-access'));
  const evicted=await h.make();await evicted.alarm();await evicted.alarm();
  assert.equal(evicted.job.status,'complete');assert.equal(evicted.job.processed,60);assert.equal(evicted.job.ready,60);
  assert.equal(tokens,1);assert.equal(lists,1);assert.equal(gets,60);assert.ok(max<=5);assert.equal(h.storage.alarm,null);
  assert.equal((await h.env.EMAIL_DB.prepare('SELECT COUNT(*) AS n FROM email_items').first()).n,60);
  const item=await h.env.EMAIL_DB.prepare('SELECT * FROM email_items LIMIT 1').first();assert.equal((await unseal(item.proposal,key,`${h.account.owner}:${item.id}`)).amount,132.26);
  const before=gets;await evicted.alarm();assert.equal(gets,before);
  assert.ok(h.stats.batches<=4,'reset plus three batched result writes');
});
test('job start is idempotent, tenant isolated, and incremental range uses last completed watermark',async t=>{
  const h=await jobEnvironment(t);
  const first=await h.call('start',{days:2,requestId:'same'}),again=await h.call('start',{days:30,requestId:'same'});
  assert.equal(first.job.id,again.job.id);assert.equal(first.job.from,again.job.from);
  const foreign=await h.job.fetch(new Request('https://mailbox/progress',{method:'POST',body:JSON.stringify({owner:'other',accountId:'mailbox'})}));assert.equal(foreign.status,404);
  await h.env.EMAIL_DB.prepare('UPDATE email_accounts SET last_scan=?').bind(Date.now()-86400000).run();
  const next=await h.call('start',{sinceLast:true,requestId:'new'});assert.equal(next.job.from,(await h.env.EMAIL_DB.prepare('SELECT last_scan FROM email_accounts').first()).last_scan);
});
test('pause and replacement fence in-flight Gmail work and cannot restore stale rows',async t=>{
  const h=await jobEnvironment(t);let release,entered;
  const waiting=new Promise(r=>{entered=r;}),hold=new Promise(r=>{release=r;});
  mockGoogle(t,async url=>{
    if(url.includes('/token'))return {access_token:'token'};
    if(url.includes('/messages?'))return {messages:[{id:'old'}]};
    entered();await hold;return receiptMessage();
  });
  await h.call('start',{days:30});const old=h.job.alarm();await waiting;
  await h.call('pause');assert.equal(h.job.job.status,'paused');
  const next=await h.call('start',{days:2});release();await old;
  assert.equal(h.job.job.id,next.job.id);assert.equal(h.job.job.processed,0);
  assert.equal((await h.env.EMAIL_DB.prepare('SELECT COUNT(*) AS n FROM email_items').first()).n,0);
  assert.ok(h.storage.alarm);
});
test('Gmail throttling honors Retry-After and resumes the checkpoint with the same cached token',async t=>{
  const h=await jobEnvironment(t);let fail=true,tokens=0;
  mockGoogle(t,url=>{
    if(url.includes('/token')){tokens++;return {access_token:'token'};}
    if(url.includes('/messages?'))return {messages:[{id:'one'}]};
    if(fail)return Response.json({error:{errors:[{reason:'rateLimitExceeded'}]}},{status:429,headers:{'Retry-After':'30'}});
    return receiptMessage();
  });
  await h.call('start',{days:2});const before=Date.now();await h.job.alarm();assert.equal(h.job.job.status,'running');assert.ok(h.storage.alarm>=before+30000);assert.equal(h.job.job.processed,0);
  fail=false;await h.job.alarm();assert.equal(h.job.job.status,'complete');assert.equal(h.job.job.ready,1);assert.equal(tokens,1);
});
test('metadata rejects obvious newsletters; seen results skip downloads and retain skip reasons',async t=>{
  const h=await jobEnvironment(t);let full=0;
  await h.env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version,result) VALUES(?,?,?,?,?)').bind(h.account.id,'known',1,receiptParserVersion,'ignored:no_amount').run();
  mockGoogle(t,url=>{
    if(url.includes('/token'))return {access_token:'token'};
    if(url.includes('/messages?'))return {messages:[{id:'known'},{id:'news'}]};
    if(new URL(url).searchParams.get('format')==='full')full++;
    return {snippet:'Daily market analysis',payload:{headers:[{name:'Subject',value:'Stock market newsletter'}]}};
  });
  await h.call('start',{days:2});await h.job.alarm();assert.equal(full,0);assert.equal(h.job.job.ignored,2);
  assert.equal((await h.env.EMAIL_DB.prepare("SELECT result FROM email_seen WHERE message_id='news'").first()).result,'ignored:metadata_non_receipt');
});
test('disconnect erases durable state; a job cannot append expenses to Sheets',async t=>{
  const h=await jobEnvironment(t);await h.call('start',{days:2});
  await h.call('delete');assert.equal(await h.storage.get('job'),undefined);assert.equal(h.storage.alarm,null);
  const {job}=await h.call('progress');assert.equal(job,null);
});
test('plain alternatives are preferred and MIME bodies are bounded before parsing',()=>{
  const data=s=>Buffer.from(s).toString('base64url');
  assert.equal(gmailText({mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:{data:data('Amount paid: USD 20')}},{mimeType:'text/html',body:{data:data('<p>Amount paid: USD 30</p>')}}]}),'Amount paid: USD 20');
  assert.equal(gmailText({mimeType:'text/plain',body:{data:data('x'.repeat(1000000))}}).length,64000);
});
