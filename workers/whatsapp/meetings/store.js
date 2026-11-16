import {MeetingError} from './recall.js';
export const SCHEMA=[
 `CREATE TABLE IF NOT EXISTS brivany_meetings(id TEXT PRIMARY KEY,owner TEXT NOT NULL,phone TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,source TEXT NOT NULL,event_key TEXT,selected INTEGER NOT NULL DEFAULT 1,join_at INTEGER,status TEXT NOT NULL,bot_id TEXT UNIQUE,bot_status TEXT,bot_status_at INTEGER NOT NULL DEFAULT 0,recording_id TEXT,transcript_id TEXT,transcript_state TEXT NOT NULL DEFAULT 'none',cancel_requested INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,calendar_next INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,error_code TEXT,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner,request_key))`,
 `CREATE INDEX IF NOT EXISTS brivany_meetings_owner ON brivany_meetings(owner,created_at DESC)`,
 `CREATE INDEX IF NOT EXISTS brivany_meetings_due ON brivany_meetings(next_at,status)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS brivany_meetings_event ON brivany_meetings(owner,event_key) WHERE source='calendar' AND selected=1`,
 `CREATE UNIQUE INDEX IF NOT EXISTS brivany_meetings_active ON brivany_meetings(owner,fingerprint) WHERE status NOT IN ('ready','failed','cancelled','ended')`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_inbox(id TEXT PRIMARY KEY,event TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',next_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS brivany_meeting_inbox_due ON brivany_meeting_inbox(status,next_at)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_outputs(meeting_id TEXT NOT NULL,part INTEGER NOT NULL,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,PRIMARY KEY(meeting_id,part))`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_voice(meeting_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'silent',turns INTEGER NOT NULL DEFAULT 0,error_code TEXT,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_voice_turns(meeting_id TEXT NOT NULL,turn_id TEXT NOT NULL,status TEXT NOT NULL,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(meeting_id,turn_id))`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_summaries(meeting_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',state_encrypted TEXT,state_iv TEXT,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_limits(meeting_id TEXT PRIMARY KEY,stop_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_boards(meeting_id TEXT PRIMARY KEY,state_encrypted TEXT NOT NULL,state_iv TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_checks(id TEXT PRIMARY KEY,status TEXT NOT NULL,details TEXT,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_meeting_media_state(meeting_id TEXT PRIMARY KEY,avatar_loaded INTEGER NOT NULL,audio_rate INTEGER NOT NULL,board_seen_at INTEGER,updated_at INTEGER NOT NULL)`,
];
export const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function meetingStore(env,{now=Date.now}={}){
 const db=env.VETSA_CLOUD;if(!db||!env.MEMORY_ENCRYPTION_KEY)throw new MeetingError('meeting_storage_unavailable',503);
 const q=(sql,...args)=>db.prepare(sql).bind(...args);let ready,keyPromise;
 const key=()=>keyPromise||=(async()=>{const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MEMORY_ENCRYPTION_KEY),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('brivany-meetings-v1'),info:new TextEncoder().encode('meeting-private-data')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);})();
 async function seal(context,value){const plain=new TextEncoder().encode(JSON.stringify(value));if(plain.length>65536)throw new MeetingError('meeting_data_too_large',413);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await key(),plain);return {state_encrypted:b64(new Uint8Array(encrypted)),state_iv:b64(iv)};}
 async function unseal(context,row){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.state_iv),additionalData:new TextEncoder().encode(context)},await key(),bytes(row.state_encrypted))));}
 async function update(id,values,lease){
  const allowed=new Set(['selected','join_at','status','bot_id','bot_status','bot_status_at','recording_id','transcript_id','transcript_state','cancel_requested','next_at','calendar_next','attempts','error_code','state_encrypted','state_iv','lease_until']);
  if(Object.keys(values).some(k=>!allowed.has(k)))throw Error('invalid_meeting_update');
  const keys=Object.keys(values);const result=await q(`UPDATE brivany_meetings SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE id=?${lease?' AND lease=?':''}`,...keys.map(k=>values[k]),now(),id,...(lease?[lease]:[])).run();
  if(lease&&!result.meta?.changes)throw new MeetingError('meeting_lease_lost',503);
 }
 return {q,seal,unseal,update,now,ensure:()=>ready||=db.batch(SCHEMA.map(sql=>db.prepare(sql))),
  get:(id,owner)=>q('SELECT * FROM brivany_meetings WHERE id=?'+(owner?' AND owner=?':''),id,...(owner?[owner]:[])).first(),
  async claim(id){const token=crypto.randomUUID();return await q('UPDATE brivany_meetings SET lease=?,lease_until=? WHERE id=? AND lease_until<=? RETURNING *',token,now()+60000,id,now()).first();},
  release:(id,lease)=>q('UPDATE brivany_meetings SET lease=NULL,lease_until=0 WHERE id=? AND lease=?',id,lease).run(),
  async saveOutput(row,segments){
   const chunks=[];let group=[],size=0;
   for(const segment of segments){const n=new TextEncoder().encode(JSON.stringify(segment)).length;if(size+n>32000&&group.length){chunks.push(group);group=[];size=0;}group.push(segment);size+=n;}
   if(group.length||!chunks.length)chunks.push(group);
   if(chunks.length>150)throw new MeetingError('transcript_too_large',413);
   // Completion is published only after every encrypted, idempotent page is durable.
   for(let part=0;part<chunks.length;part++){const v=await seal(row.owner+':output:'+row.id+':'+part,chunks[part]);await q('INSERT INTO brivany_meeting_outputs VALUES(?,?,?,?) ON CONFLICT(meeting_id,part) DO UPDATE SET state_encrypted=excluded.state_encrypted,state_iv=excluded.state_iv',row.id,part,v.state_encrypted,v.state_iv).run();}
   await q('DELETE FROM brivany_meeting_outputs WHERE meeting_id=? AND part>=?',row.id,chunks.length).run();
   return chunks.length;
  },
 };
}
