import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGoogleCalendarStore, calendarHash } from '../google-calendar-store.js';

class D1 {
  constructor() { this.sql=new DatabaseSync(':memory:'); }
  prepare(query) { const db=this; const make=values=>({query,values,bind:(...next)=>make(next),
    async run(){return db.execute(query,values);},async all(){return db.execute(query,values);},async first(){return db.execute(query,values).results[0] || null;}}); return make([]); }
  execute(query,values) { const s=this.sql.prepare(query); return s.columns().length
    ? {results:s.all(...values),meta:{changes:Number(this.sql.prepare('SELECT changes() AS n').get().n)}}
    : {results:[],meta:{changes:Number(s.run(...values).changes)}}; }
  async batch(statements) { this.sql.exec('BEGIN'); try { const result=statements.map(s=>this.execute(s.query,s.values)); this.sql.exec('COMMIT'); return result; }
    catch(error){this.sql.exec('ROLLBACK');throw error;} }
}
async function harness() { const db=new D1(); let now=Date.parse('2026-10-08T13:00:00Z');
  const env={VETSA_CLOUD:db,MEMORY_ENCRYPTION_KEY:'test-key-with-enough-random-looking-bytes-32'};
  const store=createGoogleCalendarStore(env,{now:()=>now}); await store.ensureSchema();
  return {db,env,store,get now(){return now;},advance(ms){now+=ms;}}; }
const connection={status:'connected',email:'owner@example.com',subject:'owner-sub',refreshToken:'private-refresh-token',
  accessToken:'private-access-token',accessTokenExpiresAt:Date.parse('2026-10-08T14:00:00Z'),calendarId:'private-calendar-id'};
const map={kind:'routine',id:'routine-1',agent:'melodi',googleEventId:'google-event-1',etag:'"etag1"',localHash:'h1',remoteHash:'h2'};

test('connections encrypt credentials and bind ciphertext to its owner and state context',async()=>{
  const h=await harness(); await h.store.putConnection('owner-a',connection);
  const row=h.db.sql.prepare('SELECT * FROM google_calendar_connections WHERE owner=?').get('owner-a');
  for(const secret of ['private-refresh-token','private-access-token','owner@example.com','private-calendar-id']) assert.equal(JSON.stringify(row).includes(secret),false);
  assert.equal((await h.store.getConnection('owner-a')).refreshToken,connection.refreshToken);
  assert.equal(await h.store.getConnection('owner-b'),null);
  h.db.sql.prepare('INSERT INTO google_calendar_connections(owner,state_encrypted,state_iv,status,updated_at) VALUES(?,?,?,?,?)').run('owner-b',row.state_encrypted,row.state_iv,'connected',h.now);
  await assert.rejects(h.store.getConnection('owner-b'));
});

test('nonce previews do not consume and encrypted nonce payload cannot override the persisted owner',async()=>{
  const h=await harness(); const token=await h.store.createNonce('owner-a','link',{agent:'melodi',owner:'owner-b'},h.now+60000);
  const row=h.db.sql.prepare('SELECT * FROM google_calendar_oauth').get();
  assert.equal(row.token_hash,await calendarHash(token));
  assert.equal(JSON.stringify(row).includes(token),false);
  assert.equal((await h.store.peekNonce(token,'link')).owner,'owner-a');
  assert.equal((await h.store.peekNonce(token,'link')).agent,'melodi');
  assert.equal(h.db.sql.prepare('SELECT consumed_at FROM google_calendar_oauth').get().consumed_at,null);
  assert.equal((await h.store.consumeNonce(token,'link')).owner,'owner-a');
  assert.equal(await h.store.consumeNonce(token,'link'),null);
});

test('concurrent nonce claims have exactly one winner and cookie mismatch never burns a consent',async()=>{
  const h=await harness(); const token=await h.store.createNonce('owner-a','consent',{browserHash:'browser-correct',verifier:'private-pkce'},h.now+60000);
  assert.equal(await h.store.consumeNonce(token,'consent',{owner:'owner-b',browserHash:'browser-correct'}),null);
  assert.equal(await h.store.consumeNonce(token,'consent',{owner:'owner-a',browserHash:'browser-wrong'}),null);
  const results=await Promise.all([h.store.consumeNonce(token,'consent',{owner:'owner-a',browserHash:'browser-correct'}),
    h.store.consumeNonce(token,'consent',{owner:'owner-a',browserHash:'browser-correct'})]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(results.find(Boolean).verifier,'private-pkce');
});

test('nonce expiration and type are enforced and ciphertext cannot be copied to another nonce',async()=>{
  const h=await harness(); const first=await h.store.createNonce('owner-a','link',{agent:'melodi'},h.now+1000);
  const second=await h.store.createNonce('owner-a','link',{agent:'melodi'},h.now+60000);
  assert.equal(await h.store.peekNonce(first,'consent'),null);
  const row=h.db.sql.prepare('SELECT * FROM google_calendar_oauth WHERE token_hash=?').get(await calendarHash(first));
  h.db.sql.prepare('UPDATE google_calendar_oauth SET state_encrypted=?,state_iv=? WHERE token_hash=?').run(row.state_encrypted,row.state_iv,await calendarHash(second));
  await assert.rejects(h.store.peekNonce(second,'link'));
  h.advance(1000); assert.equal(await h.store.consumeNonce(first,'link'),null);
  await assert.rejects(h.store.createNonce('owner-a','link',{},h.now));
  await assert.rejects(h.store.createNonce('owner-a','unexpected-kind',{},h.now+60000));
});

test('connection writes without a lease cannot interrupt an active synchronization',async()=>{
  const h=await harness(); await h.store.putConnection('owner-a',connection);
  const attempts=await Promise.all([h.store.acquireLease('owner-a'),h.store.acquireLease('owner-a')]);
  const token=attempts.find(Boolean); assert.equal(attempts.filter(Boolean).length,1);
  await assert.rejects(h.store.putConnection('owner-a',{...connection,accessToken:'unleased'}),/connection_busy/);
  await assert.rejects(h.store.putConnection('owner-a',connection,{leaseToken:'wrong'}),/lease_lost/);
  await h.store.releaseLease('owner-a','wrong'); assert.equal(await h.store.acquireLease('owner-a'),null);
  const before=(await h.store.getConnection('owner-a')).version;
  await h.store.putConnection('owner-a',{...connection,accessToken:'renewed'},{leaseToken:token});
  assert.ok((await h.store.getConnection('owner-a')).version>before);
  await h.store.releaseLease('owner-a',token); assert.ok(await h.store.acquireLease('owner-a'));
});

test('expired leases cannot persist refresh results and old release does not unlock a new claimant',async()=>{
  const h=await harness(); await h.store.putConnection('owner-a',connection); const first=await h.store.acquireLease('owner-a');
  h.advance(55000); const second=await h.store.acquireLease('owner-a'); assert.ok(second); assert.notEqual(second,first);
  await assert.rejects(h.store.putConnection('owner-a',connection,{leaseToken:first}),/lease_lost/);
  await h.store.releaseLease('owner-a',first); assert.equal(await h.store.acquireLease('owner-a'),null);
});

test('mapping identity and assigned agent cannot be overwritten by a sync update',async()=>{
  const h=await harness(); await h.store.putMapping('owner-a',map);
  await h.store.putMapping('owner-a',{...map,etag:'"etag2"',localHash:'changed'});
  assert.equal((await h.store.listMappings('owner-a'))[0].google_etag,'"etag2"');
  await assert.rejects(h.store.putMapping('owner-a',{...map,agent:'retired-agent'}),/invalid_calendar_agent/);
  await assert.rejects(h.store.putMapping('owner-a',{...map,googleEventId:'other-event'}),/mapping_conflict/);
  const row=(await h.store.listMappings('owner-a'))[0]; assert.equal(row.agent,'melodi'); assert.equal(row.google_event_id,'google-event-1');
  await h.store.putMapping('owner-b',{...map,agent:'melodi'});
  assert.equal((await h.store.listMappings('owner-b'))[0].agent,'melodi');
});

test('disconnect invalidates OAuth states, mappings and in-flight refresh writes atomically',async()=>{
  const h=await harness(); await h.store.putConnection('owner-a',connection); await h.store.putMapping('owner-a',map);
  const consent=await h.store.createNonce('owner-a','consent',{browserHash:'hash'},h.now+60000);
  await h.store.consumeNonce(consent,'consent'); const lease=await h.store.acquireLease('owner-a');
  assert.equal((await h.store.disconnect('owner-a')).refreshToken,'private-refresh-token');
  assert.equal(await h.store.getConnection('owner-a'),null); assert.equal(await h.store.peekNonce(consent,'consent'),null);
  assert.deepEqual(await h.store.listMappings('owner-a'),[]);
  await assert.rejects(h.store.putConnection('owner-a',connection,{leaseToken:lease}),/lease_lost/);
  await assert.rejects(h.store.putConnection('owner-a',connection,{consentToken:consent}),/connection_busy/);
  assert.equal(await h.store.getConnection('owner-a'),null);
});
