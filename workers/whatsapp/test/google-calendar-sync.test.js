import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { syncGoogleCalendar, calendarEventContent } from '../google-calendar-sync.js';
import { createGoogleCalendarStore, calendarHash } from '../google-calendar-store.js';
import { toGoogleCalendarEvent } from '../google-calendar-client.js';

const OWNER='18495205246';
const NOW=Date.parse('2026-10-08T12:00:00.000Z');
const clone=value=>structuredClone(value);
const contentHash=value=>calendarHash(JSON.stringify(calendarEventContent(value)));
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');}
  prepare(query){const db=this;const make=values=>({query,values,bind:(...next)=>make(next),
    async run(){return db.execute(query,values);},async all(){return db.execute(query,values);},async first(){return db.execute(query,values).results[0] || null;}});return make([]);}
  execute(query,values){const prepared=this.sql.prepare(query);return prepared.columns().length
    ? {results:prepared.all(...values),meta:{changes:0}} : {results:[],meta:{changes:Number(prepared.run(...values).changes)}};}
  async batch(statements){this.sql.exec('BEGIN');try{const rows=statements.map(row=>this.execute(row.query,row.values));this.sql.exec('COMMIT');return rows;}
    catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
const fail=code=>Object.assign(new Error(code),{code});
async function fixture({mapped=true}={}){
  const db=new D1();let clock=NOW;
  const env={OWNER_WHATSAPP_NUMBER:OWNER,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
    MEMORY_ENCRYPTION_KEY:'calendar-sync-tests-only-random-key-32',VETSA_CLOUD:db};
  const store=createGoogleCalendarStore(env,{now:()=>clock});await store.ensureSchema();
  await store.putConnection(OWNER,{status:'connected',calendarId:'private-team-calendar',syncToken:'old-token'});
  const activities=[{kind:'reminder',id:'local-1',agent:'melodi',title:'Crear planos 3D',startAt:'2026-10-16T13:00:00.000Z',status:'active',sourceVersion:'v1'}];
  const original={...await toGoogleCalendarEvent({owner:OWNER,...activities[0]}),etag:'"e1"'};
  const remoteEvents=new Map([[original.id,clone(original)]]),calls=[],applied=[];
  if(mapped)await store.putMapping(OWNER,{kind:'reminder',id:'local-1',agent:'melodi',googleEventId:original.id,etag:original.etag,
    localHash:await contentHash(original),remoteHash:await contentHash(original),sourceVersion:'v1'});
  let pages=()=>({items:[],nextSyncToken:'new-token'});
  let applyHook=null,insertHook=null,getHook=null,updateHook=null,noticeHook=null;
  const client={
    async listEvents(calendarId,options){calls.push({method:'list',calendarId,options});return pages(options);},
    async getEvent(calendarId,id){calls.push({method:'get',id});if(getHook)return getHook(id);const value=remoteEvents.get(id);if(!value)throw fail('not_found');return clone(value);},
    async insertEvent(calendarId,event){calls.push({method:'insert',event:clone(event)});if(insertHook)return insertHook(event);
      if(remoteEvents.has(event.id))throw fail('already_exists');const value={...clone(event),etag:'"inserted"'};remoteEvents.set(event.id,value);return clone(value);},
    async updateEvent(calendarId,id,event,{etag}){calls.push({method:'update',id,etag});if(updateHook)return updateHook(id,event,etag);
      const value={...clone(event),etag:'"updated"'};remoteEvents.set(id,value);return clone(value);},
    async deleteEvent(calendarId,id,{etag}){calls.push({method:'delete',id,etag});remoteEvents.set(id,{id,status:'cancelled'});return null;},
  };
  const options={store,client,now:()=>clock,listScheduledActivities:async()=>clone(activities),notifyUnsupported:async value=>noticeHook && noticeHook(value),
    applyCalendarChange:async(_env,owner,mapping,change,input)=>{
      assert.equal(owner,OWNER);applied.push({mapping:clone(mapping),change:clone(change),input:clone(input)});
      if(applyHook)return applyHook({mapping,change,input});
      const item=activities.find(item=>item.kind===mapping.kind && item.id===mapping.id);
      if(!item)return {applied:false,missing:true};
      if(input.expectedVersion!==item.sourceVersion)return {applied:false,conflict:true};
      if(change.recurringEventId)return {applied:true,occurrence:true,sourceVersion:item.sourceVersion};
      Object.assign(item,{title:change.title || item.title,startAt:change.startAt || item.startAt,
        endAt:change.endAt,recurrence:change.recurrence || [],status:change.status==='cancelled'?'cancelled':'active',sourceVersion:`${item.sourceVersion}:remote`});
      return {applied:true,sourceVersion:item.sourceVersion};
    }};
  return {env,store,db,activities,original,remoteEvents,calls,applied,run:()=>syncGoogleCalendar(env,options),
    setPages:value=>{pages=value;},setApply:value=>{applyHook=value;},setInsert:value=>{insertHook=value;},setGet:value=>{getHook=value;},setUpdate:value=>{updateHook=value;},setNotice:value=>{noticeHook=value;},advance:ms=>{clock+=ms;}};
}

test('equivalent UTC/offset representations and Google timezone omission have the same content hash',async()=>{
  const h=await fixture();const event=clone(h.original);
  event.start={dateTime:'2026-10-16T09:00:00-04:00'};event.end={dateTime:'2026-10-16T09:15:00-04:00'};
  assert.equal(await contentHash(event),await contentHash(h.original));
  h.setPages(()=>({items:[event],nextSyncToken:'new-token'}));
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.applied.length,0);assert.equal(h.calls.filter(call=>['update','insert'].includes(call.method)).length,0);
});

test('Google edits apply against the current local revision before any publication',async()=>{
  const h=await fixture();h.activities[0].sourceVersion='locally-edited-v2';
  const remote={...clone(h.original),summary:'Melodi: Probar exportación 3D',etag:'"remote2"'};
  h.setPages(()=>({items:[remote],nextSyncToken:'new-token'}));
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.applied[0].input.expectedVersion,'locally-edited-v2');
  assert.equal(h.activities[0].title,'Probar exportación 3D');
  assert.equal(h.calls.filter(call=>call.method==='update').length,0);
});

test('a conflicting remote edit does not consume its cursor or push the stale local state',async()=>{
  const h=await fixture();h.setApply(()=>({applied:false,conflict:true}));
  h.setPages(()=>({items:[{...clone(h.original),summary:'Melodi: Editada',etag:'"remote2"'}],nextSyncToken:'lost-if-consumed'}));
  assert.equal((await h.run()).status,'retrying');
  assert.equal((await h.store.getConnection(OWNER)).syncToken,'old-token');
  assert.equal(h.calls.some(call=>call.method==='update'),false);
});

test('page continuations are durable and publication waits until all Google pages are read',async()=>{
  const h=await fixture();h.activities[0].title='Pending local edit';
  h.setPages(options=>options.pageToken==='third' ? {items:[],nextSyncToken:'finished'}
    : {items:[],nextPageToken:options.pageToken ? 'third':'second'});
  assert.equal((await h.run()).status,'continuing');
  assert.equal((await h.store.getConnection(OWNER)).pageToken,'third');
  assert.equal(h.calls.some(call=>call.method==='update'),false);
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.calls.filter(call=>call.method==='update').length,1);
});

test('a failure on the second Google page retains its cursor and blocks local publication',async()=>{
  const h=await fixture();h.activities[0].title='Pending local edit';
  h.setPages(options=>{if(options.pageToken)throw fail('temporarily_unavailable');return {items:[],nextPageToken:'second'};});
  assert.equal((await h.run()).status,'retrying');
  assert.equal((await h.store.getConnection(OWNER)).pageToken,'second');
  assert.equal(h.calls.some(call=>call.method==='update'),false);
});

test('expired sync tokens trigger a full scan and missing mapped tombstones are recovered by ID',async()=>{
  const h=await fixture();h.remoteEvents.delete(h.original.id);
  h.setPages(options=>{if(options.syncToken)throw fail('sync_token_expired');return {items:[],nextSyncToken:'reset-token'};});
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.activities[0].status,'cancelled');
  assert.equal((await h.store.listMappings(OWNER))[0].status,'cancelled');
  assert.equal((await h.store.getConnection(OWNER)).fullScanSeen,undefined);
  assert.equal(h.calls.some(call=>call.method==='insert'||call.method==='update'),false);
});

test('a lost insert receipt followed by a Google edit recovers the mapping without overwriting or duplicating it',async()=>{
  const h=await fixture({mapped:false});h.remoteEvents.clear();
  h.setInsert(event=>{h.remoteEvents.set(event.id,{...clone(event),etag:'"inserted"'});throw fail('network_error');});
  assert.equal((await h.run()).status,'retrying');assert.deepEqual(await h.store.listMappings(OWNER),[]);
  const remote=h.remoteEvents.get(h.original.id);remote.summary='Melodi: Edited in Google';remote.etag='"edited"';
  h.setInsert(()=>{throw fail('already_exists');});
  h.setPages(()=>({items:[clone(remote)],nextSyncToken:'after-lost-insert'}));
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.activities[0].title,'Edited in Google');assert.equal(h.remoteEvents.size,1);
  assert.equal((await h.store.listMappings(OWNER)).length,1);assert.equal(h.calls.some(call=>call.method==='update'),false);
});

test('a deletion after a lost insert receipt is adopted as cancellation and is never resurrected',async()=>{
  const h=await fixture({mapped:false});h.remoteEvents.set(h.original.id,{id:h.original.id,status:'cancelled'});
  assert.equal((await h.run()).status,'synced');assert.equal(h.activities[0].status,'cancelled');
  assert.equal((await h.store.listMappings(OWNER))[0].status,'cancelled');
  const inserts=h.calls.filter(call=>call.method==='insert').length;
  assert.equal((await h.run()).status,'synced');assert.equal(h.calls.filter(call=>call.method==='insert').length,inserts);
});

test('recurring-instance changes keep the series receipt untouched and retain their instance identity',async()=>{
  const h=await fixture();const before=clone((await h.store.listMappings(OWNER))[0]);
  h.setPages(()=>({items:[{id:'instance1',recurringEventId:h.original.id,status:'cancelled',originalStartTime:{dateTime:'2026-10-16T09:00:00-04:00'}}],nextSyncToken:'instances'}));
  assert.equal((await h.run()).status,'synced');
  assert.equal(h.applied[0].change.recurringEventId,h.original.id);assert.equal(h.applied[0].mapping.googleEventId,'instance1');
  assert.deepEqual(clone((await h.store.listMappings(OWNER))[0]),before);
});

test('busy synchronization blocks due work while a disconnected calendar has its own status',async()=>{
  const h=await fixture();const lease=await h.store.acquireLease(OWNER);
  assert.equal((await h.run()).status,'busy');assert.deepEqual(h.calls,[]);
  await h.store.releaseLease(OWNER,lease);await h.store.disconnect(OWNER);
  assert.equal((await h.run()).status,'disconnected');assert.deepEqual(h.calls,[]);
});

test('disconnect during an external insert cannot recreate deleted mappings with a stale lease',async()=>{
  const h=await fixture({mapped:false});h.remoteEvents.clear();
  h.setInsert(async event=>{await h.store.disconnect(OWNER);return {...clone(event),etag:'"late"'};});
  assert.equal((await h.run()).status,'retrying');assert.equal(await h.store.getConnection(OWNER),null);
  assert.deepEqual(await h.store.listMappings(OWNER),[]);
});

test('lost or expired lease claims fail closed before persisting synchronization receipts',async()=>{
  const h=await fixture();const lease=await h.store.acquireLease(OWNER);
  await h.store.assertLease(OWNER,lease);
  const before=(await h.store.listMappings(OWNER))[0];h.advance(55000);
  await assert.rejects(h.store.assertLease(OWNER,lease),/lease_lost/);
  await assert.rejects(h.store.putMapping(OWNER,{kind:'reminder',id:'local-1',agent:'melodi',googleEventId:h.original.id,
    etag:'"invalid-late"',sourceVersion:'late'},{leaseToken:lease}),/mapping_conflict/);
  assert.deepEqual(clone((await h.store.listMappings(OWNER))[0]),clone(before));
});

test('a conditional Google write conflict remains retrying and never reports a fresh synchronized calendar',async()=>{
  const h=await fixture();h.activities[0].title='Pending local edit';h.setUpdate(()=>{throw fail('conflict');});
  assert.equal((await h.run()).status,'retrying');
  assert.equal((await h.store.listMappings(OWNER))[0].google_etag,'"e1"');
});

test('unsupported multiday changes are quarantined and never overwritten or consumed as valid schedules',async()=>{
  const h=await fixture();h.setPages(()=>({items:[{...clone(h.original),start:{date:'2026-10-16'},end:{date:'2026-10-18'}}],nextSyncToken:'all-day'}));
  const result=await h.run();assert.equal(result.status,'synced');assert.equal(result.quarantined,1);assert.equal((await h.store.getConnection(OWNER)).syncToken,'all-day');
  assert.equal(h.applied.length,0);assert.equal(h.calls.some(call=>call.method==='update'),false);
});

test('unsupported recurrence keeps its receipt, delivers one factual notice key and recovers after a valid edit',async()=>{
  const h=await fixture();const notices=new Map();h.setNotice(value=>notices.set(value.key,value));
  let valid=false;h.setApply(({change})=>valid ? (Object.assign(h.activities[0],{title:change.title,sourceVersion:'valid-revision'}),{applied:true,sourceVersion:'valid-revision'})
    : {applied:false,reason:'unsupported_recurrence'});
  let remote={...clone(h.original),recurrence:['RRULE:FREQ=MONTHLY'],etag:'"unsupported"'};
  h.setPages(()=>({items:[clone(remote)],nextSyncToken:'unsupported-token'}));
  assert.equal((await h.run()).quarantined,1);assert.equal((await h.run()).quarantined,1);
  assert.equal(notices.size,1);const notice=[...notices.values()][0];assert.equal(notice.owner,OWNER);assert.equal(notice.agent,'melodi');
  assert.match(notice.body,/esa frecuencia no está disponible/);assert.equal((await h.store.listMappings(OWNER))[0].google_etag,'"unsupported"');
  assert.equal(h.calls.some(call=>call.method==='update'),false);
  valid=true;remote={...clone(h.original),summary:'Melodi: Tarea corregida',etag:'"valid"'};
  assert.equal((await h.run()).status,'synced');assert.equal((await h.store.listMappings(OWNER))[0].status,'active');
});

test('unsupported recurring-instance edits never overwrite the parent series receipt',async()=>{
  const h=await fixture();const before=clone((await h.store.listMappings(OWNER))[0]);h.setApply(()=>({applied:false,reason:'unsupported_recurrence_instance'}));
  h.setPages(()=>({items:[{...clone(h.original),id:'instance1',recurringEventId:h.original.id,
    originalStartTime:h.original.start,etag:'"instance"'}],nextSyncToken:'instance-token'}));
  assert.equal((await h.run()).status,'synced');assert.deepEqual(clone((await h.store.listMappings(OWNER))[0]),{...before,status:'unsupported'});
  assert.equal((await h.store.getConnection(OWNER)).syncToken,'instance-token');
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_google_calendar_ignored_changes').get().n,1);
  const applied=h.applied.length;assert.equal((await h.run()).status,'synced');assert.equal(h.applied.length,applied);
});

test('editing a historical completed activity never resurrects it or freezes unrelated schedules',async()=>{
  const h=await fixture();const notices=new Map();h.setNotice(value=>notices.set(value.key,value));h.setApply(()=>({applied:false,reason:'source_completed'}));
  h.setPages(()=>({items:[{...clone(h.original),summary:'Melodi: Old completed event edited',etag:'"history-edit"'}],nextSyncToken:'historical-edit'}));
  assert.equal((await h.run()).status,'synced');assert.equal((await h.store.listMappings(OWNER))[0].status,'completed');
  assert.equal(notices.size,1);assert.match([...notices.values()][0].body,/ya terminada.*No la reactivé/);
  h.activities[0].title='Do not resurrect';
  assert.equal((await h.run()).status,'synced');assert.equal(h.calls.some(call=>call.method==='update'||call.method==='insert'),false);
});
