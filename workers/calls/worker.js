import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {configuration,owner,UUID,TERMINAL,LIMITS,seal,unseal,sha,same,bytes64,from64,boundedText,telnyx,verifyWebhook} from './protocol.js';
import {PhoneVoice} from './voice.js';
import {phoneComputer} from './computer.js';
import {probeVoice,probeDesktop,probeModel} from './probe.js';

export const callView=row=>({id:row.id,state:row.state,dueAt:row.due_at,startedAt:row.started_at||null,answeredAt:row.answered_at||null,timeZone:row.time_zone,transport:'cloud',channel:'telephone',reason:row.reason||null,...(row.metrics?{metrics:JSON.parse(row.metrics)}:{})});
const view=callView;
export class MelodiPhone extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.voices=new Map();
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,request_hash TEXT UNIQUE NOT NULL,phone TEXT NOT NULL,due_at INTEGER NOT NULL,time_zone TEXT NOT NULL,encrypted TEXT NOT NULL,iv TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,started_at INTEGER,answered_at INTEGER,control_id TEXT UNIQUE,token_hash TEXT,media_used INTEGER NOT NULL DEFAULT 0,reason TEXT,terminal_state TEXT,hangup_attempts INTEGER NOT NULL DEFAULT 0,notice_state TEXT NOT NULL DEFAULT 'pending')`);
      ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS due_calls ON calls(state,due_at)`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL)`);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,metrics TEXT NOT NULL)`);
    });
  }
  rows(sql,...args){return this.ctx.storage.sql.exec(sql,...args).toArray();}
  row(sql,...args){return this.rows(sql,...args)[0];}
  async schedule(value){
    owner(this.env,value?.phone);
    const now=Date.now();
    if(!configuration(this.env).configured)throw Error('cloud_calls_unconfigured');
    if(!value||!UUID.test(value.id)||!/^[a-f0-9]{64}$/.test(value.requestHash)||!Number.isSafeInteger(value.dueAt)||value.dueAt<now-1000||value.dueAt>now+30*86400000||typeof value.objective!=='string'||!value.objective.trim()||value.objective.length>600||typeof value.timeZone!=='string')throw Error('call_request_invalid');
    new Intl.DateTimeFormat('es',{timeZone:value.timeZone}).format(now);
    const existing=this.row('SELECT * FROM calls WHERE request_hash=?',value.requestHash);if(existing)return {...view(existing),created:false};
    if(this.row("SELECT COUNT(*) AS n FROM calls WHERE state IN ('scheduled','dialing','ringing','active','uncertain','cancel_requested')").n>=LIMITS.pending)throw Error('call_schedule_limit');
    const sealed=await seal(this.env,{id:value.id,phone:value.phone,objective:value.objective.trim()});
    const alarm=await this.ctx.storage.getAlarm();await this.ctx.storage.setAlarm(Math.min(alarm??value.dueAt,value.dueAt));
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO calls(id,request_hash,phone,due_at,time_zone,encrypted,iv,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'scheduled',?,? WHERE (SELECT COUNT(*) FROM calls WHERE state IN ('scheduled','dialing','ringing','active','uncertain','cancel_requested'))<10",value.id,value.requestHash,value.phone,value.dueAt,value.timeZone,sealed.encrypted,sealed.iv,now,now);
    const row=this.row('SELECT * FROM calls WHERE request_hash=?',value.requestHash);if(!row)throw Error('call_schedule_limit');await this.rearm();return {...view(row),created:row.id===value.id};
  }
  async list(phone){owner(this.env,phone);return this.rows('SELECT calls.*,receipts.metrics FROM calls LEFT JOIN receipts ON receipts.id=calls.id ORDER BY calls.created_at DESC LIMIT 10').map(view);}
  async cancel(phone,id){
    owner(this.env,phone);if(!UUID.test(id))throw Error('call_id_invalid');
    const row=this.row('SELECT * FROM calls WHERE id=? AND phone=?',id,phone);if(!row)return null;
    if(!TERMINAL.has(row.state)){
      this.ctx.storage.sql.exec("UPDATE calls SET state=CASE WHEN state='scheduled' THEN 'cancelled' ELSE 'cancel_requested' END,reason='user_cancelled',terminal_state='cancelled',updated_at=? WHERE id=? AND state NOT IN ('completed','failed','cancelled','expired','interrupted')",Date.now(),id);
      this.voices.get(id)?.close();this.voices.delete(id);
      if(row.control_id)await this.hangup(id);await this.rearm();
    }
    return view(this.row('SELECT * FROM calls WHERE id=?',id));
  }
  async rearm(){
    const pending=this.row("SELECT MIN(due_at) AS at FROM calls WHERE state='scheduled'")?.at;
    const active=this.row("SELECT MIN(CASE WHEN state IN ('uncertain','cancel_requested') AND control_id IS NULL THEN started_at+120000 WHEN state='cancel_requested' THEN MIN(COALESCE(answered_at,started_at)+120000,updated_at+5000) WHEN answered_at IS NOT NULL THEN MIN(answered_at+90000,updated_at+1000) ELSE started_at+45000 END) AS at FROM calls WHERE state IN ('dialing','ringing','active','uncertain','cancel_requested')")?.at;
    const times=[pending,active].filter(Number.isFinite);if(times.length)await this.ctx.storage.setAlarm(Math.max(Date.now()+50,Math.min(...times)));else await this.ctx.storage.deleteAlarm();
  }
  async alarm(){
    const now=Date.now();
    for(const row of this.rows("SELECT * FROM calls WHERE state IN ('dialing','ringing','active','uncertain','cancel_requested')")){
      const voice=this.voices.get(row.id);
      if(['uncertain','cancel_requested'].includes(row.state)&&!row.control_id){if(now-row.started_at>=120000)this.ctx.storage.sql.exec("UPDATE calls SET state='failed',reason='provider_result_uncertain',updated_at=? WHERE id=?",now,row.id);continue;}
      if(row.state==='cancel_requested'){
        if(row.hangup_attempts<3)await this.hangup(row.id);
        if(now-(row.answered_at||row.started_at)>=120000)this.ctx.storage.sql.exec("UPDATE calls SET state='failed',reason='hangup_unconfirmed',updated_at=? WHERE id=?",now,row.id);
        else this.ctx.storage.sql.exec('UPDATE calls SET updated_at=? WHERE id=?',now,row.id);continue;
      }
      let reason=!row.answered_at?(now-row.started_at>=LIMITS.ringSeconds*1000?'no_answer':null):now-row.answered_at>=90000?'maximum_duration':voice?.reason(now);
      if(!reason&&!voice&&row.answered_at&&now-row.answered_at>=15000)reason='interrupted';
      if(reason)await this.finish(row.id,reason,voice?.metrics);
      else if(row.answered_at)this.ctx.storage.sql.exec('UPDATE calls SET updated_at=? WHERE id=?',now,row.id);
    }
    for(const row of this.rows("SELECT * FROM calls WHERE state='scheduled' AND due_at<=? ORDER BY due_at LIMIT 10",now)){
      if(now-row.due_at>60000){this.ctx.storage.sql.exec("UPDATE calls SET state='expired',reason='schedule_expired',updated_at=? WHERE id=? AND state='scheduled'",now,row.id);continue;}
      if(this.row("SELECT id FROM calls WHERE state IN ('dialing','ringing','active','uncertain','cancel_requested') LIMIT 1")){this.ctx.storage.sql.exec("UPDATE calls SET state='failed',reason='line_busy',updated_at=? WHERE id=? AND state='scheduled'",now,row.id);continue;}
      await this.dial(row);
    }
    this.ctx.storage.sql.exec('DELETE FROM events WHERE created_at<?',now-86400000);
    // Audio and transcripts are never persisted. Clear the encrypted objective
    // too once only the terminal receipt is needed.
    this.ctx.storage.sql.exec("UPDATE calls SET encrypted='',iv='',token_hash=NULL WHERE state IN ('completed','failed','cancelled','expired','interrupted') AND updated_at<?",now-60000);
    await this.rearm();
  }
  async dial(row){
    const data=await unseal(this.env,row);if(data.id!==row.id||data.phone!==row.phone)throw Error('call_integrity');
    const token=bytes64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),hash=await sha(token),now=Date.now();
    const claimed=this.rows("UPDATE calls SET state='dialing',started_at=?,updated_at=?,token_hash=? WHERE id=? AND state='scheduled' RETURNING id",now,now,hash,row.id);if(!claimed.length)return;
    // Persist the attempt and its hard deadline before any billable provider I/O.
    // An uncertain POST is reconciled by signed events, never retried as a dial.
    await this.ctx.storage.setAlarm(now+LIMITS.ringSeconds*1000);
    try{
      const result=await telnyx(this.env,'/calls',{
        connection_id:this.env.TELNYX_CONNECTION_ID,from:this.env.TELNYX_FROM_NUMBER,to:'+'+row.phone,
        webhook_url:(this.env.PUBLIC_CALLS_ORIGIN||'https://ia.vetsa.es')+'/webhooks/telnyx-cloud',webhook_url_method:'POST',
        client_state:bytes64(new TextEncoder().encode(JSON.stringify({v:1,id:row.id}))),command_id:row.id,
        timeout_secs:LIMITS.ringSeconds,time_limit_secs:LIMITS.callSeconds,
        stream_url:(this.env.PUBLIC_CALLS_ORIGIN||'https://ia.vetsa.es').replace(/^https:/,'wss:')+'/media/telnyx-cloud/'+row.id+'?token='+token,stream_track:'inbound_track',stream_codec:'PCMU',stream_bidirectional_mode:'rtp',stream_bidirectional_codec:'PCMU',stream_bidirectional_sampling_rate:8000
      });
      if(typeof result.call_control_id!=='string'||!result.call_control_id||result.call_control_id.length>1500)throw Error('telnyx_call_id_missing');
      const current=this.row('SELECT * FROM calls WHERE id=?',row.id);if(current.control_id&&current.control_id!==result.call_control_id)throw Error('telnyx_call_id_mismatch');
      this.ctx.storage.sql.exec("UPDATE calls SET control_id=?,state=CASE WHEN state='dialing' THEN 'ringing' ELSE state END,updated_at=? WHERE id=?",result.call_control_id,Date.now(),row.id);
      if(current.state==='cancel_requested'||TERMINAL.has(current.state))await this.hangup(row.id);
    }catch(error){
      this.ctx.storage.sql.exec("UPDATE calls SET state=CASE WHEN state='cancel_requested' THEN state ELSE ? END,reason=?,updated_at=? WHERE id=? AND state IN ('dialing','ringing','uncertain','cancel_requested')",error.definitive?'failed':'uncertain',error.definitive?'provider_rejected':'provider_result_uncertain',Date.now(),row.id);
    }
  }
  async hangup(id){
    const row=this.row('SELECT * FROM calls WHERE id=?',id);if(!row?.control_id||row.hangup_attempts>=3)return;
    const attempt=row.hangup_attempts+1;
    this.ctx.storage.sql.exec('UPDATE calls SET hangup_attempts=?,updated_at=? WHERE id=?',attempt,Date.now(),id);
    try{await telnyx(this.env,'/calls/'+encodeURIComponent(row.control_id)+'/actions/hangup',{command_id:await this.commandId(id,'hangup'),client_state:bytes64(new TextEncoder().encode(JSON.stringify({v:1,id})))});}
    catch{/* Bounded retry uses the same provider command id; hard time_limit remains. */}
  }
  async commandId(id,action){const hash=await sha(id+':'+action);return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-a'+hash.slice(17,20)+'-'+hash.slice(20,32);}
  async finish(id,reason,metrics){
    const row=this.row('SELECT * FROM calls WHERE id=?',id);if(!row||TERMINAL.has(row.state))return;
    this.voices.get(id)?.close();this.voices.delete(id);
    if(metrics)this.ctx.storage.sql.exec('INSERT INTO receipts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metrics=excluded.metrics',id,JSON.stringify(metrics));
    const state=reason==='user_cancelled'?'cancelled':['user_hangup','user_silence','maximum_duration','turn_limit'].includes(reason)&&metrics?.acknowledgedSentences>0?'completed':reason==='interrupted'?'interrupted':'failed';
    this.ctx.storage.sql.exec("UPDATE calls SET state='cancel_requested',terminal_state=?,reason=?,updated_at=? WHERE id=?",state,reason,Date.now(),id);
    await this.hangup(id);
    // Keep no transcripts or provider text in an operational receipt.
    await this.rearm();
  }
  async webhook(event){
    const data=event?.data,payload=data?.payload;if(typeof data?.id!=='string'||data.id.length>200||typeof payload?.client_state!=='string')return;
    let client;try{client=JSON.parse(new TextDecoder().decode(from64(payload.client_state,1024)));}catch{return;}
    if(client.v!==1||!UUID.test(client.id))return;
    const row=this.row('SELECT * FROM calls WHERE id=?',client.id);if(!row)return;
    if(payload.connection_id!==this.env.TELNYX_CONNECTION_ID||payload.to!=='+'+row.phone||payload.from!==this.env.TELNYX_FROM_NUMBER||typeof payload.call_control_id!=='string'||payload.call_control_id.length>1500||row.control_id&&row.control_id!==payload.call_control_id)return;
    if(this.row('SELECT id FROM events WHERE id=?',data.id))return;
    this.ctx.storage.sql.exec('INSERT INTO events VALUES(?,?)',data.id,Date.now());
    this.ctx.storage.sql.exec('UPDATE calls SET control_id=COALESCE(control_id,?) WHERE id=?',payload.call_control_id,row.id);
    if(TERMINAL.has(row.state)){if(data.event_type!=='call.hangup')await this.hangup(row.id);return;}
    if(row.state==='cancel_requested'&&data.event_type!=='call.hangup'){await this.hangup(row.id);return;}
    if(data.event_type==='call.answered')this.ctx.storage.sql.exec("UPDATE calls SET state='active',answered_at=COALESCE(answered_at,?),updated_at=? WHERE id=?",Date.now(),Date.now(),row.id);
    if(data.event_type==='call.hangup'){
      const voice=this.voices.get(row.id),noAnswer=!row.answered_at&&['timeout','no_answer'].includes(payload.hangup_cause)&&row.reason!=='user_cancelled',reason=noAnswer?'no_answer':row.reason||payload.hangup_cause||'remote_hangup',successful=Boolean(row.answered_at&&voice?.metrics.acknowledgedSentences);
      voice?.close();this.voices.delete(row.id);
      if(voice)this.ctx.storage.sql.exec('INSERT INTO receipts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metrics=excluded.metrics',row.id,JSON.stringify(voice.metrics));
      this.ctx.storage.sql.exec('UPDATE calls SET state=?,reason=?,updated_at=? WHERE id=?',noAnswer?'failed':row.terminal_state||(successful?'completed':'failed'),String(reason).slice(0,80),Date.now(),row.id);
    }
    if(data.event_type==='streaming.failed')await this.finish(row.id,'media_failed');
    await this.rearm();
  }
  async media(request,id,token){
    const hash=await sha(token||''),row=this.row('SELECT * FROM calls WHERE id=?',id);
    if(!row||!['dialing','ringing','active'].includes(row.state)||row.media_used||!same(hash,row.token_hash)||Date.now()-row.started_at>(LIMITS.ringSeconds+LIMITS.callSeconds)*1000)return new Response('Unauthorized',{status:401});
    const data=await unseal(this.env,row);
    if(data.id!==id||data.phone!==row.phone)return new Response('Unauthorized',{status:401});
    const claim=this.rows('UPDATE calls SET media_used=1 WHERE id=? AND media_used=0 RETURNING id',id);if(!claim.length)return new Response('Conflict',{status:409});
    const pair=new WebSocketPair(),client=pair[0],socket=pair[1];
    const voice=new PhoneVoice({env:this.env,socket,controlId:row.control_id,objective:data.objective,computer:phoneComputer(this.env,row.phone,id),...(this.providerFetch?{fetcher:(...args)=>this.providerFetch(id,...args)}:{}),
      validateStart:async start=>{
        const current=this.row('SELECT * FROM calls WHERE id=?',id);
        if(!current||!['dialing','ringing','active'].includes(current.state)||start.to!=='+'+row.phone||start.from!==this.env.TELNYX_FROM_NUMBER||current.control_id&&current.control_id!==start.call_control_id)return false;
        this.ctx.storage.sql.exec('UPDATE calls SET control_id=COALESCE(control_id,?) WHERE id=?',start.call_control_id,id);return true;
      },onEnd:(reason,metrics)=>this.finish(id,reason,metrics),waitUntil:p=>this.ctx.waitUntil(p)});
    this.voices.set(id,voice);
    socket.addEventListener('message',event=>this.ctx.waitUntil(voice.accept(event.data).catch(error=>voice.fail(error,'media_failed'))));
    for(const kind of ['close','error'])socket.addEventListener(kind,()=>{if(!voice.closed)this.ctx.waitUntil(voice.end('media_disconnected'));});
    socket.accept();await this.rearm();return new Response(null,{status:101,webSocket:client});
  }
  fetch(request){const url=new URL(request.url),id=url.pathname.split('/').at(-1);return this.media(request,id,url.searchParams.get('token'));}
  async reserveNotices(phone){
    owner(this.env,phone);
    return this.rows("UPDATE calls SET notice_state='sending' WHERE id IN (SELECT id FROM calls WHERE state IN ('completed','failed','cancelled','expired','interrupted') AND notice_state='pending' ORDER BY updated_at LIMIT 5) RETURNING id,state,due_at,time_zone,reason").map(view);
  }
  async recordNotice(phone,id,accepted){owner(this.env,phone);if(!UUID.test(id))throw Error('call_id_invalid');this.ctx.storage.sql.exec("UPDATE calls SET notice_state=? WHERE id=? AND notice_state='sending'",accepted?'accepted':'uncertain',id);}
}

export default class MelodiCalls extends WorkerEntrypoint {
  target(phone){owner(this.env,phone);return this.env.MELODI_PHONE.getByName(phone);}
  info(){return configuration(this.env);}
  schedule(value){return this.target(value?.phone).schedule(value);}
  list(phone){return this.target(phone).list(phone);}
  cancel(phone,id){return this.target(phone).cancel(phone,id);}
  reserveNotices(phone){return this.target(phone).reserveNotices(phone);}
  recordNotice(phone,id,accepted){return this.target(phone).recordNotice(phone,id,accepted===true);}
  async functionalCheck(){return {voice:await probeVoice(this.env),desktop:await probeDesktop(this.env)};}
  async modelCheck(){return probeModel(this.env);}
  async preflight(){
    const info=configuration(this.env);if(!info.configured)return {...info,checks:{}};
    const checks={};
    for(const [name,url,headers] of [
      ['telnyx','https://api.telnyx.com/v2/call_control_applications/'+encodeURIComponent(this.env.TELNYX_CONNECTION_ID),{Authorization:'Bearer '+this.env.TELNYX_API_KEY}],
      ['cartesiaVoice','https://api.cartesia.ai/voices/'+info.tts.id,{'X-API-Key':this.env.BRIVANY_CARTESIA_API_KEY,'Cartesia-Version':info.tts.version}]
    ]){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(8000),redirect:'manual'});await r.body?.cancel();checks[name]=r.ok?'passed':'http_'+r.status;}catch{checks[name]='unavailable';}}
    if(this.env.MELODI_DESKTOP){try{checks.desktop=(await this.env.MELODI_DESKTOP.info(this.env.OWNER_WHATSAPP_NUMBER)).online?'passed':'offline';}catch{checks.desktop='unavailable';}}
    return {...info,checks};
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/webhooks/telnyx-cloud'&&request.method==='POST'){
      if(Number(request.headers.get('content-length')||0)>65536)return new Response('Too large',{status:413});
      let raw;try{raw=await boundedText(new Response(request.body),65536);}catch{return new Response('Too large',{status:413});}
      if(!await verifyWebhook(request,raw,this.env.TELNYX_PUBLIC_KEY))return new Response('Unauthorized',{status:401});
      try{await this.target(this.env.OWNER_WHATSAPP_NUMBER).webhook(JSON.parse(raw));}catch{return new Response('Invalid event',{status:400});}
      return new Response('ok');
    }
    const match=/^\/media\/telnyx-cloud\/([a-f0-9-]{36})$/.exec(url.pathname);
    if(match&&request.method==='GET'&&request.headers.get('upgrade')?.toLowerCase()==='websocket'&&UUID.test(match[1])){
      const token=url.searchParams.get('token');if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))return new Response('Unauthorized',{status:401});
      return this.target(this.env.OWNER_WHATSAPP_NUMBER).fetch(request);
    }
    return new Response('Not found',{status:404});
  }
}
