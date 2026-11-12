import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {retireEmailAccounts,clearRetiredScanStorage} from '../src/email-retirement.js';
const key=Buffer.alloc(32,9).toString('base64');
async function environment(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  for(const n of ['0001_email_capture','0002_manual_email_scans','0003_receipt_parser_versions','0004_background_email_jobs']) db.exec(readFileSync(new URL(`../migrations/${n}.sql`,import.meta.url),'utf8'));
  const prepare=sql=>{let args=[];return {bind(...v){args=v;return this;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args);}}};
  const cleared=[];
  const env={EMAIL_DB:{prepare},EMAIL_TOKEN_KEY:key,EMAIL_RETIREMENT_KEY:'admin-key',EMAIL_CAPTURE_ENABLED:'true',EMAIL_SCAN_JOBS:{idFromName:x=>x,get:id=>({fetch:async()=>{cleared.push(id);return Response.json({deleted:true});}})}};
  for(const id of ['a','b']) {
    const owner=`google:${id}`,iv=crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey=await crypto.subtle.importKey('raw',Buffer.from(key,'base64'),'AES-GCM',false,['encrypt']);
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`${owner}:${id}`)},cryptoKey,new TextEncoder().encode(JSON.stringify(`refresh-${id}`)));
    const token=`${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
    db.prepare('INSERT INTO email_accounts(id,owner,mailbox_sub,email,refresh_token,timezone,hour,minute,currency,next_scan,scan_start,job_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,id,`${id}@example.test`,token,'UTC',0,0,'USD',1,1,'job:0');
    db.prepare('INSERT INTO email_items VALUES(?,?,?,?,?,?,?,?)').run(id,owner,id,id,'encrypted-evidence','pending',0,0);
  }
  return {env,db,cleared};
}
function mock(t,fn) {const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>globalThis.fetch=old);}
test('all public scan/connect/approve/callback routes are retired even when old enable flag is true',async t=>{
  mock(t,()=>{throw Error('No network allowed');});
  for(const path of ['connect','scan/start','scan/progress','scan/pause','scan','approve','schedule','oauth/callback','status']) {
    const r=await worker.fetch(new Request(`https://worker.test/email/${path}`,{method:'POST'}),{EMAIL_CAPTURE_ENABLED:'true'});
    assert.equal(r.status,410);assert.equal((await r.json()).retired,true);
  }
  const health=await worker.fetch(new Request('https://worker.test/'));assert.equal((await health.json()).emailCapture,false);
  await worker.scheduled();
});
test('cleanup requires the dedicated admin credential before database or network access',async()=>{
  const r=await worker.fetch(new Request('https://worker.test/email/retirement/cleanup',{method:'POST',headers:{Authorization:'Bearer ordinary-user'}}),{EMAIL_RETIREMENT_KEY:'admin'});
  assert.equal(r.status,403);
});
test('successful retirement revokes refresh tokens, clears DO caches and deletes accounts and evidence',async t=>{
  const {env,db,cleared}=await environment(t);let revocations=0;
  mock(t,async(url,init)=>{assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.match(init.body.get('token'),/^refresh-/);revocations++;return new Response('');});
  assert.deepEqual(await retireEmailAccounts(env),{removed:2,failed:0,remaining:0});
  assert.equal(revocations,2);assert.equal(cleared.length,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM email_items').get().n,0);
  assert.deepEqual(await retireEmailAccounts(env),{removed:0,failed:0,remaining:0});
});
test('provider failure preserves a disabled token for retry but purges receipt evidence and job state',async t=>{
  const {env,db}=await environment(t);mock(t,async()=>new Response('',{status:503}));
  assert.deepEqual(await retireEmailAccounts(env),{removed:0,failed:2,remaining:2});
  for(const row of db.prepare('SELECT * FROM email_accounts').all()) {assert.equal(row.enabled,0);assert.equal(row.job_id,null);assert.equal(row.scan_start,null);assert.equal(row.next_scan,0);}
  assert.equal(db.prepare('SELECT count(*) AS n FROM email_items').get().n,0);
});
test('already revoked grants can be purged and user removal is restricted to their own account',async t=>{
  const {env,db,cleared}=await environment(t);
  mock(t,async(url)=>url.includes('userinfo')?Response.json({sub:'a',email_verified:true}):Response.json({error:'invalid_token'},{status:400}));
  const r=await worker.fetch(new Request('https://worker.test/email/disconnect',{method:'POST',headers:{Authorization:'Bearer user'}}),env);
  assert.equal((await r.json()).revoked,true);
  assert.deepEqual(cleared,['google:a:a']);assert.equal(db.prepare('SELECT count(*) AS n FROM email_accounts').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM email_items').get().n,1);
});
test('retired DO cleanup clears alarms and all stored secrets without rescheduling',async()=>{
  const calls=[];await clearRetiredScanStorage({deleteAlarm:async()=>calls.push('alarm'),deleteAll:async()=>calls.push('all')});assert.deepEqual(calls,['alarm','all']);
});
