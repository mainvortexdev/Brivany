import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AccountRecords} from '../src/account-records.mjs';
import {accountKey,sessionParts} from '../src/account-crypto.mjs';

const pepper='local-test-pepper-never-a-real-credential-0123456789',password='own-test-password-with-32-characters';
function fixture(email='one@brivany.test'){
 const db=new DatabaseSync(':memory:');const state={time:1700000000000,online:new Set(),sent:[],closed:[]};
 const sql={exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}};
 const account=new AccountRecords({sql,key:accountKey(email,pepper),pepper,now:()=>state.time,online:id=>state.online.has(id),deliver:(id,event)=>{state.sent.push({id,event});return state.online.has(id)},disconnect:id=>state.closed.push(id)});account.init();
 return {account,state,db,email};
}
async function login(f,kind='mobile',name='iPhone',id=crypto.randomUUID()){
 const result=await f.account.login({email:f.email,password,device_id:id,device_name:name,kind,platform:kind==='desktop'?'windows':'ios'});return {...result,auth:f.account.authenticate(result.session.token)};
}
test('passwords and session secrets are not stored in plaintext; wrong passwords are rejected',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const session=await login(f);
 const raw=JSON.stringify(f.account.rows('SELECT * FROM account').concat(f.account.rows('SELECT * FROM sessions')));
 assert(!raw.includes(password));assert(!raw.includes(sessionParts(session.session.token).secret));
 await assert.rejects(f.account.login({email:f.email,password:'different-password-not-accepted-1234',device_id:crypto.randomUUID(),device_name:'Phone',kind:'mobile',platform:'ios'}));f.db.close();
});
test('one connected desktop is selected by default and delivery is idempotent',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),host=await login(f,'desktop','Estudio');f.state.online.add(host.device.id);
 const nonce=crypto.randomUUID(),body={instruction:'Consulta el sistema.\nResume el resultado.',user_request:'Petición original propia.',source:'chat',nonce};
 assert.throws(()=>f.account.request(phone.auth,{...body,instruction:'Texto\u0000inválido'}));
 const first=f.account.request(phone.auth,body),second=f.account.request(phone.auth,body);
 assert.equal(first.device_id,host.device.id);assert.equal(first.state,'offered');assert.equal(second.id,first.id);assert.equal(f.state.sent.length,1);assert.equal(f.state.sent[0].event.user_request,'Petición original propia.');assert.equal(f.state.sent[0].event.instruction,body.instruction);f.db.close();
});
test('chat and voice both ask for a computer when there are several',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),one=await login(f,'desktop','Casa'),two=await login(f,'desktop','Estudio');f.state.online.add(one.device.id);f.state.online.add(two.device.id);
 for(const source of ['chat','voice']){const count=f.state.sent.length;const result=f.account.request(phone.auth,{instruction:'Abre un programa.',source,nonce:crypto.randomUUID()});assert.equal(result.state,'needs_device');assert.equal(result.computers.length,2);assert.equal(f.state.sent.length,count);const chosen=f.account.select(phone.auth,result.id,'Estudio');assert.equal(chosen.device_id,two.device.id);}
 assert.equal(f.state.sent.length,2);f.db.close();
});
test('offline computers never receive a command and a different account cannot authenticate',async()=>{
 const f=fixture(),other=fixture('two@brivany.test');for(const item of [f,other])await item.account.provision({email:item.email,name:'Own fixture',password});const phone=await login(f),outsider=await login(other);await login(f,'desktop','Offline');
 assert.throws(()=>f.account.authenticate(outsider.session.token));const result=f.account.request(phone.auth,{instruction:'Consulta el sistema.',nonce:crypto.randomUUID()});assert.equal(result.state,'needs_device');assert.equal(result.computers.length,0);assert.equal(f.state.sent.length,0);f.db.close();other.db.close();
});
test('only the target desktop can report a result; mobile cannot fabricate success',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),host=await login(f,'desktop','Casa'),other=await login(f,'desktop','Estudio');f.state.online.add(host.device.id);
 const command=f.account.request(phone.auth,{instruction:'Consulta el sistema.',nonce:crypto.randomUUID()});assert.throws(()=>f.account.hostUpdate(phone.auth,{id:command.id,state:'succeeded'}));assert.equal(f.account.hostUpdate(other.auth,{id:command.id,state:'succeeded'}).ok,false);
 assert.equal(f.account.hostUpdate(host.auth,{id:command.id,state:'accepted'}).ok,true);assert.equal(f.account.hostUpdate(host.auth,{id:command.id,state:'succeeded',result:{summary:'Own fixture result.'}}).command.state,'succeeded');f.db.close();
});
test('revocation expires the session and closes its host socket',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),host=await login(f,'desktop','Casa');f.account.revoke(phone.auth,host.device.id);assert.throws(()=>f.account.authenticate(host.session.token));assert(f.state.closed.includes(host.auth.id));assert(!f.account.device(host.device.id).enabled);f.db.close();
});
test('lost acknowledgements become uncertain without an automatic second delivery',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),host=await login(f,'desktop','Casa');f.state.online.add(host.device.id);
 const result=f.account.request(phone.auth,{instruction:'Consulta el sistema.',nonce:crypto.randomUUID()});f.state.time+=16000;assert.equal(f.account.getCommand(result.id).state,'uncertain');assert.equal(f.state.sent.length,1);f.state.time+=31*86400000;assert.throws(()=>f.account.authenticate(phone.session.token));f.db.close();
});

test('expired command contents are purged after 24 hours and sessions after 30 days',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f);
 const command=f.account.request(phone.auth,{instruction:'Own temporary fixture instruction.',nonce:crypto.randomUUID(),conversation_id:crypto.randomUUID()});
 assert.equal(f.account.rows('SELECT id FROM commands').length,1);f.state.time+=86400001;f.account.purge();assert.equal(f.account.rows('SELECT id FROM commands').length,0);assert.throws(()=>f.account.getCommand(command.id));assert.equal(f.account.rows('SELECT id FROM sessions').length,1);
 f.state.time+=30*86400000;f.account.purge();assert.equal(f.account.rows('SELECT id FROM sessions').length,0);f.db.close();
});

test('pending computer choices belong to their own conversation',async()=>{
 const f=fixture();await f.account.provision({email:f.email,name:'Own fixture',password});const phone=await login(f),one=crypto.randomUUID(),two=crypto.randomUUID();
 const first=f.account.request(phone.auth,{instruction:'Own first fixture.',nonce:crypto.randomUUID(),conversation_id:one});
 const second=f.account.request(phone.auth,{instruction:'Own second fixture.',nonce:crypto.randomUUID(),conversation_id:two});
 assert.equal(f.account.pending(phone.auth,one).id,first.id);assert.equal(f.account.pending(phone.auth,two).id,second.id);assert.equal(f.account.pending(phone.auth,crypto.randomUUID()),null);f.db.close();
});
