import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createFinanceStore } from '../personal-finance.js';
import { createRoutineStore } from '../melodi-routines.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { GOOGLE_CALENDAR_SCHEDULE_SCHEMA } from '../google-calendar-schedules.js';
export const OWNER='18095550101',OTHER='18095559999',NOW=Date.parse('2026-10-09T01:46:00Z');
export class FinanceD1 {
  constructor(){this.sql=new DatabaseSync(':memory:');}
  prepare(query){const db=this,make=values=>({query,values,bind:(...next)=>make(next),async all(){return db.execute(query,values);},async run(){return db.execute(query,values);},async first(){return db.execute(query,values).results[0] || null;}});return make([]);}
  execute(query,values){const stmt=this.sql.prepare(query);return stmt.columns().length ? {results:stmt.all(...values).map(v=>({...v})),meta:{changes:Number(this.sql.prepare('SELECT changes() AS n').get().n)}}:{results:[],meta:{changes:Number(stmt.run(...values).changes)}};}
  async batch(items){this.sql.exec('BEGIN');try{const results=items.map(v=>this.execute(v.query,v.values));this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
export async function financeFixture(){
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  db.sql.exec(readFileSync(new URL('../melodi-team-coordination.sql',import.meta.url),'utf8'));
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const services={async encrypt(value){const iv=crypto.getRandomValues(new Uint8Array(12));return {encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value))).toString('base64'),iv:Buffer.from(iv).toString('base64')};},async decrypt(value,iv){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(value,'base64')));}};
  const store=createFinanceStore(db,{...services,now:()=>NOW}),routines=createRoutineStore(db,{...services,now:()=>NOW});
  await store.ensureSchema();await routines.ensureSchema();db.sql.exec([...GOOGLE_CALENDAR_SCHEMA,...GOOGLE_CALENDAR_SCHEDULE_SCHEMA].join(';'));
  return {db,services,store,routines,env:{VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER},options:{services,now:()=>NOW}};
}
