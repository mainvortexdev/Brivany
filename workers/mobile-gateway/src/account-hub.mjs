import {DurableObject} from 'cloudflare:workers';
import {AccountRecords} from './account-records.mjs';
import {AccountError,sessionParts} from './account-crypto.mjs';

export class AccountHub extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.key=null;
    ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS hub_key (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
      this.key=ctx.storage.sql.exec('SELECT value FROM hub_key WHERE id=1').toArray()[0]?.value||null;
      new AccountRecords({sql:ctx.storage.sql,key:this.key,pepper:env.ACCOUNT_PEPPER}).init();
      await this.scheduleCleanup();
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  records(key){
    if(!/^[a-f0-9]{64}$/.test(key)||this.key&&this.key!==key)throw new AccountError('unauthorized',401);
    if(!this.key){this.ctx.storage.sql.exec('INSERT OR IGNORE INTO hub_key(id,value) VALUES(1,?)',key);this.key=key;}
    return new AccountRecords({sql:this.ctx.storage.sql,key,pepper:this.env.ACCOUNT_PEPPER,
      online:id=>this.sockets(id).length>0,
      deliver:(id,event)=>{const socket=this.sockets(id)[0];if(!socket)return false;try{socket.send(JSON.stringify(event));return true;}catch{return false;}},
      disconnect:sid=>{for(const socket of this.ctx.getWebSockets('session:'+sid))socket.close(1000,'Signed out');}});
  }
  sockets(id){return this.ctx.getWebSockets('device:'+id).filter(socket=>{
    const attached=socket.deserializeAttachment();
    const ping=this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime()||attached.connected;
    const session=this.ctx.storage.sql.exec('SELECT expires FROM sessions WHERE id=?',attached.session).toArray()[0];
    return socket.readyState===1&&session&&session.expires>Date.now()&&Date.now()-ping<70000;
  });}
  async provision(key,body){return this.records(key).provision(body);}
  async login(key,body){const value=await this.records(key).login(body);await this.scheduleCleanup();return value;}
  async scheduleCleanup(){
    const due=this.ctx.storage.sql.exec('SELECT MIN(due) AS due FROM (SELECT MIN(created)+86400001 AS due FROM commands UNION ALL SELECT MIN(expires) AS due FROM sessions)').toArray()[0]?.due;
    if(!due)return;
    const current=await this.ctx.storage.getAlarm(),next=Math.max(Date.now()+1000,due);
    if(current===null||current>next)await this.ctx.storage.setAlarm(next);
  }
  async alarm(){
    if(!this.key)return;
    for(const socket of this.ctx.getWebSockets()){
      const attached=socket.deserializeAttachment(),session=this.ctx.storage.sql.exec('SELECT expires FROM sessions WHERE id=?',attached.session).toArray()[0];
      if(!session||session.expires<=Date.now())try{socket.close(1000,'Session expired');}catch{}
    }
    this.records(this.key).purge();await this.scheduleCleanup();
  }
  authorize(key,token){const records=this.records(key),session=records.authenticate(token);return {account:records.profile(),session,devices:records.devices()};}
  operation(key,token,action,body={}){
    const records=this.records(key),session=records.authenticate(token);
    if(action==='devices')return {devices:records.devices()};
    if(action==='logout')return records.logout(session);
    if(action==='revoke')return records.revoke(session,body.device_id);
    if(action==='command'){const command=records.request(session,body);this.ctx.waitUntil(this.scheduleCleanup());return {command};}
    if(action==='select')return {command:records.select(session,body.id,body.computer)};
    if(action==='command_status')return {command:records.getCommand(body.id)};
    if(action==='pending')return {command:records.pending(session,body.conversation_id||session.id)};
    throw new AccountError('invalid_request');
  }
  async fetch(request){
    try{
      const token=request.headers.get('Authorization')?.replace(/^Bearer /,''),parts=sessionParts(token);
      if(!parts)throw new AccountError('unauthorized',401);
      const records=this.records(parts.account),session=records.authenticate(token);
      if(session.kind!=='desktop'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')throw new AccountError('unauthorized',403);
      const device=records.device(session.device_id);if(!device||device.kind!=='desktop')throw new AccountError('unauthorized',403);
      for(const prior of this.ctx.getWebSockets('device:'+device.id))prior.close(1000,'Reconnected');
      const pair=new WebSocketPair(),socket=pair[1];
      this.ctx.acceptWebSocket(socket,['device:'+device.id,'session:'+session.id]);
      socket.serializeAttachment({session:session.id,device:device.id,key:parts.account,connected:Date.now()});
      socket.send(JSON.stringify({type:'ready',device_id:device.id,heartbeat_seconds:20}));
      return new Response(null,{status:101,webSocket:pair[0]});
    }catch{return Response.json({error:{code:'unauthorized',message:'Conexión no autorizada.'}},{status:401});}
  }
  webSocketMessage(socket,raw){
    const attachment=socket.deserializeAttachment();
    try{
      const records=this.records(attachment.key),row=records.rows('SELECT * FROM sessions WHERE id=?',attachment.session)[0];
      if(!row||row.expires<=Date.now()||!records.device(row.device_id)?.enabled)throw new AccountError('unauthorized',401);
      if(typeof raw!=='string'||raw.length>10000)throw new AccountError('invalid_request');
      const event=JSON.parse(raw);
      if(event.type!=='update')throw new AccountError('invalid_request');
      const result=records.hostUpdate({id:row.id,kind:row.kind,device_id:row.device_id},event);
      socket.send(JSON.stringify({type:'ack',id:event.id,...result}));
    }catch{socket.send(JSON.stringify({type:'error',code:'invalid_host_event'}));socket.close(1008,'Invalid host event');}
  }
  webSocketClose(socket,code,reason,wasClean){try{socket.close(code,reason);}catch{}}
  webSocketError(socket){try{socket.close(1011,'Connection lost');}catch{}}
}
