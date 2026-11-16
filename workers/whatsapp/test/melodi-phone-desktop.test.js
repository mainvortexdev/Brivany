import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {appAgentSchema} from '../vetsa-app-agents.js';
import {ensureDesktop,desktopHash} from '../melodi-desktop.js';
import {phoneDesktopExecute,phoneDesktopStatus,phoneDesktopCancel,phoneDesktopInfo} from '../melodi-phone-desktop.js';
const PHONE='18095550101',DEVICE='10000000-0000-4000-8000-000000000001';
async function fixture(){
 const f=await financeFixture();f.db.sql.exec(appAgentSchema.join(';'));await ensureDesktop(f.env);
 f.db.sql.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').run('user-a',PHONE,Date.now());
 f.db.sql.prepare('INSERT INTO brivany_desktop_devices VALUES(?,?,?,?,?,1,?,?)').run(DEVICE,'user-a',PHONE,'Synthetic PC',await desktopHash('a'.repeat(64)),Date.now(),Date.now());
 return {...f,value:{phone:PHONE,callId:crypto.randomUUID(),requestId:crypto.randomUUID(),instruction:'Abre una aplicación sintética'}};
}
test('phone control binds caller, current account, call and utterance and is idempotent',async()=>{
 const f=await fixture(),one=await phoneDesktopExecute(f.env,f.services,f.value),two=await phoneDesktopExecute(f.env,f.services,f.value);
 assert.equal(one.id,two.id);assert.equal(one.state,'accepted');assert.doesNotMatch(one.summary,/Terminé/);
 assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM brivany_desktop_commands').get().n,1);
 const row=f.db.sql.prepare('SELECT * FROM brivany_desktop_commands').get();assert.doesNotMatch(JSON.stringify(row),/Abre una aplicación/);
 await assert.rejects(phoneDesktopExecute(f.env,f.services,{...f.value,phone:'18095559999'}),/scope/);
 await assert.rejects(phoneDesktopStatus(f.env,f.services,{...f.value,id:one.id,callId:crypto.randomUUID()}),/task/);
});
test('phone status reports actual results and cancellation cannot reach another task',async()=>{
 const f=await fixture(),one=await phoneDesktopExecute(f.env,f.services,f.value),scope={...f.value,id:one.id};
 assert.equal((await phoneDesktopStatus(f.env,f.services,scope)).state,'pending');
 const result=await f.services.encrypt(JSON.stringify({id:one.id,deviceId:DEVICE,phone:PHONE,summary:'Synthetic complete.'}));
 f.db.sql.prepare("UPDATE brivany_desktop_commands SET state='succeeded',result_encrypted=?,result_iv=? WHERE id=?").run(result.encrypted,result.iv,one.id);
 assert.match((await phoneDesktopStatus(f.env,f.services,scope)).summary,/confirmó.*terminó.*Synthetic complete/);
 await assert.rejects(phoneDesktopCancel(f.env,f.services,{...scope,requestId:crypto.randomUUID()}),/task/);
});
test('offline or reassigned PCs cannot receive a telephone command',async()=>{
 const f=await fixture();assert.equal((await phoneDesktopInfo(f.env,f.services,PHONE)).online,true);
 f.db.sql.prepare('UPDATE brivany_desktop_devices SET user_id=?').run('different-account');
 assert.equal((await phoneDesktopInfo(f.env,f.services,PHONE)).online,false);
 await assert.rejects(phoneDesktopExecute(f.env,f.services,f.value),/scope/);
 assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM brivany_desktop_commands').get().n,0);
});
