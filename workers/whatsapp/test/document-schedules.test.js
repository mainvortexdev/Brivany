import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { registerDocumentSchedule, documentDeliveryState, completeDocumentSchedule } from '../document-schedules.js';
import { listScheduledActivities } from '../google-calendar-schedules.js';
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');this.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));}
  prepare(query){ const make=values=>({bind:(...v)=>make(v),run:async()=>({meta:{changes:Number(this.sql.prepare(query).run(...values).changes)}}),all:async()=>({results:this.sql.prepare(query).all(...values).map(r=>({...r}))}),first:async()=>this.sql.prepare(query).get(...values)||null});return make([]); }
  async batch(statements){this.sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());this.sql.exec('COMMIT');return out;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
const owner='18095551234';
function fixture(){const db=new D1();return{db,env:{OWNER_WHATSAPP_NUMBER:owner,VETSA_CLOUD:db}};}
test('document delivery is blocked until its RD date, follows retiming, and completes only after confirmed sending',async()=>{
 const {db,env}=fixture(),dueAt=new Date(Date.now()+86400000).toISOString();
 const id=await registerDocumentSchedule(env,{owner,agent:'melodi',jobId:'job-doc',dueAt,title:'Alexa AI de Electro Wisly'});
 assert.equal((await documentDeliveryState(env,owner,'job-doc')).status,'waiting');
 const delayed=new Date(Date.now()+2*86400000).toISOString();db.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run(delayed,id);
 assert.equal((await documentDeliveryState(env,owner,'job-doc',Date.parse(dueAt))).status,'waiting');
 assert.equal((await documentDeliveryState(env,owner,'job-doc',Date.parse(delayed))).status,'ready');
 db.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),id);
 await completeDocumentSchedule(env,owner,'job-doc');assert.ok(db.sql.prepare('SELECT reminded_at FROM melodi_calendar_events WHERE id=?').get(id).reminded_at);
 assert.equal((await documentDeliveryState(env,owner,'job-doc')).active,false);
});
test('deleting a document calendar delivery cancels it and duplicate requests cannot recreate it',async()=>{
 const {db,env}=fixture(),args={owner,agent:'melodi',jobId:'job-doc',dueAt:new Date(Date.now()+86400000).toISOString(),title:'Documento'};
 const id=await registerDocumentSchedule(env,args);db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(id);
 assert.equal((await documentDeliveryState(env,owner,'job-doc')).active,false);await registerDocumentSchedule(env,args);
 assert.equal(db.sql.prepare('SELECT count(*) n FROM melodi_calendar_events').get().n,0);
 await assert.rejects(registerDocumentSchedule(env,{...args,agent:'retired-agent'}));
 await assert.rejects(registerDocumentSchedule(env,{...args,owner:'different'}),/owner/);
});
test('missing schedule records fail closed for a deferred job while immediate documents remain ready',async()=>{
 const {env}=fixture();assert.equal((await documentDeliveryState(env,owner,'immediate')).status,'ready');
 await assert.rejects(documentDeliveryState(env,owner,'scheduled',Date.now(),true),/missing/);
});
test('Google Calendar sees the document delivery as an independently editable activity with its original responsible agent',async()=>{
 const {env}=fixture(),dueAt=new Date(Date.now()+86400000).toISOString();await registerDocumentSchedule(env,{owner,agent:'melodi',jobId:'doc-calendar',dueAt,title:'Alexa AI de Electro Wisly'});
 const activities=await listScheduledActivities(env,owner,{services:{encrypt:async()=>({encrypted:'x',iv:'y'}),decrypt:async()=>({})}});
 const activity=activities.find(a=>a.id==='document-doc-calendar');assert.equal(activity.agent,'melodi');assert.equal(activity.startAt,dueAt);assert.match(activity.title,/Electro Wisly/);
});
