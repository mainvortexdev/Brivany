import {DatabaseSync} from 'node:sqlite';
import {MelodiPhone} from '../worker.js';
export const PHONE='18095550101';
export function fixture(){
  const db=new DatabaseSync(':memory:');
  const env={OWNER_WHATSAPP_NUMBER:PHONE,TELNYX_API_KEY:'synthetic',TELNYX_CONNECTION_ID:'synthetic-connection',TELNYX_FROM_NUMBER:'+18095550202',TELNYX_PUBLIC_KEY:'synthetic',BRIVANY_META_API_KEY:'synthetic',BRIVANY_META_MODEL:'synthetic-model',BRIVANY_CARTESIA_API_KEY:'synthetic',CALLS_ENCRYPTION_KEY:btoa('a'.repeat(32))};
  const storage={sql:{exec(sql,...params){const statement=db.prepare(sql),rows=statement.all(...params);return {toArray:()=>rows};}},alarmAt:null,async getAlarm(){return this.alarmAt;},async setAlarm(at){this.alarmAt=at;},async deleteAlarm(){this.alarmAt=null;}};
  const ctx={storage,blockConcurrencyWhile:fn=>fn(),waitUntil:p=>p.catch(()=>{})},phone=new MelodiPhone(ctx,env);
  const request=(extra={})=>({id:crypto.randomUUID(),phone:PHONE,requestHash:'a'.repeat(64),dueAt:Date.now()+1000,timeZone:'America/La_Paz',objective:'SYNTHETIC_PRIVATE_OBJECTIVE',...extra});
  return {db,env,ctx,storage,phone,request};
}
