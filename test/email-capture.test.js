import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { parseEmailReceipt, gmailText } from '../src/email-receipts.js';
import { seal, unseal, emailCaptureRequest, scanMailbox, manualScanRange, scheduledEmailScans, possibleEmailDuplicate, filterBankReceiptDuplicates, googleApiFailure } from '../src/email-capture.js';

// Real SQLite executes the migration and SQL; this adapter implements D1's result shapes.
function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_email_capture.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0002_manual_email_scans.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0003_receipt_parser_versions.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0004_background_email_jobs.sql',import.meta.url),'utf8'));
  const prepare=sql=>{
    let args=[];
    return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};
  };
  return {prepare,async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
}
const key=Buffer.alloc(32,7).toString('base64');
function environment(t){const env={EMAIL_DB:database(),EMAIL_CAPTURE_ENABLED:'true',EMAIL_OAUTH_CLIENT_ID:'client',EMAIL_OAUTH_CLIENT_SECRET:'secret',EMAIL_TOKEN_KEY:key,EMAIL_CALLBACK_URL:'https://worker.example/email/oauth/callback'};t.after(()=>env.EMAIL_DB.close());return env;}
const receipt=(body='Payment successful\nMerchant: Test Shop\nAmount paid: USD 12.50\nPayment date: 2026-11-09',subject='Payment confirmation')=>({id:'message1',internalDate:String(Date.parse('2026-11-10T12:00:00Z')),payload:{mimeType:'text/plain',headers:[{name:'Subject',value:subject},{name:'From',value:'Test Shop <shop@example.com>'}],body:{data:Buffer.from(body).toString('base64url')}}});
function cvsReceipt(html=false){
  const message=receipt(html
    ? '<div>Thanks for choosing CVS</div><p>Your transaction on Nov 8, 2026 08:54 PM</p><table><tr><td>&#36;&nbsp;<b>19.22</b></td><td>&mdash; Total spent this trip</td></tr><tr><td>$ 4.00</td><td>— Total saved this trip</td></tr><tr><td>$ 58.69</td><td>— Total ExtraCare savings this year</td></tr></table>'
    : 'Thanks for choosing CVS\nYour transaction on Nov 8, 2026 08:54 PM\n$ 19.22 — Total spent this trip\n$ 4.00 — Total saved this trip\n$ 58.69 — Total ExtraCare savings this year',
    'Your Receipt Is Here: Claim Valuable New Coupons Now!');
  message.payload.headers[1].value='CVS <cvs@mynotifications.cvs.com>';
  if(html)message.payload.mimeType='text/html';
  return message;
}
function mockFetch(t,handler){const old=globalThis.fetch;globalThis.fetch=async(url,init={})=>{const result=await handler(String(url),init);if(result instanceof Response)return result;return Response.json(result);};t.after(()=>{globalThis.fetch=old;});}
function request(action,data,token='app-token'){return new Request(`https://worker.example/email/${action}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});}
const user={sub:'owner',email:'owner@example.com',email_verified:true};
test('public email routes bypass the statement spreadsheet-header requirement',async t=>{
  const env=environment(t);
  for(const method of ['GET','POST']){
    const response=await worker.fetch(new Request('https://worker.example/email/status',{method}),env);
    assert.equal(response.status,401);
    assert.ok(!(await response.text()).includes('X-Spreadsheet-ID'));
  }
});
async function account(env){const row={id:'account1',owner:'google:owner',mailbox_sub:'mailbox',currency:'USD',timezone:'America/Chicago',hour:20,minute:30};await env.EMAIL_DB.prepare('INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(row.id,row.owner,row.mailbox_sub,'mail@example.com',await seal('refresh',key,`${row.owner}:${row.id}`),row.timezone,row.hour,row.minute,row.currency,1).run();return row;}
async function proposal(env,id='email:test'){const item=parseEmailReceipt(receipt());await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,'google:owner','account1',id,await seal(item,key,`google:owner:${id}`),1,1).run();return {...item,id};}

test('receipt parser accepts paid evidence and rejects reminders, transfers and conflicting totals',()=>{
  assert.equal(parseEmailReceipt(receipt()).amount,12.5);
  assert.equal(parseEmailReceipt(receipt()).merchant,'Test Shop');
  for(const subject of ['Upcoming payment reminder','Payment failed','Refund confirmation'])assert.equal(parseEmailReceipt(receipt(undefined,subject)),null);
  assert.equal(parseEmailReceipt(receipt('Payment successful\nCredit card payment\nTotal: $10')),null);
  assert.equal(parseEmailReceipt(receipt('Payment successful\nTotal: $10\nAmount paid: $20')).amount,20);
  assert.equal(parseEmailReceipt(receipt('Payment successful\nTotal: USD 10\nAmount paid: CAD 10')).currency,'CAD');
  const malformed=receipt();malformed.payload.body.data='!invalid!';assert.equal(parseEmailReceipt(malformed),null);
  assert.equal(parseEmailReceipt(receipt('Payment successful\nYour account balance is $10')),null);
  assert.equal(parseEmailReceipt(receipt('Payment successful\nTotal: $10\nPayment date: 2026-99-99')).dateSource,'email received date (UTC); verify');
});
const paid=body=>receipt('Payment successful\n'+body);
test('unsupported number formats fail closed rather than truncating or inflating amounts',()=>{
  for(const value of ['€19,99','EUR 1.234,56','EUR 1 234,56',"USD 1'234.50",'INR 1,23,456.78','USD 12.345']){
    assert.equal(parseEmailReceipt(paid(`Total: ${value}`)),null,value);
  }
  assert.equal(parseEmailReceipt(paid('Total: USD 1,234.56')).amount,1234.56);
  assert.equal(parseEmailReceipt(paid('Total: USD 123456.78')).amount,123456.78);
});
test('total and charged labels do not match inside subtotal or discharged',()=>{
  assert.equal(parseEmailReceipt(paid('Subtotal: USD 40\nTotal: USD 45')).amount,45);
  assert.equal(parseEmailReceipt(paid('Subtotal: USD 40')),null);
  assert.equal(parseEmailReceipt(paid('Discharged USD 40')),null);
  assert.equal(parseEmailReceipt(paid('Subtotal: USD 40\nTotal: USD 45\nAmount charged: USD 30')).amount,30);
});
test('explicit dollar prefixes outrank mailbox currency; bare dollars are flagged',()=>{
  assert.equal(parseEmailReceipt(paid('Total: US$20'),'CAD').currency,'USD');
  assert.equal(parseEmailReceipt(paid('Total: C$20'),'USD').currency,'CAD');
  assert.equal(parseEmailReceipt(paid('Total: S$20'),'USD').currency,'SGD');
  assert.equal(parseEmailReceipt(paid('Total: NZ$20'),'USD'),null);
  const bare=parseEmailReceipt(paid('Total: $20'),'CAD');assert.equal(bare.currency,'CAD');assert.equal(bare.currencyNeedsReview,true);
  assert.equal(parseEmailReceipt(paid('Total: US$20 CAD'),'CAD'),null);
});
test('refunds remain excluded rather than being imported as positive purchases',()=>{
  assert.equal(parseEmailReceipt(receipt('Amount paid: USD 20','Your refund is complete')),null);
});
test('CVS receipt selects purchase total, excludes savings and uses the printed transaction date',()=>{
  for(const html of [false,true]){
    const parsed=parseEmailReceipt(cvsReceipt(html));assert.ok(parsed);
    assert.equal(parsed.merchant,'CVS');assert.equal(parsed.amount,19.22);assert.equal(parsed.currency,'USD');assert.equal(parsed.date,'2026-11-08');assert.equal(parsed.dateSource,'email payment date');
  }
});
test('retail savings promotions and scheduled notices do not become expenses',()=>{
  assert.equal(parseEmailReceipt(receipt('Your transaction on Nov 8, 2026\n$ 4.00 — Total saved this trip\n$ 58.69 — Total ExtraCare savings this year','Your receipt and coupons')),null);
  assert.equal(parseEmailReceipt(receipt('Save today!\nPurchase total: $19.22','Your receipt is waiting')),null);
  const future=cvsReceipt();future.payload.headers[0].value='Scheduled payment reminder';assert.equal(parseEmailReceipt(future),null);
  const conflict=cvsReceipt();conflict.payload.body.data=Buffer.from('Your transaction on Nov 8, 2026\n$19.22 — Total spent this trip\nTransaction total: $23.22').toString('base64url');assert.equal(parseEmailReceipt(conflict),null);
});
test('MIME handling strips scripts and does not read attachments',()=>{
  const part=(mimeType,text,filename)=>({mimeType,filename,body:{data:Buffer.from(text).toString('base64url')}});
  assert.equal(gmailText({parts:[part('text/html','<script>secret</script><p>Paid &amp; done</p>'),part('text/plain','hidden','receipt.txt')]}).includes('secret'),false);
  assert.equal(gmailText({parts:[part('text/plain','hidden','receipt.txt')]}),'');
});
test('encryption binds ciphertext to its owner and rejects tampering',async()=>{
  const value=await seal('refresh-token',key,'owner:a');assert.equal(await unseal(value,key,'owner:a'),'refresh-token');
  await assert.rejects(unseal(value,key,'owner:b'));await assert.rejects(unseal(`${value}x`,key,'owner:a'));
});
test('manual date range validates limits and pins resume to its original mailbox range',()=>{
  const now=Date.parse('2026-11-11T12:00:00Z'),day=86400000;
  for(const days of [0,-1,31,90,365,1.5,'7'])assert.throws(()=>manualScanRange({days},{},now));
  assert.equal(manualScanRange({days:30},{},now).from,now-30*day);
  assert.deepEqual(manualScanRange({sinceLast:true},{last_scan:now-day},now),{from:now-day,to:now,page:null});
  assert.throws(()=>manualScanRange({sinceLast:true},{last_scan:0},now));
  assert.throws(()=>manualScanRange({sinceLast:true},{last_scan:now-91*day},now));
  assert.deepEqual(manualScanRange({resume:true},{scan_from:now-day,scan_start:now-10000,page_token:'p2'},now),{from:now-day,to:now-10000,page:'p2'});
  assert.throws(()=>manualScanRange({resume:true},{},now));
});
test('stale cron callbacks never read mail or touch storage',async t=>{
  mockFetch(t,()=>{throw new Error('No background network access allowed');});
  await scheduledEmailScans({EMAIL_DB:{prepare(){throw new Error('No scheduled database access');}}});
});
test('Google failure reasons produce safe, actionable messages instead of raw provider data',()=>{
  const cases=[['SERVICE_DISABLED',403,'google_api_disabled'],['insufficientPermissions',403,'google_scope_missing'],['domainPolicy',403,'google_admin_blocked'],['userRateLimitExceeded',403,'google_rate_limited'],['unknown',503,'google_service_unavailable']];
  for(const [reason,status,code] of cases){const error=googleApiFailure(status,{error:{message:'PRIVATE_EMAIL_AND_TOKEN',details:[{reason}]}},'Gmail');assert.equal(error.code,code);assert.ok(!error.message.includes('PRIVATE'));}
});
test('disabled Gmail API preserves the actual diagnosis without reading any messages',async t=>{
  const env=environment(t),a=await account(env);
  mockFetch(t,url=>url.includes('/token')?{access_token:'gmail'}:new Response(JSON.stringify({error:{details:[{reason:'SERVICE_DISABLED'}]}}),{status:403}));
  await assert.rejects(scanMailbox(a,env),/Gmail API is not enabled/);
  const row=await env.EMAIL_DB.prepare('SELECT last_error,last_scan,lease_until FROM email_accounts').first();assert.ok(row.last_error.includes('Enable it in Google Cloud Console'));assert.equal(row.last_scan,0);assert.equal(row.lease_until,0);
});
test('manual pages retain their selected range and only completion advances last scan',async t=>{
  const env=environment(t),a=await account(env),now=Date.now(),queries=[];
  mockFetch(t,url=>{
    if(url.includes('/token'))return {access_token:'gmail'};
    const query=new URL(url).searchParams;queries.push(query);
    return query.has('pageToken')?{messages:[]}:{messages:[],nextPageToken:'next-page'};
  });
  const first=await scanMailbox(a,env,now,{days:30});assert.equal(first.more,true);
  let saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.last_scan,0);
  const second=await scanMailbox(a,env,now+60000,{resume:true});assert.equal(second.more,false);
  assert.equal(queries[0].get('q'),queries[1].get('q'));assert.equal(queries[1].get('pageToken'),'next-page');
  saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.last_scan,now);assert.equal(saved.scan_start,null);
});
test('invalid scan range and legacy schedule never access Gmail',async t=>{
  const env=environment(t);await account(env);
  mockFetch(t,url=>{assert.ok(url.includes('userinfo'));return user;});
  assert.equal((await emailCaptureRequest(request('scan',{accountId:'account1',days:365}),env)).status,400);
  assert.equal((await emailCaptureRequest(request('schedule',{accountId:'account1',enabled:true}),env)).status,410);
});
test('unconfigured, missing authorization and foreign origins fail closed',async t=>{
  assert.equal((await emailCaptureRequest(request('status'),{})).status,503);
  const env=environment(t);
  assert.equal((await emailCaptureRequest(new Request('https://worker.example/email/status'),env)).status,401);
  assert.equal((await emailCaptureRequest(new Request('https://worker.example/email/status',{headers:{Origin:'https://evil.example'}}),env)).status,403);
});
test('OAuth uses PKCE, consumes state once, encrypts refresh token and binds owner',async t=>{
  const env=environment(t);let exchange;
  mockFetch(t,(url,init)=>{
    if(url.includes('oauth2.googleapis.com/token')){exchange=init.body;return {access_token:'gmail-token',refresh_token:'private-refresh',scope:'openid email https://www.googleapis.com/auth/gmail.readonly'};}
    if(url.includes('userinfo'))return init.headers.Authorization==='Bearer gmail-token'?{...user,sub:'mailbox',email:'mail@example.com'}:user;
    throw new Error(`Unexpected URL ${url}`);
  });
  const connected=await (await emailCaptureRequest(request('connect',{hour:20,minute:30,timezone:'America/Chicago',currency:'USD'}),env)).json();
  const url=new URL(connected.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('access_type'),'offline');
  const callback=new Request(`${env.EMAIL_CALLBACK_URL}?state=${url.searchParams.get('state')}&code=code`);
  assert.equal((await emailCaptureRequest(callback,env)).status,200);assert.ok(exchange.get('code_verifier'));
  const stored=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(stored.owner,'google:owner');assert.notEqual(stored.refresh_token,'private-refresh');
  assert.equal((await emailCaptureRequest(callback.clone(),env)).status,400);
});
test('scan queues encrypted proposals, deduplicates messages and never writes Sheets',async t=>{
  const env=environment(t),a=await account(env);let reads=0;
  mockFetch(t,url=>{assert.ok(!url.includes('sheets.googleapis.com'));if(url.includes('/token'))return {access_token:'gmail'};if(url.includes('/messages?'))return {messages:[{id:'message1'},{id:'scheduled'}]};reads++;return url.includes('/scheduled')?receipt(undefined,'Upcoming payment reminder'):receipt();});
  await scanMailbox(a,env);await scanMailbox(a,env);
  assert.equal(reads,2);const rows=await env.EMAIL_DB.prepare('SELECT * FROM email_items').all();assert.equal(rows.results.length,2);const ready=rows.results.find(x=>x.status==='pending');assert.ok(!ready.proposal.includes('Test Shop'));
  assert.equal((await unseal(ready.proposal,key,`google:owner:${ready.id}`)).amount,12.5);
  const review=rows.results.find(x=>x.status==='needs_review');assert.equal((await unseal(review.proposal,key,`google:owner:${review.id}`)).reviewReason,'rejected_keyword:upcoming');
});
test('new parser reconsiders old skipped receipts once without duplicating approved/excluded items',async t=>{
  const env=environment(t),a=await account(env);let reads=0;
  await env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) VALUES(?,?,?,1)').bind(a.id,'message1',1).run();
  mockFetch(t,url=>{
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?'))return {messages:[{id:'message1'}]};
    reads++;return cvsReceipt(true);
  });
  assert.equal((await scanMailbox(a,env)).added,1);
  await scanMailbox(a,env);assert.equal(reads,1);
  const row=await env.EMAIL_DB.prepare('SELECT * FROM email_items').first();assert.equal((await unseal(row.proposal,key,`${a.owner}:${row.id}`)).amount,19.22);
  for(const status of ['added','excluded']){
    await env.EMAIL_DB.prepare('UPDATE email_seen SET parser_version=1').run();
    await env.EMAIL_DB.prepare("UPDATE email_items SET status=?,proposal=''").bind(status).run();
    assert.equal((await scanMailbox(a,env)).added,0);assert.equal(reads,1);
    assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items').first()).status,status);
  }
});
test('an older unsafe queued amount is retained for exclusion but blocked from approval',async t=>{
  const env=environment(t),a=await account(env),id='email:old';
  const old={merchant:'Test Shop',amount:1999,currency:'EUR',date:'2026-11-09',expenseType:'Unknown',category:'Uncategorized'};
  await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,a.owner,a.id,'message1',await seal(old,key,`${a.owner}:${id}`),1,1).run();
  await env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) VALUES(?,?,?,2)').bind(a.id,'message1',1).run();
  mockFetch(t,(url,init)=>{
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?'))return {messages:[{id:'message1'}]};
    if(url.includes('/messages/'))return paid('Total: €19,99');
    if(url.includes('userinfo'))return user;
    assert.ok(!init.method||init.method==='GET','must not write anything to Sheets');
    if(url.includes('?fields='))return {sheets:[]};
    return {values:[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']]};
  });
  await scanMailbox(a,env);
  const row=await env.EMAIL_DB.prepare('SELECT * FROM email_items WHERE id=?').bind(id).first();
  assert.equal((await unseal(row.proposal,key,`${a.owner}:${id}`)).reviewReason,'unsupported_amount_format');assert.equal(row.status,'needs_review');
  const response=await emailCaptureRequest(request('approve',{spreadsheetId:'spreadsheet123',currency:'EUR',items:[{...old,id}]}),env);
  assert.equal(response.status,409);assert.equal((await response.json()).code,'manual_review_required');
});
test('scan cursor survives a bounded page and failures do not advance completed watermark',async t=>{
  const env=environment(t),a=await account(env);let fail=false;
  mockFetch(t,url=>{if(url.includes('/token'))return {access_token:'gmail'};if(fail)throw new Error('offline');return {messages:[],nextPageToken:'page2'};});
  await scanMailbox(a,env,Date.now());let saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.page_token,'page2');assert.equal(saved.last_scan,0);
  fail=true;await assert.rejects(scanMailbox(a,env,Date.now()+1000));saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.last_scan,0);assert.equal(saved.lease_until,0);assert.ok(saved.last_error);
});
test('status isolates owners and uncertain items cannot be excluded',async t=>{
  const env=environment(t);await account(env);await proposal(env);
  mockFetch(t,()=>user);
  let state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.items.length,1);
  await env.EMAIL_DB.prepare("UPDATE email_items SET status='importing'").run();assert.equal((await emailCaptureRequest(request('exclude',{ids:['email:test']}),env)).status,409);
  mockFetch(t,()=>({...user,sub:'other'}));state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.items.length,0);assert.equal(state.accounts.length,0);
});
test('needs-review emails are visible with reasons and require explicit manual approval',async t=>{
  const env=environment(t),a=await account(env);let appends=0;
  mockFetch(t,(url,init)=>{
    if(url.includes('userinfo'))return user;
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?'))return {messages:[{id:'message1'}]};
    if(url.includes('/messages/'))return receipt('Invoice total: USD 40','Invoice');
    if(url.includes(':append')){appends++;const written=JSON.parse(init.body).values[0];assert.equal(written[1],40);return {};}
    if(url.includes('?fields='))return {sheets:[]};
    if(url.includes(':batchUpdate'))return {};
    return {values:[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']]};
  });
  const scan=await scanMailbox(a,env);assert.equal(scan.added,0);assert.equal(scan.needsReview,1);assert.equal(scan.reasonCounts.no_completion_phrase,1);
  const state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.items.length,0);assert.equal(state.needsReviewTotal,1);assert.equal(state.needsReview[0].reviewReason,'no_completion_phrase');assert.equal(state.needsReview[0].amount,40);assert.equal(state.needsReview[0].amountIsSuggestion,true);
  const item={...state.needsReview[0],amount:40,date:'2026-11-09',category:'Shopping',expenseType:'Regular',group:'Essential'};
  const data={spreadsheetId:'spreadsheet123',currency:'USD',items:[item]};
  assert.equal((await emailCaptureRequest(request('approve',data),env)).status,409);assert.equal(appends,0);
  item.manualReviewConfirmed=true;
  assert.equal((await emailCaptureRequest(request('approve',data),env)).status,200);assert.equal(appends,1);
  assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items').first()).status,'added');
});
test('review-only non-purchases can be excluded and stay excluded on rescan',async t=>{
  const env=environment(t),a=await account(env);
  mockFetch(t,url=>url.includes('userinfo')?user:url.includes('/token')?{access_token:'gmail'}:url.includes('/messages?')?{messages:[{id:'message1'}]}:receipt('Total: USD 20','Payment due'));
  await scanMailbox(a,env);
  const state=await (await emailCaptureRequest(request('status'),env)).json();const id=state.needsReview[0].id;
  assert.equal(state.needsReview[0].reviewReason,'rejected_keyword:due');
  assert.equal((await emailCaptureRequest(request('exclude',{ids:[id]}),env)).status,200);
  await scanMailbox(a,env);assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items').first()).status,'excluded');
});
test('rescanning removes old newsletter false positives while retaining real unconfirmed receipts',async t=>{
  const env=environment(t),a=await account(env),id='email:newsletter';
  const old={merchant:'Jim Cramer',amount:null,currency:'USD',date:'2026-11-09',needsReview:true,reviewReason:'no_completion_phrase'};
  await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,a.owner,a.id,'news',await seal(old,key,`${a.owner}:${id}`),'needs_review',1,1).run();
  await env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) VALUES(?,?,?,4)').bind(a.id,'news',1).run();
  mockFetch(t,url=>{
    if(url.includes('userinfo'))return user;
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?'))return {messages:[{id:'news'},{id:'invoice'}]};
    if(url.includes('/news?'))return receipt('Your investing day. Things to watch in the stock market. Spent time researching shares.',"Jim Cramer's top 10 things to watch in the stock market Monday");
    return receipt('Total: USD 40','Your invoice');
  });
  const result=await scanMailbox(a,env);assert.equal(result.ignored,1);assert.equal(result.needsReview,1);
  const row=await env.EMAIL_DB.prepare('SELECT status,proposal FROM email_items WHERE id=?').bind(id).first();assert.equal(row.status,'ignored');assert.equal(row.proposal,'');
  const state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.needsReviewTotal,1);assert.equal(state.needsReview[0].amount,40);assert.equal(state.needsReview[0].amountIsSuggestion,true);
});
test('a foreground scan saves the user timezone and resume retains it during travel',async t=>{
  const env=environment(t),a=await account(env);let page=0;
  mockFetch(t,url=>{
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?'))return ++page===1?{messages:[{id:'first'}],nextPageToken:'next'}:{messages:[{id:'second'}]};
    const value=receipt('Amount paid: USD 20');value.internalDate=String(Date.parse('2026-11-02T18:45:00Z'));return value;
  });
  const now=Date.parse('2026-11-11T12:00:00Z');
  await scanMailbox(a,env,now,{days:30,timezone:'Asia/Kolkata'});
  await scanMailbox(a,env,now+1000,{resume:true,timezone:'America/Chicago'});
  assert.equal((await env.EMAIL_DB.prepare('SELECT timezone FROM email_accounts').first()).timezone,'Asia/Kolkata');
  for(const row of (await env.EMAIL_DB.prepare('SELECT * FROM email_items').all()).results)assert.equal((await unseal(row.proposal,key,`${a.owner}:${row.id}`)).date,'2026-11-03');
});
test('approval skips statement duplicates, handles stable IDs and requires manual review',async t=>{
  const env=environment(t);await account(env);const item=await proposal(env);let appends=0;
  const rows=[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID'],[item.date,item.amount,'Shopping',item.merchant,'Regular','statement:1','']];
  mockFetch(t,(url)=>{if(url.includes('userinfo'))return user;if(url.includes('/values/')&&!url.includes(':append'))return {values:rows};if(url.includes('?fields='))return {sheets:[]};throw new Error('No write should occur');});
  const result=await (await emailCaptureRequest(request('approve',{spreadsheetId:'spreadsheet123',currency:'USD',items:[item]}),env)).json();assert.deepEqual(result.duplicates,[item.id]);assert.equal(appends,0);
  rows.push([item.date,item.amount,'Shopping',item.merchant,'Regular',item.id,'']);
  const retry=await (await emailCaptureRequest(request('approve',{spreadsheetId:'spreadsheet123',currency:'USD',items:[item]}),env)).json();assert.equal(retry.alreadyAdded,1);assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items').first()).status,'added');
});
test('uncertain write blocks immediate retries even with explicit Import anyway',async t=>{
  const env=environment(t);await account(env);const item=await proposal(env);await env.EMAIL_DB.prepare("UPDATE email_items SET status='importing',updated_at=?").bind(Date.now()).run();
  mockFetch(t,url=>url.includes('userinfo')?user:url.includes('?fields=')?{sheets:[]}:{values:[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']]});
  const result=await emailCaptureRequest(request('approve',{spreadsheetId:'spreadsheet123',currency:'USD',items:[{...item,importAnyway:true}]}),env);assert.equal(result.status,409);
});
test('approved receipt writes reviewed data once and retry confirms stable ID',async t=>{
  const env=environment(t);await account(env);const item={...await proposal(env),category:'Shopping',expenseType:'Regular',group:'Potentially Flexible'};
  const rows=[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']];let appends=0;
  mockFetch(t,(url,init)=>{
    if(url.includes('userinfo'))return user;
    if(url.includes(':append')){appends++;rows.push(...JSON.parse(init.body).values);return {updates:{updatedRows:1}};}
    if(url.includes('/values/')&&!url.includes(':batchUpdate'))return {values:rows.map(r=>[...r])};
    if(url.includes('?fields='))return {sheets:[]};
    if(url.includes(':batchUpdate'))return {};
    throw new Error(`Unexpected ${url}`);
  });
  const data={spreadsheetId:'spreadsheet123',currency:'USD',items:[item]};
  let result=await (await emailCaptureRequest(request('approve',data),env)).json();assert.equal(result.added,1);assert.equal(rows[1][5],item.id);assert.equal(rows[1][4],'Regular');
  result=await (await emailCaptureRequest(request('approve',data),env)).json();assert.equal(result.alreadyAdded,1);assert.equal(appends,1);
  const stored=await unseal((await env.EMAIL_DB.prepare('SELECT proposal FROM email_items').first()).proposal,key,`google:owner:${item.id}`);
  assert.equal(stored.merchant,item.merchant);assert.equal(stored.amount,item.amount);
  assert.equal(stored.excerpt,undefined);assert.equal(stored.subject,undefined);assert.equal(stored.sender,undefined);
});
test('lost Sheets response is retained as uncertain instead of blindly retried',async t=>{
  const env=environment(t);await account(env);const item=await proposal(env);
  mockFetch(t,(url)=>{if(url.includes('userinfo'))return user;if(url.includes(':append'))throw new Error('response lost');if(url.includes('/values/')&&!url.includes(':batchUpdate'))return {values:[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']]};if(url.includes('?fields='))return {sheets:[]};return {};});
  const response=await emailCaptureRequest(request('approve',{spreadsheetId:'spreadsheet123',currency:'USD',items:[item]}),env);assert.equal(response.status,503);
  assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items').first()).status,'importing');assert.equal((await env.EMAIL_DB.prepare('SELECT lease_until FROM email_accounts').first()).lease_until,0);
});
test('disconnect deletes authorization and pending proposals even if revocation fails',async t=>{
  const env=environment(t);await account(env);await proposal(env);
  mockFetch(t,url=>url.includes('userinfo')?user:new Response('',{status:503}));
  assert.equal((await emailCaptureRequest(request('disconnect',{accountId:'account1'}),env)).status,200);
  assert.equal((await env.EMAIL_DB.prepare('SELECT count(*) AS n FROM email_accounts').first()).n,0);
  assert.equal((await env.EMAIL_DB.prepare('SELECT count(*) AS n FROM email_items').first()).n,0);
});
test('duplicate matching requires amount, date and merchant, ignoring transfers',()=>{
  const item={merchant:'Test Shop',amount:12.5,date:'2026-11-09'};
  assert.ok(possibleEmailDuplicate(item,['2026-11-09',12.5,'Shopping','TEST SHOP','Regular']));
  assert.ok(!possibleEmailDuplicate(item,['2026-11-08',12.5,'Shopping','TEST SHOP','Regular']));
  assert.ok(!possibleEmailDuplicate(item,['2026-11-09',12.5,'Transfers','TEST SHOP','Regular']));
});

test('fresh lookback removes legacy missing-amount drafts and catches completed narratives',async t=>{
  const env=environment(t),a=await account(env),id='email:no-amount';
  const old={merchant:'Store',amount:null,currency:'USD',date:'2026-11-09',needsReview:true,reviewReason:'no_amount'};
  await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,a.owner,a.id,'empty',await seal(old,key,`${a.owner}:${id}`),'needs_review',1,1).run();
  await env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) VALUES(?,?,?,5)').bind(a.id,'empty',1).run();
  mockFetch(t,url=>{
    if(url.includes('userinfo'))return user;
    if(url.includes('/token'))return {access_token:'gmail'};
    if(url.includes('/messages?')){assert.ok(new URL(url).searchParams.get('q').includes('"you made"'));return {messages:[{id:'empty'},{id:'paid'}]};}
    return url.includes('/empty?')?receipt('Thank you for your payment'):receipt('Your payment of $234.40 has been received.');
  });
  const result=await scanMailbox(a,env);assert.equal(result.ignored,1);assert.equal(result.added,1);
  assert.equal((await env.EMAIL_DB.prepare('SELECT status FROM email_items WHERE id=?').bind(id).first()).status,'ignored');
  const state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.needsReviewTotal,0);assert.equal(state.items[0].amount,234.4);
});

test('status hides legacy missing and zero totals immediately with accurate review counts',async t=>{
  const env=environment(t);await account(env);
  for(const [id,amount,candidates] of [['missing',null,[]],['zero',null,[{amount:0,amountText:'USD 0.00'}]],['conflict',null,[{amount:20},{amount:30}]],['format',null,[{amount:null,amountText:'EUR 19,99'}]],['suggestion',12,[]]]){
    const value={merchant:'Test',amount,currency:'USD',needsReview:true,reviewReason:'no_completion_phrase',amountCandidates:candidates};
    await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'google:owner','account1',id,await seal(value,key,`google:owner:${id}`),'needs_review',1,1).run();
  }
  mockFetch(t,()=>user);
  const state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.needsReviewTotal,3);assert.deepEqual(state.needsReview.map(x=>x.id).sort(),['conflict','format','suggestion']);
});

test('sent-payment search stores a review draft and blocks unconfirmed approval',async t=>{
 const env=environment(t),a=await account(env);
 mockFetch(t,url=>{
   if(url.includes('userinfo'))return user;
   if(url.includes('/token'))return {access_token:'gmail'};
   if(url.includes('/messages?')){assert.ok(new URL(url).searchParams.get('q').includes('"you sent"'));return {messages:[{id:'sent'}]};}
   if(url.includes('?fields='))return {sheets:[]};
   if(url.includes('/values/'))return {values:[['Timestamp','Amount','Category','Description','Expense Type','Transaction ID','Category ID']]};
   return receipt('You sent $308.12 to\nExample Services','You sent $308.12 from account ending in 1234');
 });
 const scan=await scanMailbox(a,env);assert.equal(scan.added,0);assert.equal(scan.needsReview,1);
 const state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.items.length,0);assert.equal(state.needsReview[0].amount,308.12);assert.equal(state.needsReview[0].merchant,'Example Services');
 const response=await emailCaptureRequest(request('approve',{items:[{...state.needsReview[0],category:'Utilities',expenseType:'Regular',group:'Essential'}],spreadsheetId:'spreadsheet123',currency:'USD'}),env);assert.equal(response.status,409,await response.text());
});

test('bank/vendor filtering requires a unique exact match and distinct source domains',()=>{
 const vendor={id:'vendor',_status:'pending',merchant:'Example Energy',amount:123.45,currency:'USD',date:'2026-11-09',sender:'Example Energy <receipts@exampleenergy.com>'};
 const bank={...vendor,id:'bank',_status:'needs_review',needsReview:true,subject:'You made a $123.45 transaction with EXAMPLE ENERGY',sender:'Bank <alerts@examplebank.com>'};
 assert.deepEqual(filterBankReceiptDuplicates([vendor,bank]).items.map(x=>x.id),['vendor']);
 for(const change of [{amount:123.46},{currency:'CAD'},{date:'2026-11-05'},{merchant:'Other Energy'},{sender:vendor.sender},{_status:'importing'}])assert.equal(filterBankReceiptDuplicates([vendor,{...bank,...change}]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([{...vendor,needsReview:true},bank]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([{...vendor,_status:'importing'},bank]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([vendor,bank,{...bank,id:'bank2'}]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([vendor,{...vendor,id:'vendor2'},bank]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([{...vendor,_status:'added'},bank]).hiddenCount,1);
});
test('status filters existing bank drafts, restores them when vendor is excluded, and counts correctly',async t=>{
 const env=environment(t);await account(env);
 for(const [id,status,value] of [['vendor','pending',{merchant:'Example Energy',amount:123.45,currency:'USD',date:'2026-11-09',sender:'Energy <receipts@exampleenergy.com>'}],['bank','needs_review',{merchant:'EXAMPLE ENERGY',amount:123.45,currency:'USD',date:'2026-11-09',sender:'Bank <alerts@examplebank.com>',subject:'You made a $123.45 transaction with EXAMPLE ENERGY',needsReview:true,reviewReason:'no_completion_phrase'}]]){
   await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'google:owner','account1',id,await seal(value,key,`google:owner:${id}`),status,1,1).run();
 }
 mockFetch(t,()=>user);
 let state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.pendingTotal,1);assert.equal(state.needsReviewTotal,0);assert.equal(state.filteredBankDuplicates,1);
 await env.EMAIL_DB.prepare("UPDATE email_items SET status='excluded' WHERE id='vendor'").run();
 state=await (await emailCaptureRequest(request('status'),env)).json();assert.equal(state.pendingTotal,0);assert.equal(state.needsReviewTotal,1);assert.equal(state.needsReview[0].id,'bank');
});

test('bank/vendor matching cleans prose and recurrence noise and allows three settlement days',()=>{
 const vendor={id:'v',_status:'pending',merchant:'Atmos Energy. Your payment was received',amount:42,currency:'USD',date:'2026-11-10',sender:'Atmos <receipt@vendor.example>'};
 const bank={id:'b',_status:'needs_review',merchant:'ATMOS ENERGY RCR',amount:42,currency:'USD',date:'2026-11-11',sourceKind:'bank_alert',sender:'Bank <alert@bank.example>'};
 assert.equal(filterBankReceiptDuplicates([vendor,bank]).hiddenCount,1);
 assert.equal(filterBankReceiptDuplicates([vendor,{...bank,date:'2026-11-14'}]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([vendor,bank,{...vendor,id:'other',date:'2026-11-12'}]).hiddenCount,0);
 assert.equal(filterBankReceiptDuplicates([vendor,bank,{...bank,id:'other',date:'2026-11-12'}]).hiddenCount,0);
});

test('explicit new scan clears only unimported drafts and commits the selected range before Gmail',async t=>{
 const env=environment(t),a=await account(env),now=Date.now();
 for(const status of ['pending','needs_review','ignored','added','excluded','importing']){
   await env.EMAIL_DB.prepare('INSERT INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(status,a.owner,a.id,status,'encrypted',status,1,1).run();
   await env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) VALUES(?,?,?,10)').bind(a.id,status,1).run();
 }
 await env.EMAIL_DB.prepare("UPDATE email_accounts SET scan_from=?,scan_start=?,page_token='old',lease_token='scan:abandoned',lease_until=?").bind(now-45*86400000,now-1000,now+60000).run();
 let calls=0;mockFetch(t,()=>{calls++;throw Error('must not read Gmail during reset');});
 const reset=await scanMailbox(a,env,now,{reset:true,days:2});assert.equal(reset.reset,true);assert.equal(reset.more,true);assert.equal(calls,0);
 assert.equal(reset.from,now-2*86400000);
 const saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.scan_from,reset.from);assert.equal(saved.scan_start,now);assert.equal(saved.page_token,null);assert.equal(saved.lease_until,0);
 assert.deepEqual((await env.EMAIL_DB.prepare('SELECT status FROM email_items ORDER BY status').all()).results.map(x=>x.status),['added','excluded','importing']);
 assert.deepEqual((await env.EMAIL_DB.prepare('SELECT message_id FROM email_seen ORDER BY message_id').all()).results.map(x=>x.message_id),['added','excluded','importing']);
});
test('new scan cannot replace an approval lock and stale resume cannot touch a newer scan',async t=>{
 const env=environment(t),a=await account(env),now=Date.now();
 await env.EMAIL_DB.prepare("UPDATE email_accounts SET lease_token='approval',lease_until=?").bind(now+60000).run();
 assert.equal((await scanMailbox(a,env,now,{reset:true,days:2})).busy,true);
 await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_until=0').run();
 await scanMailbox(a,env,now,{reset:true,days:2});
 const stale=await scanMailbox(a,env,now+1,{resume:true,scanId:now-1000});assert.equal(stale.canceled,true);
 assert.equal((await env.EMAIL_DB.prepare('SELECT scan_start FROM email_accounts').first()).scan_start,now);
});
test('an abandoned email fetch cannot repopulate a replaced scan',async t=>{
 const env=environment(t),a=await account(env),now=Date.now();
 await scanMailbox(a,env,now,{reset:true,days:30});
 mockFetch(t,async url=>{
   if(url.includes('/token'))return {access_token:'gmail'};
   if(url.includes('/messages?')){assert.equal(new URL(url).searchParams.get('maxResults'),'1');return {messages:[{id:'old'}]};}
   const row=await env.EMAIL_DB.prepare('SELECT lease_until FROM email_accounts').first();assert.equal(row.lease_until,now+60000);
   await scanMailbox(a,env,now+1000,{reset:true,days:2});return receipt();
 });
 const abandoned=await scanMailbox(a,env,now,{resume:true,scanId:now});assert.equal(abandoned.canceled,true);
 assert.equal((await env.EMAIL_DB.prepare('SELECT COUNT(*) AS n FROM email_items').first()).n,0);
 const saved=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts').first();assert.equal(saved.scan_start,now+1000);assert.equal(saved.scan_from,now+1000-2*86400000);
});

test('a lost completion response can be acknowledged without restarting Gmail work',async t=>{
 const env=environment(t),a=await account(env),now=Date.now();
 await scanMailbox(a,env,now,{reset:true,days:2});
 mockFetch(t,url=>url.includes('/token')?{access_token:'gmail'}:{messages:[]});
 await scanMailbox(a,env,now+1,{resume:true,scanId:now});
 mockFetch(t,()=>{throw Error('completed scan must not read Gmail again');});
 const result=await scanMailbox(a,env,now+2,{resume:true,scanId:now});assert.equal(result.completed,true);assert.equal(result.more,false);assert.equal(result.from,now-2*86400000);
 assert.equal((await env.EMAIL_DB.prepare('SELECT lease_until FROM email_accounts').first()).lease_until,0);
});
