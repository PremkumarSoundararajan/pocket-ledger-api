import { inspectEmailReceipt, receiptParserVersion, emailMerchantName } from './email-receipts.js';
import { receiptTimezone } from './email-receipt-dates.js';
import { MerchantClassificationIndex, merchantFingerprint, readMerchantClassifications, saveImportCategoryExceptions } from './merchant-classifications.js';

const scopes='openid email https://www.googleapis.com/auth/gmail.readonly';
const currencies=new Set(['USD','CAD','AUD','EUR','GBP','INR','SGD','MYR']);
const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const un64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const url64=bytes=>b64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function digest(value) { return url64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value)))); }
export function emailConfigured(env) {return env.EMAIL_CAPTURE_ENABLED==='true' && !!(env.EMAIL_DB&&env.EMAIL_OAUTH_CLIENT_ID&&env.EMAIL_OAUTH_CLIENT_SECRET&&env.EMAIL_CALLBACK_URL&&env.EMAIL_TOKEN_KEY);}
let lastEncryptionKey;
async function encryptionKey(secret){
  if(lastEncryptionKey?.secret===secret)return lastEncryptionKey.key;
  if(un64(secret).length!==32)throw new Error('Email encryption key must contain 32 bytes.');
  const key=crypto.subtle.importKey('raw',un64(secret),'AES-GCM',false,['encrypt','decrypt']);
  lastEncryptionKey={secret,key};return key;
}
export async function seal(value,secret,aad) {
  const key=await encryptionKey(secret);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(value)))))}`;
}
export async function unseal(value,secret,aad) {
  const [iv,data]=value.split('.');
  const key=await encryptionKey(secret);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv),additionalData:enc.encode(aad)},key,un64(data))));
}
class ApiError extends Error { constructor(message,status=400,code){super(message);this.status=status;this.code=code;} }
export function googleApiFailure(status,payload,service='Google') {
  const reasons=new Set([...(payload?.error?.errors||[]).map(x=>x.reason),...(payload?.error?.details||[]).map(x=>x.reason)]);
  let message,code;
  if(status===401){code='google_auth_expired';message=`${service} authorization expired. Reconnect the mailbox in Settings.`;}
  else if(['accessNotConfigured','SERVICE_DISABLED','serviceDisabled'].some(x=>reasons.has(x))){code='google_api_disabled';message=`${service} API is not enabled for the ${service==='Gmail'?'email OAuth':'Google OAuth'} project. Enable it in Google Cloud Console, then retry.`;}
  else if(['insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT'].some(x=>reasons.has(x))){code='google_scope_missing';message=service==='Gmail'?'Gmail read permission is missing. Reconnect Gmail in Settings and grant read-only email access.':'Google permission is missing. Sign in to Pocket Ledger again and grant the requested access.';}
  else if(reasons.has('domainPolicy')){code='google_admin_blocked';message='Your Google Workspace administrator blocks this app from accessing Gmail. Contact your administrator.';}
  else if(status===429||['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','quotaExceeded','RATE_LIMIT_EXCEEDED'].some(x=>reasons.has(x))){code='google_rate_limited';message=`${service} usage limit reached. Wait and retry later; reconnecting will not help.`;}
  else if(status>=500){code='google_service_unavailable';message=`${service} is temporarily unavailable. Your scan results are saved. Retry later.`;}
  else {code='google_request_rejected';message=`${service} rejected the request (HTTP ${status}). Check the API configuration and account permissions before retrying.`;}
  const error=new ApiError(message,status===401?401:502,code);
  // Only fixed diagnostic labels: never tokens, email contents, addresses or URLs.
  console.warn(JSON.stringify({event:'email_google_failure',service,status,code}));
  return error;
}
function origins(env){return (env.EMAIL_ALLOWED_ORIGINS||'https://pocket-ledger-cdn.pages.dev').split(',').map(x=>x.trim());}
function headers(req,env){const origin=req.headers.get('Origin');return {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
  ...(origin&&origins(env).includes(origin)?{'Access-Control-Allow-Origin':origin}:{}),
  'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};}
export async function emailGoogle(url,token,options={}) {
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers},signal:AbortSignal.timeout(15000)});
  if(!response.ok){let payload;try{payload=await response.json();}catch{/* An upstream error can be non-JSON. */}const error=googleApiFailure(response.status,payload,new URL(url).hostname==='gmail.googleapis.com'?'Gmail':new URL(url).hostname==='sheets.googleapis.com'?'Google Sheets':'Google');error.googleStatus=response.status;const retry=response.headers.get('Retry-After');error.retryAfterMs=retry?Math.max(0,/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now()):0;throw error;}
  return response.json();
}
function mailboxJob(env,owner,accountId){return env.EMAIL_SCAN_JOBS.get(env.EMAIL_SCAN_JOBS.idFromName(`${owner}:${accountId}`));}
async function jobCall(env,owner,accountId,action,data={}){return mailboxJob(env,owner,accountId).fetch(new Request(`https://mailbox/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,owner,accountId})}));}
const google=emailGoogle;
async function identity(req) {
  const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if(!token) throw new ApiError('Sign in to Pocket Ledger first.',401);
  const user=await google('https://www.googleapis.com/oauth2/v3/userinfo',token);
  if(!user.sub || !user.email || !user.email_verified) throw new ApiError('A verified Google account is required.',401);
  return {owner:`google:${user.sub}`,token};
}
async function body(req){const text=await req.text();if(text.length>50000)throw new ApiError('Request too large.',413);try{return JSON.parse(text||'{}');}catch{throw new ApiError('Invalid JSON.');}}
export function manualScanRange(data,account,now=Date.now()) {
  const oldest=now-30*86400000;
  if(data.resume===true){
    if(!account.scan_start||!account.scan_from)throw new ApiError('No paused scan. Choose a new date range.');
    if(account.scan_from<account.scan_start-30*86400000 || account.scan_start<now-7*86400000)throw new ApiError('This paused scan is too old. Start a new scan of up to 30 days.');
    return {from:account.scan_from,to:account.scan_start,page:account.page_token||null};
  }
  if(data.sinceLast===true){
    if(!account.last_scan||account.last_scan<oldest)throw new ApiError('Choose 1–30 days; use bank statements for older expenses.');
    return {from:account.last_scan,to:now,page:null};
  }
  if(!Number.isInteger(data.days)||data.days<1||data.days>30)throw new ApiError('Choose 1–30 days; use bank statements for longer periods.');
  return {from:now-data.days*86400000,to:now,page:null};
}
export async function refreshEmailAccess(account,env){
  const token=await unseal(account.refresh_token,env.EMAIL_TOKEN_KEY,`${account.owner}:${account.id}`);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.EMAIL_OAUTH_CLIENT_ID,client_secret:env.EMAIL_OAUTH_CLIENT_SECRET,refresh_token:token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok||!result.access_token){
    if(result.error==='invalid_client')throw new ApiError('Email OAuth credentials are invalid. Check the Worker client ID and client secret against the Google Cloud OAuth client.',502,'google_oauth_config');
    if(result.error==='invalid_grant')throw new ApiError('Gmail authorization expired or was revoked. Reconnect Gmail in Settings.',401,'google_auth_expired');
    throw googleApiFailure(response.status,result,'Google authorization');
  }
  return {token:result.access_token,expiresAt:Date.now()+Math.max(60,Number(result.expires_in)||3600)*1000};
}
async function refresh(account,env){return (await refreshEmailAccess(account,env)).token;}
export async function scanMailbox(account,env,now=Date.now(),options={days:7}) {
  const lease=`scan:${crypto.randomUUID()}`,reset=options.reset===true&&options.resume!==true;
  const claimed=await env.EMAIL_DB.prepare("UPDATE email_accounts SET lease_token=?,lease_until=?,job_id=NULL WHERE id=? AND (job_id IS NULL OR scan_start IS NULL) AND (lease_until<? OR (?=1 AND lease_token LIKE 'scan:%')) RETURNING *").bind(lease,now+60000,account.id,now,reset?1:0).first();
  if(!claimed)return {busy:true};
  try{
    if(options.resume&&options.scanId!=null&&Number(options.scanId)!==claimed.scan_start){
      if(claimed.scan_start==null&&Number(options.scanId)===claimed.last_scan)return {completed:true,more:false,from:claimed.scan_from,through:claimed.last_scan,scanId:claimed.last_scan};
      return {canceled:true,more:false};
    }
    const range=manualScanRange(options,claimed,now),start=range.to;
    let timezone;
    try{timezone=receiptTimezone(options.resume?claimed.timezone:(options.timezone||claimed.timezone||'UTC'));}catch{throw new ApiError('Choose a valid IANA timezone for email dates.');}
    const setup=[];
    if(reset){
      setup.push(env.EMAIL_DB.prepare("DELETE FROM email_seen WHERE account_id=? AND message_id NOT IN (SELECT message_id FROM email_items WHERE account_id=? AND status IN ('added','excluded','importing')) AND EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND lease_token=?)").bind(account.id,account.id,account.id,lease));
      setup.push(env.EMAIL_DB.prepare("DELETE FROM email_items WHERE account_id=? AND status IN ('pending','needs_review','ignored') AND EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND lease_token=?)").bind(account.id,account.id,lease));
    }
    setup.push(env.EMAIL_DB.prepare('UPDATE email_accounts SET scan_from=?,scan_start=?,page_token=?,timezone=?,last_error=NULL WHERE id=? AND lease_token=?').bind(range.from,start,range.page,timezone,account.id,lease));
    await env.EMAIL_DB.batch(setup);
    // Accept/reset the new session before doing any Gmail work. The client
    // gets its stable scan ID and empty inbox immediately, then resumes pages.
    if(reset)return {reset:true,more:true,added:0,needsReview:0,evaluated:0,from:range.from,through:start,scanId:start};
    const token=await refresh(claimed,env);
    const after=Math.floor(range.from/1000)-1;
    const q=`after:${after} before:${Math.floor(start/1000)+1} -in:spam -in:trash (receipt OR invoice OR payment OR charged OR debited OR spent OR "order confirmation" OR "subscription renewed" OR "transaction amount" OR "amount paid" OR "you made" OR "you sent" OR category:purchases)`;
    let page=range.page,added=0,needsReview=0,evaluated=0,ignored=0;
    const reasonCounts={};
    for(let batch=0;batch<1;batch++) {
      // One email per invocation bounds parsing/crypto CPU on Workers Free.
      const query=new URLSearchParams({q,maxResults:'1',...(page?{pageToken:page}:{})});
      const listing=await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,token);
      for(const message of listing.messages||[]) {
        const seen=await env.EMAIL_DB.prepare('SELECT s.parser_version,i.id AS item_id,i.status,i.proposal FROM email_seen s LEFT JOIN email_items i ON i.account_id=s.account_id AND i.message_id=s.message_id WHERE s.account_id=? AND s.message_id=?').bind(account.id,message.id).first();
        if(seen&&(seen.parser_version>=receiptParserVersion||(seen.item_id&&['added','excluded','importing'].includes(seen.status))))continue;
        const full=await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`,token);
        if(!(await env.EMAIL_DB.prepare('SELECT id FROM email_accounts WHERE id=? AND lease_token=?').bind(account.id,lease).first()))return {canceled:true,more:false};
        const outcome=inspectEmailReceipt(full,claimed.currency,{timezone}),proposal=outcome.proposal||outcome.review;
        const status=outcome.proposal?'pending':outcome.review?'needs_review':'ignored';evaluated++;
        if(status==='ignored')ignored++;
        if(outcome.reason)reasonCounts[outcome.reason]=(reasonCounts[outcome.reason]||0)+1;
        const writes=[];
        if(seen?.item_id&&['pending','needs_review','ignored'].includes(seen.status)){
          writes.push(env.EMAIL_DB.prepare("UPDATE email_items SET proposal=?,status=?,updated_at=? WHERE id=? AND status IN ('pending','needs_review','ignored') AND EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND lease_token=?)")
            .bind(proposal?await seal(proposal,env.EMAIL_TOKEN_KEY,`${claimed.owner}:${seen.item_id}`):'',status,now,seen.item_id,account.id,lease));
        }
        if(proposal){
          const id=`email:${await digest(`${claimed.owner}|${claimed.mailbox_sub}|${message.id}`)}`;
          writes.push(env.EMAIL_DB.prepare('INSERT OR IGNORE INTO email_items(id,owner,account_id,message_id,proposal,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND lease_token=?)')
            .bind(id,claimed.owner,account.id,message.id,await seal(proposal,env.EMAIL_TOKEN_KEY,`${claimed.owner}:${id}`),status,now,now,account.id,lease));
          if(!seen?.item_id){if(status==='pending')added++;else needsReview++;}
        }
        writes.push(env.EMAIL_DB.prepare('INSERT INTO email_seen(account_id,message_id,seen_at,parser_version) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM email_accounts WHERE id=? AND lease_token=?) ON CONFLICT(account_id,message_id) DO UPDATE SET seen_at=excluded.seen_at,parser_version=excluded.parser_version').bind(account.id,message.id,now,receiptParserVersion,account.id,lease));
        await env.EMAIL_DB.batch(writes);
      }
      page=listing.nextPageToken||null;if(!page)break;
    }
    const done=await env.EMAIL_DB.prepare('UPDATE email_accounts SET last_scan=?,scan_start=?,scan_from=?,page_token=?,next_scan=0,last_error=NULL,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?')
      .bind(page?claimed.last_scan:start,page?start:null,range.from,page,account.id,lease).run();
    if(!done.meta?.changes)return {canceled:true,more:false};
    return {added,needsReview,ignored,evaluated,reasonCounts,more:!!page,reset,from:range.from,through:start,scanId:start};
  }catch(error){
    await env.EMAIL_DB.prepare('UPDATE email_accounts SET last_error=?,next_scan=0,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?')
      .bind(error instanceof ApiError?error.message:'Scan paused. Resume in the app; saved results are retained.',account.id,lease).run();
    throw error;
  }finally{
    await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(account.id,lease).run();
  }
}
export async function scheduledEmailScans(env,now=Date.now()) {
  // Deliberately inert, including invocations from stale deployed cron triggers.
  // Gmail is accessed only by an authenticated user's explicit scan request.
}
async function callback(req,env) {
  const url=new URL(req.url),state=url.searchParams.get('state');
  if(!state)throw new ApiError('Missing connection state.');
  const saved=await env.EMAIL_DB.prepare('DELETE FROM email_oauth_states WHERE state_hash=? AND expires_at>? RETURNING *').bind(await digest(state),Date.now()).first();
  if(!saved)throw new ApiError('Connection expired or already used. Connect Gmail again.');
  if(url.searchParams.has('error'))throw new ApiError('Gmail permission was not granted. Return to Pocket Ledger to try again.');
  const code=url.searchParams.get('code');if(!code)throw new ApiError('Missing authorization code.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({code,client_id:env.EMAIL_OAUTH_CLIENT_ID,client_secret:env.EMAIL_OAUTH_CLIENT_SECRET,redirect_uri:env.EMAIL_CALLBACK_URL,code_verifier:saved.verifier,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
  const tokens=await response.json();
  if(!response.ok || !tokens.access_token || !String(tokens.scope||'').split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) throw new ApiError('Read-only Gmail permission is required. Reconnect Gmail.');
  const mailbox=await google('https://www.googleapis.com/oauth2/v3/userinfo',tokens.access_token);
  if(!mailbox.sub||!mailbox.email||!mailbox.email_verified)throw new ApiError('Could not verify this mailbox.');
  const existing=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts WHERE owner=? AND mailbox_sub=?').bind(saved.owner,mailbox.sub).first();
  const count=await env.EMAIL_DB.prepare('SELECT COUNT(*) AS count FROM email_accounts WHERE owner=?').bind(saved.owner).first();
  if(!existing && count.count>=1)throw new ApiError('Disconnect the existing mailbox in Settings before changing email.');
  const id=existing?.id||crypto.randomUUID();
  if(!tokens.refresh_token&&!existing)throw new ApiError('Offline Gmail permission is required. Connect again and grant access.');
  const encrypted=tokens.refresh_token?await seal(tokens.refresh_token,env.EMAIL_TOKEN_KEY,`${saved.owner}:${id}`):existing.refresh_token;
  await env.EMAIL_DB.prepare(`INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(owner,mailbox_sub) DO UPDATE SET refresh_token=excluded.refresh_token,enabled=1,currency=excluded.currency,timezone=excluded.timezone,next_scan=0,last_error=NULL,last_scan=0,scan_start=NULL,scan_from=NULL,page_token=NULL`)
    .bind(id,saved.owner,mailbox.sub,mailbox.email,encrypted,saved.timezone,0,0,saved.currency,0).run();
  return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Gmail connected</title><h1>Gmail connected</h1><p>Return to Pocket Ledger and refresh Email expense capture. Only expenses you approve will be imported.</p>',
    {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}});
}
function cleanApproved(item,currency) {
  if(!item||typeof item.id!=='string'||typeof item.merchant!=='string'||!item.merchant.trim()||item.merchant.length>160)throw new ApiError('Verify each merchant name.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!Number.isFinite(new Date(item.date).getTime())||!new Date(item.date).toISOString().startsWith(item.date))throw new ApiError('Verify each payment date.');
  if(!Number.isFinite(item.amount)||Math.round(item.amount*100)<1||item.amount>100000000||item.currency!==currency)throw new ApiError('Verify amounts and currency. Currency conversion is not performed.');
  if(!['Regular','Planned Occasional','Unexpected Occasional','Unknown'].includes(item.expenseType))throw new ApiError('Invalid Expense Type.');
  if(typeof item.category!=='string'||!item.category.trim()||item.category.length>120)throw new ApiError('Choose a category.');
  if(item.group!=null&&!['Essential','Potentially Flexible','Unclassified'].includes(item.group))throw new ApiError('Invalid essentiality.');
  if(item.importAnyway!=null&&typeof item.importAnyway!=='boolean')throw new ApiError('Confirm duplicate review explicitly.');
  if(item.manualReviewConfirmed!=null&&typeof item.manualReviewConfirmed!=='boolean')throw new ApiError('Confirm manual review explicitly.');
  return {...item,merchant:item.merchant.trim(),amount:Math.round(item.amount*100)/100};
}
const normal=value=>String(value||'').toUpperCase().replace(/[^A-Z]/g,'');
function senderDomain(item){return item.sourceDomain||String(item.sender||'').match(/@([a-z0-9.-]+)/i)?.[1]?.toLowerCase()||'';}
function isBankAlert(item){
  return item.sourceKind==='bank_alert'||/\byou (?:sent|made)\b|\btransaction alert\b|\b(?:card|account) ending (?:in )?/i.test(`${item.subject||''}\n${item.excerpt||''}`);
}
export function filterBankReceiptDuplicates(entries){
  const key=item=>{
    const merchant=merchantFingerprint(emailMerchantName(item.merchant));
    return merchant&&Number(item.amount)>0&&/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?`${merchant}|${item.currency}|${Math.round(Number(item.amount)*100)}`:null;
  };
  const vendors=new Map(),banks=new Map();
  for(const item of entries){
    const k=key(item);if(!k)continue;
    if(isBankAlert(item)){
      if(['pending','needs_review'].includes(item._status)){if(!banks.has(k))banks.set(k,[]);banks.get(k).push(item);}
    }else if(['pending','added'].includes(item._status)&&!item.needsReview&&!item.amountIsSuggestion&&!item.reviewBlocked){
      if(!vendors.has(k))vendors.set(k,[]);vendors.get(k).push(item);
    }
  }
  const hidden=new Set();
  const nearby=(a,b)=>Math.abs(Date.parse(a.date)-Date.parse(b.date))<=3*86400000;
  for(const [k,alerts] of banks){
    for(const bank of alerts){
      const matches=(vendors.get(k)||[]).filter(v=>nearby(bank,v));
      if(matches.length!==1)continue;
      const vendor=matches[0];if(alerts.filter(b=>nearby(b,vendor)).length!==1)continue;
      const a=senderDomain(bank),b=senderDomain(vendor);
      if(a&&b&&a!==b)hidden.add(bank.id);
    }
  }
  return {items:entries.filter(x=>!hidden.has(x.id)),hiddenCount:hidden.size};
}
export function possibleEmailDuplicate(item,row) {
  const a=normal(merchantFingerprint(row[3])),b=normal(merchantFingerprint(item.merchant));
  return String(row[2]).toLowerCase()!=='transfers' && Math.abs(Number(row[1])-item.amount)<.005 && String(row[0]).slice(0,10)===item.date && a && b && (a===b||(a.length>=4&&b.length>=4&&(a.startsWith(b)||b.startsWith(a))));
}
async function approve(req,data,env,user) {
  if(typeof data.spreadsheetId!=='string'||!/^[\w-]{10,150}$/.test(data.spreadsheetId))throw new ApiError('Connect a Google spreadsheet first.');
  if(!currencies.has(data.currency)||!Array.isArray(data.items)||!data.items.length||data.items.length>50||new Set(data.items.map(x=>x.id)).size!==data.items.length)throw new ApiError('Select 1–50 unique expenses in one currency.');
  const items=data.items.map(x=>cleanApproved(x,data.currency));
  const accountIds=new Set(),proposals=new Map();
  for(const item of items){const row=await env.EMAIL_DB.prepare('SELECT * FROM email_items WHERE owner=? AND id=?').bind(user.owner,item.id).first();if(!row)throw new ApiError('Email proposal not found.',404);if(row.status==='excluded')throw new ApiError('An excluded expense cannot be imported.');accountIds.add(row.account_id);proposals.set(item.id,row);}
  // Serialize approval against scans/other approvals for these mailboxes. A retry
  // reads stable transaction IDs from Sheets before attempting any new append.
  const lease=crypto.randomUUID(),now=Date.now(),locked=[];
  try{
    for(const id of [...accountIds].sort()){
      const row=await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=?,lease_until=? WHERE owner=? AND id=? AND lease_until<? AND (job_id IS NULL OR scan_start IS NULL) RETURNING id').bind(lease,now+10*60000,user.owner,id,now).first();
      if(!row)throw new ApiError('A scan or import is in progress. Retry shortly.',409);locked.push(id);
    }
    const root=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(data.spreadsheetId)}`;
    const sheet=await google(`${root}/values/${encodeURIComponent('Sheet1!A1:G')}`,user.token);
    const rows=sheet.values||[],head=rows[0]||[];
    if(head[5]!=='Transaction ID'||head[4]!=='Expense Type')throw new ApiError('Open the ledger once to initialize its transaction columns.');
    const ids=new Map(rows.slice(1).map((r,i)=>[r[5],i+2]));
    const info=await google(`${root}?fields=sheets.properties.title`,user.token);
    const merchantState=await readMerchantClassifications(data.spreadsheetId,user.token,info.sheets?.some(x=>x.properties?.title==='Merchant Classifications')===true);
    const index=new MerchantClassificationIndex(merchantState.records.values());
    const duplicates=[],writes=[],metadata=[];
    for(const item of items){
      if(ids.has(item.id))continue;
      const proposal=proposals.get(item.id);
      const extracted=proposal.proposal?await unseal(proposal.proposal,env.EMAIL_TOKEN_KEY,`${user.owner}:${item.id}`):null;
      const manual=proposal.status==='needs_review'&&extracted?.needsReview&&item.manualReviewConfirmed===true;
      if(proposal.status==='needs_review'&&!manual)throw new ApiError('Open this email, enter the correct expense details, and confirm that the payment completed before approving it.',409,'manual_review_required');
      if(extracted?.reviewBlocked)throw new ApiError('This older draft could not be safely re-read. Exclude it and add the expense manually after checking the email. No expense was added.',409,'receipt_review_blocked');
      if(!extracted?.amountText&&!manual)throw new ApiError('Receipt parsing was updated. Scan the original date range again to verify this older draft before approving it.',409,'receipt_recheck_required');
      if(proposal.status==='importing' && (!item.importAnyway || proposal.updated_at>now-10*60000))throw new ApiError('A previous import could not be confirmed. Check your Sheet first. After ten minutes, retry with Import anyway only if the payment is absent.',409);
      const match=rows.slice(1).find(r=>possibleEmailDuplicate(item,r));
      if(match&&!item.importAnyway){duplicates.push(item.id);continue;}
      const rule=index.merchantFor(item.merchant);
      metadata.push({id:`t:${item.id}`,kind:'transaction',transactionId:item.id,category:item.category,categoryId:item.categoryId||null,expenseType:item.expenseType,group:item.group||rule?.group||'Unclassified'});
      const values=[item.date,item.amount,item.category,item.merchant,item.expenseType,item.id,item.categoryId||''];
      writes.push(values);rows.push(values);
    }
    // Metadata is retryable; do not append if saving explicit review choices fails.
    if(metadata.length)await saveImportCategoryExceptions(data.spreadsheetId,user.token,merchantState,metadata);
    if(writes.length){
      await env.EMAIL_DB.batch(writes.map(row=>env.EMAIL_DB.prepare("UPDATE email_items SET status='importing',updated_at=? WHERE owner=? AND id=?").bind(now,user.owner,row[5])));
      // Stable F IDs are checked under the approval lease on each retry.
      // No unattended cron ever writes the sheet.
      const response=await fetch(`${root}/values/${encodeURIComponent('Sheet1!A1:G')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},body:JSON.stringify({values:writes}),signal:AbortSignal.timeout(15000)});
      if(!response.ok){
        if(response.status>=400 && response.status<500) await env.EMAIL_DB.batch(writes.map(row=>env.EMAIL_DB.prepare("UPDATE email_items SET status='pending' WHERE owner=? AND id=?").bind(user.owner,row[5])));
        throw new ApiError('Could not confirm the Sheets write. Refresh and recheck before retrying.',502);
      }
    }
    const completed=items.filter(x=>!duplicates.includes(x.id));
    if(completed.length){
      const updates=await Promise.all(completed.map(async x=>{
        const original=proposals.get(x.id),source=original.proposal?await unseal(original.proposal,env.EMAIL_TOKEN_KEY,`${user.owner}:${x.id}`):{};
        // Retain only an encrypted matching key, not email evidence, so later
        // bank alerts can be compared with receipts already imported.
        const key={merchant:x.merchant,amount:x.amount,currency:x.currency,date:x.date,sourceKind:isBankAlert(source)?'bank_alert':'receipt',sourceDomain:senderDomain(source)};
        const stored=original.status==='added'?original.proposal:await seal(key,env.EMAIL_TOKEN_KEY,`${user.owner}:${x.id}`);
        return env.EMAIL_DB.prepare("UPDATE email_items SET status='added',proposal=?,updated_at=? WHERE owner=? AND id=?").bind(stored,Date.now(),user.owner,x.id);
      }));
      await env.EMAIL_DB.batch(updates);
    }
    return {added:writes.length,alreadyAdded:completed.length-writes.length,duplicates};
  }finally{
    for(const id of locked)await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,lease).run();
  }
}

export async function emailCaptureRequest(req,env={}) {
  const h=headers(req,env),reply=(value,status=200)=>Response.json(value,{status,headers:h});
  try{
    const path=new URL(req.url).pathname;
    const origin=req.headers.get('Origin');if(origin&&!origins(env).includes(origin))return reply({error:'Origin not allowed.'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});
    if(!emailConfigured(env))return reply({enabled:false,error:'Email capture is not configured yet. Normal expense tracking remains available.'},503);
    if(path==='/email/oauth/callback'&&req.method==='GET')return await callback(req,env);
    const user=await identity(req);
    if(path==='/email/config'&&req.method==='GET')return reply({enabled:true});
    if(path==='/email/status'&&req.method==='GET'){
      await encryptionKey(env.EMAIL_TOKEN_KEY);
      const accounts=await env.EMAIL_DB.prepare('SELECT id,email,currency,last_scan,last_error,scan_start,scan_from,page_token,job_id FROM email_accounts WHERE owner=? ORDER BY email').bind(user.owner).all();
      if(env.EMAIL_SCAN_JOBS)await Promise.all((accounts.results||[]).filter(a=>a.job_id).map(async a=>{const response=await jobCall(env,user.owner,a.id,'progress');if(response.ok)a.job=(await response.json()).job;}));
      const rows=await env.EMAIL_DB.prepare("SELECT * FROM email_items WHERE owner=? AND status IN ('pending','importing','needs_review','added') AND proposal<>'' ORDER BY created_at DESC").bind(user.owner).all();
      const decode=async x=>({id:x.id,accountId:x.account_id,importUncertain:x.status==='importing',...await unseal(x.proposal,env.EMAIL_TOKEN_KEY,`${user.owner}:${x.id}`),_status:x.status});
      const decoded=[];
      // Filter legacy encrypted drafts at read time too: a refresh must not
      // require another Gmail scan to hide old missing/zero-only amounts.
      for(let offset=0;offset<(rows.results||[]).length;offset+=50){
        decoded.push(...await Promise.all(rows.results.slice(offset,offset+50).map(decode)));
      }
      const filtered=filterBankReceiptDuplicates(decoded);
      const visibleItems=filtered.items.filter(x=>['pending','importing'].includes(x._status));
      const visibleReviews=filtered.items.filter(x=>x._status==='needs_review'&&(Number(x.amount)>0||(x.amountCandidates||[]).some(c=>Number(c.amount)>0||(!c.amount&&/[1-9]/.test(c.amountText||'')))));
      const publicItem=({_status,...item})=>({...item,merchant:emailMerchantName(item.merchant)});
      return reply({accounts:accounts.results||[],pendingTotal:visibleItems.length,needsReviewTotal:visibleReviews.length,filteredBankDuplicates:filtered.hiddenCount,items:visibleItems.slice(0,200).map(publicItem),needsReview:visibleReviews.slice(0,200).map(publicItem)});
    }
    if(path==='/email/connect'&&req.method==='POST'){
      const settings=await body(req);if(!currencies.has(settings.currency))throw new ApiError('Choose a supported currency.');const state=url64(crypto.getRandomValues(new Uint8Array(32))),verifier=url64(crypto.getRandomValues(new Uint8Array(32)));
      try{receiptTimezone(settings.timezone||'UTC');}catch{throw new ApiError('Choose a valid IANA timezone.');}
      await env.EMAIL_DB.prepare('DELETE FROM email_oauth_states WHERE expires_at<?').bind(Date.now()).run();
      await env.EMAIL_DB.prepare('INSERT INTO email_oauth_states(state_hash,owner,verifier,expires_at,timezone,hour,minute,currency) VALUES(?,?,?,?,?,?,?,?)').bind(await digest(state),user.owner,verifier,Date.now()+10*60000,settings.timezone||'UTC',0,0,settings.currency).run();
      return reply({url:`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({client_id:env.EMAIL_OAUTH_CLIENT_ID,redirect_uri:env.EMAIL_CALLBACK_URL,response_type:'code',scope:scopes,access_type:'offline',prompt:'consent select_account',state,code_challenge:await digest(verifier),code_challenge_method:'S256'})}`});
    }
    if(path==='/email/schedule'&&req.method==='POST'){
      throw new ApiError('Automatic email scanning has been removed. Start scans from Expenses.',410);
    }
    if(['/email/scan/start','/email/scan/progress','/email/scan/pause'].includes(path)&&req.method==='POST'){
      if(!env.EMAIL_SCAN_JOBS)throw new ApiError('Background scans are not configured on this server.',503);
      const data=await body(req),account=await env.EMAIL_DB.prepare('SELECT id FROM email_accounts WHERE owner=? AND id=?').bind(user.owner,String(data.accountId)).first();
      if(!account)throw new ApiError('Mailbox not found.',404);
      const response=await jobCall(env,user.owner,account.id,path.split('/').at(-1),data);
      return reply(await response.json(),response.status);
    }
    if(path==='/email/scan'&&req.method==='POST'){
      const data=await body(req);const account=await env.EMAIL_DB.prepare('SELECT * FROM email_accounts WHERE owner=? AND id=?').bind(user.owner,String(data.accountId)).first();
      if(!account)throw new ApiError('Mailbox not found.',404);
      return reply(await scanMailbox(account,env,Date.now(),data));
    }
    if(path==='/email/approve'&&req.method==='POST')return reply(await approve(req,await body(req),env,user));
    if(path==='/email/exclude'&&req.method==='POST'){
      const data=await body(req);if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>200)throw new ApiError('Choose expenses to exclude.');
      const ids=new Set();
      for(const id of data.ids){const item=await env.EMAIL_DB.prepare('SELECT status,account_id FROM email_items WHERE owner=? AND id=?').bind(user.owner,String(id)).first();if(item?.status==='importing')throw new ApiError('Check your Sheet and resolve the uncertain import before excluding this expense.',409);if(item)ids.add(item.account_id);}
      const lease=crypto.randomUUID(),now=Date.now(),locked=[];
      try{
        for(const id of [...ids].sort()){const claimed=await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=?,lease_until=? WHERE owner=? AND id=? AND lease_until<? AND (job_id IS NULL OR scan_start IS NULL) RETURNING id').bind(lease,now+60000,user.owner,id,now).first();if(!claimed)throw new ApiError('A scan or import is in progress. Retry shortly.',409);locked.push(id);}
        for(const id of data.ids){const item=await env.EMAIL_DB.prepare('SELECT status FROM email_items WHERE owner=? AND id=?').bind(user.owner,String(id)).first();if(item?.status==='importing')throw new ApiError('Check your Sheet and resolve the uncertain import before excluding this expense.',409);}
        await env.EMAIL_DB.batch(data.ids.map(id=>env.EMAIL_DB.prepare("UPDATE email_items SET status='excluded',proposal='',updated_at=? WHERE owner=? AND id=? AND status IN ('pending','needs_review')").bind(now,user.owner,String(id))));
      }finally{for(const id of locked)await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,lease).run();}
      return reply({excluded:true});
    }
    if(path==='/email/disconnect'&&req.method==='POST'){
      const data=await body(req),now=Date.now();const account=await env.EMAIL_DB.prepare('UPDATE email_accounts SET lease_token=?,lease_until=? WHERE owner=? AND id=? AND lease_until<? RETURNING *').bind(crypto.randomUUID(),now+60000,user.owner,String(data.accountId),now).first();if(!account)throw new ApiError('Mailbox unavailable or busy. Disconnect after any scan or import finishes.',409);
      let revoked=false;
      try {const token=await unseal(account.refresh_token,env.EMAIL_TOKEN_KEY,`${user.owner}:${account.id}`);const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(15000)});revoked=response.ok;}catch{/* Delete local access even if provider revocation is unavailable. */}
      await env.EMAIL_DB.prepare('DELETE FROM email_accounts WHERE owner=? AND id=?').bind(user.owner,account.id).run();
      if(env.EMAIL_SCAN_JOBS)await jobCall(env,user.owner,account.id,'delete');
      return reply({disconnected:true,revoked});
    }
    return reply({error:'Email action not found.'},404);
  }catch(error){return reply({error:error instanceof ApiError?error.message:'Email capture is temporarily unavailable. Please retry.',...(error.code?{code:error.code}:{})},error instanceof ApiError?error.status:503);}
}
