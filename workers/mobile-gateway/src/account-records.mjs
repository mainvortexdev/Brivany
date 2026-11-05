import {AccountError,passwordRecord,passwordMatches,hash,secret,sessionParts,equal,uuid,emailAddress} from './account-crypto.mjs';
import {acknowledgement} from './quick-actions.mjs';

const SESSION_MS=30*86400000,COMMAND_MS=24*3600000;
const FINAL=new Set(['succeeded','failed','cancelled','uncertain']);
const KINDS=new Set(['desktop','terminal','model','document','personal','edits','motion','media','support','skill','schedule','image','research','orchestrator']);
const clean=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f]/.test(value)?value.trim():null;
const folded=value=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export class AccountRecords {
  constructor({sql,key,pepper,now=()=>Date.now(),online=()=>false,deliver=()=>false,disconnect=()=>{}}){Object.assign(this,{sql,key,pepper,now,online,deliver,disconnect});}
  init(){
    this.sql.exec('CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, device_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL, created INTEGER NOT NULL)');
    this.sql.exec("CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, device_id TEXT, instruction TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, result TEXT, local_id TEXT, kind TEXT NOT NULL DEFAULT 'desktop')");
    if(!this.rows('PRAGMA table_info(commands)').some(row=>row.name==='kind'))this.sql.exec("ALTER TABLE commands ADD COLUMN kind TEXT NOT NULL DEFAULT 'desktop'");
    if(!this.rows('PRAGMA table_info(commands)').some(row=>row.name==='conversation_id'))this.sql.exec("ALTER TABLE commands ADD COLUMN conversation_id TEXT NOT NULL DEFAULT ''");
    if(!this.rows('PRAGMA table_info(commands)').some(row=>row.name==='user_request'))this.sql.exec("ALTER TABLE commands ADD COLUMN user_request TEXT");
  }
  rows(query,...args){return this.sql.exec(query,...args).toArray();}
  profile(){const row=this.rows('SELECT value FROM account WHERE id=1')[0];if(!row)return null;const saved=JSON.parse(row.value);return {id:this.key,name:saved.name,email:saved.email};}
  async provision({email,name,password}){
    if(this.profile())throw new AccountError('account_exists',409);
    email=emailAddress(email);name=clean(name,80);if(!name)throw new AccountError('invalid_request');
    const credentials=await passwordRecord(password,this.pepper);
    this.sql.exec('INSERT OR IGNORE INTO account(id,value) VALUES(1,?)',JSON.stringify({email,name,credentials}));
    return {account:this.profile()};
  }
  async login({email,password,device_id,device_name,kind,platform}){
    if(!uuid(device_id)||!['desktop','mobile'].includes(kind)||!clean(device_name,80)||!['windows','macos','linux','ios','preview'].includes(platform))throw new AccountError('invalid_request');
    const saved=this.rows('SELECT value FROM account WHERE id=1')[0];const account=saved?JSON.parse(saved.value):null;
    const matches=await passwordMatches(password,this.pepper,account?.credentials);
    if(!matches||!account||emailAddress(email)!==account.email)throw new AccountError('invalid_credentials',401);
    const before=this.rows('SELECT id FROM devices WHERE id=?',device_id)[0];
    if(!before&&this.rows('SELECT id FROM devices').length>=20)throw new AccountError('device_limit',409);
    this.purge();
    this.sql.exec('INSERT INTO devices(id,name,platform,kind,enabled,created) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,kind=excluded.kind,enabled=1',device_id,device_name.trim(),platform,kind,this.now());
    // A fresh sign-in replaces that device's old sessions and host socket.
    for(const prior of this.rows('SELECT id FROM sessions WHERE device_id=?',device_id)){this.disconnect(prior.id);this.sql.exec('DELETE FROM sessions WHERE id=?',prior.id);}
    const id=crypto.randomUUID(),raw=secret(),expires=this.now()+SESSION_MS;
    this.sql.exec('INSERT INTO sessions(id,secret_hash,device_id,kind,expires,created) VALUES(?,?,?,?,?,?)',id,hash(raw),device_id,kind,expires,this.now());
    return {account:this.profile(),session:{token:`b1.${this.key}.${id}.${raw}`,expires_at:expires,device_id},device:this.device(device_id)};
  }
  authenticate(token){
    const parts=sessionParts(token);if(!parts||parts.account!==this.key)throw new AccountError('unauthorized',401);
    const row=this.rows('SELECT * FROM sessions WHERE id=?',parts.id)[0];
    if(!row||row.expires<=this.now()||!equal(hash(parts.secret),row.secret_hash))throw new AccountError('unauthorized',401);
    const device=this.device(row.device_id);if(!device?.enabled)throw new AccountError('unauthorized',401);
    return {id:row.id,device_id:row.device_id,kind:row.kind,expires:row.expires};
  }
  device(id){const row=this.rows('SELECT id,name,platform,kind,enabled FROM devices WHERE id=?',id)[0];return row?{...row,enabled:!!row.enabled,online:row.kind==='desktop'&&!!row.enabled&&this.online(id)}:null;}
  devices(){return this.rows('SELECT id FROM devices ORDER BY created').map(row=>this.device(row.id));}
  liveComputers(){return this.devices().filter(d=>d.kind==='desktop'&&d.online&&d.enabled);}
  logout(session){this.sql.exec('DELETE FROM sessions WHERE id=?',session.id);this.disconnect(session.id);return {ok:true};}
  revoke(session,id){
    if(!uuid(id)||!this.device(id))throw new AccountError('device_missing',404);
    for(const row of this.rows('SELECT id FROM sessions WHERE device_id=?',id)){this.disconnect(row.id);this.sql.exec('DELETE FROM sessions WHERE id=?',row.id);}
    this.sql.exec('UPDATE devices SET enabled=0 WHERE id=?',id);return {ok:true};
  }
  pending(session,conversation=session.id){
    this.purge();const row=this.rows("SELECT * FROM commands WHERE session_id=? AND conversation_id=? AND state='needs_device' ORDER BY created DESC LIMIT 1",session.id,conversation)[0];return row?this.public(row):null;
  }
  public(row){
    const value={id:row.id,device_id:row.device_id,state:row.state,source:row.source,kind:row.kind,created:row.created,updated:row.updated};
    if(row.device_id)value.device=this.device(row.device_id);
    if(row.result)value.result=JSON.parse(row.result);
    if(row.state==='needs_device'){value.computers=this.liveComputers();value.message=value.computers.length?'¿En qué ordenador quieres que lo haga?':'No hay ordenadores conectados a esta cuenta.';}
    else value.message=({offered:acknowledgement(row.id),accepted:'Me pongo con ello.',running:'Estoy en ello.',awaiting_approval:'Necesito tu aprobación para continuar.',succeeded:'Listo.',failed:'No pude completar la tarea.',cancelled:'He detenido la tarea.',uncertain:'No pude confirmar el resultado. No repetiré la acción automáticamente.'})[row.state]||'Revisa el resultado.';
    return value;
  }
  getCommand(id){
    if(!uuid(id))throw new AccountError('command_missing',404);
    const row=this.rows('SELECT * FROM commands WHERE id=?',id)[0];if(!row||row.created<this.now()-COMMAND_MS)throw new AccountError('command_missing',404);
    if(row.state==='offered'&&this.now()-row.updated>15000||['accepted','running','awaiting_approval'].includes(row.state)&&row.device_id&&!this.online(row.device_id)&&this.now()-row.updated>120000){this.sql.exec("UPDATE commands SET state='uncertain',updated=? WHERE id=?",this.now(),id);row.state='uncertain';row.updated=this.now();}
    return this.public(row);
  }
  request(session,{instruction,kind='desktop',source='chat',nonce,computer=null,conversation_id=session.id,user_request=instruction}){
    if(typeof instruction!=='string'||!instruction.trim()||instruction.length>1200||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(instruction)||!KINDS.has(kind)||!['chat','voice'].includes(source)||!uuid(nonce)||!uuid(conversation_id)||computer!==null&&!clean(computer,80))throw new AccountError('invalid_request');
    if(typeof user_request!=='string'||!user_request.trim()||user_request.length>2000)throw new AccountError('invalid_request');
    const prior=this.rows('SELECT * FROM commands WHERE nonce=?',nonce)[0];if(prior)return this.public(prior);
    this.purge();
    if(this.rows("SELECT id FROM commands WHERE state IN ('offered','accepted','running','awaiting_approval')").length>=12)throw new AccountError('task_limit',409);
    const row={id:crypto.randomUUID(),nonce,session_id:session.id,device_id:null,instruction:instruction.trim(),source,state:'needs_device',created:this.now(),updated:this.now(),result:null,local_id:null};
    this.sql.exec('INSERT INTO commands(id,nonce,session_id,instruction,source,state,created,updated,kind,conversation_id,user_request) VALUES(?,?,?,?,?,?,?,?,?,?,?)',row.id,nonce,session.id,row.instruction,source,row.state,row.created,row.updated,kind,conversation_id,user_request);
    return this.select(session,row.id,computer);
  }
  select(session,id,computer=null){
    const row=this.rows('SELECT * FROM commands WHERE id=?',id)[0];
    if(!row||row.session_id!==session.id||row.created<this.now()-COMMAND_MS)throw new AccountError('command_missing',404);
    if(row.state!=='needs_device')return this.public(row);
    const computers=this.liveComputers();let selected=null;
    if(computer){const matches=computers.filter(d=>d.id===computer||folded(d.name)===folded(computer));if(matches.length===1)selected=matches[0];else if(computers.length===1&&['este ordenador','mi ordenador','el ordenador','este equipo','mi equipo','mi pc','este pc','this computer','my computer'].includes(folded(computer)))selected=computers[0];}
    else if(computers.length===1)selected=computers[0];
    if(!selected)return this.public(row);
    this.sql.exec("UPDATE commands SET device_id=?,state='offered',updated=? WHERE id=? AND state='needs_device'",selected.id,this.now(),row.id);
    row.device_id=selected.id;row.state='offered';row.updated=this.now();
    if(!this.deliver(selected.id,{type:'command',id:row.id,kind:row.kind,instruction:row.instruction,user_request:row.user_request||row.instruction,source:row.source,created:row.created,issued_at:this.now()})){
      this.sql.exec("UPDATE commands SET state='uncertain' WHERE id=?",row.id);row.state='uncertain';
    }
    return this.public(row);
  }
  hostUpdate(session,event){
    if(session.kind!=='desktop'||!uuid(event.id))throw new AccountError('unauthorized',403);
    const row=this.rows('SELECT * FROM commands WHERE id=? AND device_id=?',event.id,session.device_id)[0];
    if(!row||FINAL.has(row.state)&&!(row.state==='uncertain'&&['succeeded','failed','cancelled'].includes(event.state)&&row.local_id&&row.local_id===event.local_id))return {ok:false};
    if(!['accepted','running','awaiting_approval','succeeded','failed','cancelled'].includes(event.state))throw new AccountError('invalid_request');
    const ranks={offered:0,accepted:1,running:2,awaiting_approval:2};if(!FINAL.has(event.state)&&(ranks[event.state]??0)<(ranks[row.state]??0))return {ok:false};
    const result=event.result===undefined?null:JSON.stringify(event.result);if(result&&result.length>6000)throw new AccountError('invalid_request');
    if(event.local_id!==undefined&&!uuid(event.local_id))throw new AccountError('invalid_request');
    this.sql.exec('UPDATE commands SET state=?,result=?,local_id=COALESCE(?,local_id),updated=? WHERE id=?',event.state,result,event.local_id||null,this.now(),event.id);
    return {ok:true,command:this.getCommand(event.id)};
  }
  purge(){
    this.sql.exec('DELETE FROM commands WHERE created<?',this.now()-COMMAND_MS);
    this.sql.exec('DELETE FROM sessions WHERE expires<=?',this.now());
  }
}
