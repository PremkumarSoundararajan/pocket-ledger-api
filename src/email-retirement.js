// Production retirement only. There is no connection, token-refresh or Gmail-read code.
export const retirementNotice = 'Email scanning has been removed. Review previous access at https://myaccount.google.com/connections. Recorded Google Sheets expenses are unchanged.';
const un64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function storedRefreshToken(account, secret) {
  const [iv, data] = account.refresh_token.split('.');
  const key = await crypto.subtle.importKey('raw', un64(secret), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:un64(iv), additionalData:new TextEncoder().encode(`${account.owner}:${account.id}`)}, key, un64(data))));
}
export async function clearRetiredScanStorage(storage) {
  await storage.deleteAlarm();
  await storage.deleteAll();
}

// A failed revocation retains ONLY the disabled, encrypted token for a manual retry.
// No refresh or scan endpoint can use it. Never return mailbox identifiers or tokens.
export async function retireEmailAccounts(env, owner = null) {
  if (!env.EMAIL_DB) return {removed:0, failed:0, remaining:0};
  const db=env.EMAIL_DB, condition=owner ? ' WHERE owner=?' : '';
  const statement = sql => owner ? db.prepare(sql+condition).bind(owner) : db.prepare(sql);
  await statement('UPDATE email_accounts SET enabled=0,next_scan=0,scan_start=NULL,job_id=NULL,lease_token=NULL,lease_until=0').run();
  await statement('DELETE FROM email_oauth_states').run();
  await statement('DELETE FROM email_items').run();
  if(owner) await db.prepare('DELETE FROM email_seen WHERE account_id IN (SELECT id FROM email_accounts WHERE owner=?)').bind(owner).run();
  else await db.prepare('DELETE FROM email_seen').run();
  const accounts=await (owner ? db.prepare('SELECT id,owner,refresh_token FROM email_accounts WHERE owner=? LIMIT 5').bind(owner) : db.prepare('SELECT id,owner,refresh_token FROM email_accounts LIMIT 5')).all();
  let removed=0, failed=0;
  for(const account of accounts.results||[]) {
    try {
      if(!env.EMAIL_SCAN_JOBS) throw Error('Cleanup binding unavailable');
      const stub=env.EMAIL_SCAN_JOBS.get(env.EMAIL_SCAN_JOBS.idFromName(`${account.owner}:${account.id}`));
      const cleared=await stub.fetch(new Request('https://retired/delete',{method:'POST'}));
      if(!cleared.ok) throw Error('Job cleanup failed');
      const token=await storedRefreshToken(account,env.EMAIL_TOKEN_KEY);
      const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(15000)});
      let revoked=response.ok;
      if(response.status===400) { try { revoked=(await response.json()).error==='invalid_token'; } catch {} }
      if(!revoked) throw Error('Revocation must be retried');
      await db.prepare('DELETE FROM email_accounts WHERE id=? AND owner=?').bind(account.id,account.owner).run();
      removed++;
    } catch { failed++; }
  }
  const count=await statement('SELECT COUNT(*) AS count FROM email_accounts').first();
  return {removed,failed,remaining:Number(count?.count||0)};
}
export async function retiredEmailRequest(req,env={}) {
  const origin=req.headers.get('Origin');
  const allowed=(env.EMAIL_ALLOWED_ORIGINS||'https://pocket-ledger-cdn.pages.dev').split(',').map(x=>x.trim());
  const headers={'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS',...(origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status=200)=>Response.json(data,{status,headers});
  if(origin&&!allowed.includes(origin)) return reply({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  const path=new URL(req.url).pathname;
  if(path==='/email/retirement/cleanup') {
    if(req.method!=='POST'||!env.EMAIL_RETIREMENT_KEY||req.headers.get('Authorization')!==`Bearer ${env.EMAIL_RETIREMENT_KEY}`) return reply({error:'Not authorized.'},403);
    try { return reply(await retireEmailAccounts(env)); }
    catch { return reply({error:'Retirement cleanup must be retried.'},503); }
  }
  if(path==='/email/disconnect'&&req.method==='POST') {
    const bearer=req.headers.get('Authorization');
    if(!/^Bearer \S+$/i.test(bearer||'')) return reply({error:'Sign in to remove previous Gmail access.'},401);
    try {
      const response=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:bearer},signal:AbortSignal.timeout(15000)});
      if(!response.ok) return reply({error:'Sign in again to remove previous Gmail access.'},401);
      const user=await response.json();
      if(!user.sub||!user.email_verified) return reply({error:'A verified Google account is required.'},401);
      const result=await retireEmailAccounts(env,`google:${user.sub}`);
      return reply({disconnected:result.remaining===0,revoked:result.remaining===0,...result,notice:retirementNotice});
    } catch { return reply({error:'Retry removal or revoke access in your Google Account.'},503); }
  }
  if(path==='/email/config') return reply({enabled:false,retired:true,notice:retirementNotice});
  return reply({enabled:false,retired:true,error:retirementNotice,accounts:[],items:[],needsReview:[]},410);
}
