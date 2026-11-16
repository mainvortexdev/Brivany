import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {appAgentSchema} from '../vetsa-app-agents.js';
import {handleDesktopRoute,ensureDesktop,createDesktopCommand,desktopHash,desktopControl,deliverDesktopResults,findBrivanyDesktop} from '../melodi-desktop.js';
const PHONE='18095550101',OTHER='18095559999',DEVICE='10000000-0000-4000-8000-000000000001',KEY='a'.repeat(64),PULL='20000000-0000-4000-8000-000000000001',LEASE='b'.repeat(64);
async function fixture(){
 const f=await financeFixture();f.db.sql.exec(appAgentSchema.join(';'));await ensureDesktop(f.env);
 f.db.sql.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').run('user-a',PHONE,Date.now());
 f.env.MELODI_JOBS={async send(){}};return{...f,env:{...f.env,OWNER_WHATSAPP_NUMBER:PHONE},auth:async()=>({id:'user-a'})};
}
async function call(f,path,data={},auth=f.auth){return handleDesktopRoute(new Request('https://ia.vetsa.es/api/brivany/whatsapp/desktop/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:DEVICE,deviceKey:KEY,...data})}),f.env,f.services,{userFromRequest:auth});}
async function enroll(f){assert.equal((await call(f,'register',{name:'PC de prueba'})).status,200);}
async function claimed(f,type='instruction'){
 await enroll(f);const id=await createDesktopCommand(f.env,DEVICE,PHONE,type,'Una tarea sintética',{requestKey:'test-message'},f.services);
 const response=await(await call(f,'poll',{pullId:PULL,lease:LEASE})).json();assert.equal(response.command.id,id);return id;
}
test('registration needs a linked authenticated account and cannot reassign another device',async()=>{
 const f=await fixture();assert.equal((await call(f,'register',{name:'PC'},async()=>null)).status,401);await enroll(f);
 assert.equal((await call(f,'register',{name:'Steal',deviceKey:'c'.repeat(64)})).status,403);
 const row=f.db.sql.prepare('SELECT * FROM brivany_desktop_devices').get();assert.equal(row.key_hash,await desktopHash(KEY));assert.doesNotMatch(JSON.stringify(row),new RegExp(KEY));
});
test('one message reserves one encrypted command; a different phone cannot claim it',async()=>{
 const f=await fixture();const id=await claimed(f);
 assert.equal(await createDesktopCommand(f.env,DEVICE,PHONE,'instruction','Una tarea sintética',{requestKey:'test-message'},f.services),id);
 assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_desktop_commands').get()),/Una tarea|test-message/);
 assert.equal((await call(f,'poll',{deviceKey:'d'.repeat(64),pullId:PULL,lease:LEASE})).status,403);
 assert.equal(await findBrivanyDesktop(f.env,OTHER),null);
 const replay=await(await call(f,'poll',{pullId:PULL,lease:LEASE})).json();assert.equal(replay.command.id,id);
 const newPull=await(await call(f,'poll',{pullId:crypto.randomUUID(),lease:'e'.repeat(64)})).json();assert.equal(newPull.command,null);
});
test('execution requires the claimed lease and terminal receipts cannot restart a command',async()=>{
 const f=await fixture(),id=await claimed(f);
 assert.equal((await call(f,'update',{id,lease:'f'.repeat(64),state:'accepted'})).status,403);
 assert.equal((await(await call(f,'update',{id,lease:LEASE,state:'accepted'})).json()).accepted,true);
 assert.equal((await(await call(f,'update',{id,lease:LEASE,state:'succeeded',result:{summary:'Synthetic result'}})).json()).accepted,true);
 assert.equal((await(await call(f,'update',{id,lease:LEASE,state:'accepted'})).json()).accepted,false);
});
test('unlinking and disabling stop delivery immediately without moving a task back to pending',async()=>{
 const f=await fixture(),id=await claimed(f);f.db.sql.prepare('UPDATE vetsa_app_agent_links SET phone=NULL,linked_at=NULL').run();
 assert.equal((await call(f,'update',{id,lease:LEASE,state:'accepted'})).status,403);
 assert.equal(f.db.sql.prepare('SELECT state FROM brivany_desktop_commands').get().state,'claimed');
});
test('expired jobs are not offered to a late desktop',async()=>{
 const f=await fixture();await enroll(f);
 await createDesktopCommand(f.env,DEVICE,PHONE,'instruction','Late synthetic task',{requestKey:'late'},f.services,{now:Date.now()-700000,ttl:1000});
 const response=await(await call(f,'poll',{pullId:PULL,lease:LEASE})).json();assert.equal(response.command,null);
 assert.equal(f.db.sql.prepare('SELECT state FROM brivany_desktop_commands').get().state,'expired');
});
test('approval responses bind phone, command and the exact current approval nonce',async()=>{
 const f=await fixture(),id=await claimed(f),nonce='g'.repeat(32),replies=[];
 await call(f,'update',{id,lease:LEASE,state:'accepted'});
 await call(f,'update',{id,lease:LEASE,state:'awaiting_approval',result:{summary:'Pending',approval:{id:nonce,description:'Move the synthetic file.'}}});
 await desktopControl(f.env,OTHER,`PC aprobar ${id} ${nonce}`,f.services,v=>replies.push(v));assert.match(replies.pop(),/No encuentro/);
 await desktopControl(f.env,PHONE,`PC aprobar ${id} ${'x'.repeat(32)}`,f.services,v=>replies.push(v));assert.match(replies.pop(),/ya no/);
 await desktopControl(f.env,PHONE,`PC aprobar ${id} ${nonce}`,f.services,v=>replies.push(v));
 const response=await(await call(f,'poll',{pullId:crypto.randomUUID(),lease:'e'.repeat(64)})).json();assert.equal(response.controls[0].approvalId,nonce);assert.equal(response.controls[0].accepted,true);
});
test('a lost outbound delivery remains uncertain and is never automatically sent a second time',async()=>{
 const f=await fixture(),id=await claimed(f);await call(f,'update',{id,lease:LEASE,state:'accepted'});await call(f,'update',{id,lease:LEASE,state:'succeeded',result:{summary:'Synthetic receipt'}});
 let sends=0;const send=async()=>{sends++;throw Error('provider timeout');};
 await deliverDesktopResults(f.env,f.services,send,send);await deliverDesktopResults(f.env,f.services,send,send);
 assert.equal(sends,1);assert.equal(f.db.sql.prepare('SELECT delivery_state FROM brivany_desktop_commands').get().delivery_state,'uncertain');
});
test('the reference download resolves only the claimed encrypted payload, never an arbitrary supplied object key',async()=>{
 const f=await fixture();await enroll(f);const key='melodi-private/owner-hash/2026-11/10000000-0000-4000-8000-000000000001';
 const id=await createDesktopCommand(f.env,DEVICE,PHONE,'instruction_reference','Tarea ficticia con imagen',{referenceImage:{objectKey:key,mimeType:'image/png'}},f.services);
 await call(f,'poll',{pullId:PULL,lease:LEASE});await call(f,'update',{id,lease:LEASE,state:'accepted'});
 const reads=[];f.env.VETSA_MEDIA={async get(objectKey){reads.push(objectKey);return{body:new Uint8Array([1,2,3]),size:3,httpMetadata:{contentType:'image/png'}};}};
 const response=await call(f,'reference',{id,lease:LEASE,kind:'image',objectKey:'another-users-file'});
 assert.equal(response.status,200);assert.deepEqual(reads,[key]);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await call(f,'reference',{id,lease:'c'.repeat(64),kind:'image'})).status,403);
});
test('delivery tick expires an offline command without waiting for the desktop to poll',async()=>{
 const f=await fixture();await enroll(f);const {ensureCalls}=await import('../melodi-calls.js');await ensureCalls(f.env);
 await createDesktopCommand(f.env,DEVICE,PHONE,'instruction','Tarea atrasada',{requestKey:'offline-expiry'},f.services,{now:Date.now()-700000,ttl:1000});
 const sends=[];await deliverDesktopResults(f.env,f.services,async(_env,_phone,body)=>{sends.push(body);return{messageId:'synthetic'};},async()=>{});
 assert.equal(f.db.sql.prepare('SELECT state FROM brivany_desktop_commands').get().state,'expired');assert.equal(sends.length,1);
});
