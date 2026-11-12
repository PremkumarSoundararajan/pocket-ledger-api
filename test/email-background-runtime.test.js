import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {seal} from '../src/email-capture.js';
import {receiptMessage,key} from '../test-support/email-job-env.js';

test('real Durable Object runtime executes its alarm job after the start response returns', {timeout:60000},async t=>{
  let tokenRefreshes=0,bodyReads=0;
  const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
    modules:[{type:'ESModule',path:'worker.js',contents:bundle.outputFiles[0].text}],compatibilityDate:'2026-10-23',
    durableObjects:{EMAIL_SCAN_JOBS:{className:'EmailScanJob',useSQLite:true}},d1Databases:['EMAIL_DB'],
    bindings:{EMAIL_CAPTURE_ENABLED:'true',EMAIL_OAUTH_CLIENT_ID:'client',EMAIL_OAUTH_CLIENT_SECRET:'secret',EMAIL_CALLBACK_URL:'https://example.test/callback',EMAIL_TOKEN_KEY:key},
    outboundService:async req=>{
      const url=new URL(req.url);
      if(url.pathname.includes('userinfo'))return Response.json({sub:'owner',email:'test@example.test',email_verified:true});
      if(url.pathname==='/token'){tokenRefreshes++;return Response.json({access_token:'token',expires_in:3600});}
      if(url.pathname.endsWith('/messages'))return Response.json({messages:Array.from({length:30},(_,i)=>({id:`m${i}`})),resultSizeEstimate:30});
      if(url.pathname.includes('/messages/')){if(url.searchParams.get('format')==='full')bodyReads++;return Response.json(receiptMessage(url.pathname.split('/').at(-1)));}
      throw Error('Unexpected outbound service');
    },
  }]}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('EMAIL_DB');
  for(const name of ['0001_email_capture','0002_manual_email_scans','0003_receipt_parser_versions','0004_background_email_jobs']){
    const sql=readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8').replace(/^--.*$/gm,'');
    for(const stmt of sql.split(';').filter(s=>s.trim()))await db.prepare(stmt).run();
  }
  await db.prepare('INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('mailbox','google:owner','user','test@example.test',await seal('refresh',key,'google:owner:mailbox'),'UTC',0,0,'USD',0).run();
  const call=async(action,data)=>mf.dispatchFetch(`https://example.test/email/scan/${action}`,{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({accountId:'mailbox',...data})});
  const started=await call('start',{days:2,requestId:'runtime'});assert.equal(started.status,200,await started.clone().text());
  const response=await started.json();assert.equal(response.job.status,'running');
  // No further scan/start or scan/resume requests: alarms do all Gmail work.
  let status;
  for(let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,250));
    status=await (await call('progress',{})).json();
    if(status.job?.status!=='running')break;
  }
  assert.equal(status.job.status,'complete',JSON.stringify(status));assert.equal(status.job.processed,30);assert.equal(bodyReads,30);assert.equal(tokenRefreshes,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM email_items').first()).n,30);
});
