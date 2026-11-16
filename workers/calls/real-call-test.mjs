// One explicitly authorized call to the configured original owner. This is
// deliberately separate from tools.verify and all simulated test suites.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {cf} from '../whatsapp/tools/cloudflare-release.mjs';
import {query} from '../whatsapp/tools/melodi-db.mjs';
import {MELODI_RELEASE} from '../whatsapp/melodi-identity.js';
const dial=process.argv.includes('--dial-once');
assert.ok(dial||process.argv.includes('--status'),'Use --dial-once only after explicit owner authorization, or --status');
if(dial){
 // The owner explicitly required successful checks before this real call.
 const checks=(await query('SELECT provider,status,updated_at FROM brivany_whatsapp_integration_checks WHERE release=?',[MELODI_RELEASE]))[0].results;
 for(const provider of ['calls-telnyx','calls-cartesiaVoice','calls-storage','calls-desktop']){
  const check=checks.find(row=>row.provider===provider);assert.ok(check?.status==='passed'&&Date.now()-check.updated_at<60000,'current '+provider+' preflight required; no call queued');
 }
 const functional=JSON.parse(checks.find(row=>row.provider==='calls-functional')?.status||'{}'),model=JSON.parse(checks.find(row=>row.provider==='calls-functional-model-2')?.status||'{}');
 assert.ok(['cartesia','muse','asr'].every(k=>functional.voice?.[k]==='passed')&&functional.desktop?.state==='succeeded'&&model.modelRouting==='passed','functional voice, model and desktop checks required; no call queued');
 const health=await(await fetch('https://ia.vetsa.es/health',{signal:AbortSignal.timeout(8000)})).json();assert.equal(health.release,MELODI_RELEASE);
}
const previous=(await query('SELECT updated_at FROM brivany_whatsapp_integration_checks WHERE release=? AND provider=?',[MELODI_RELEASE,'real-phone-call']))[0].results[0];
const result=await(await cf('/queues/f5735b1cec994457bc3e6d8b40115298/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content_type:'json',body:{type:dial?'melodi_real_call_test':'melodi_real_call_status',ownerPhone:'18495205246',release:MELODI_RELEASE}})})).json();
assert.equal(result.success,true);
let row;
for(let attempt=0;attempt<10;attempt++){
 await delay(1200);
 row=(await query('SELECT status,updated_at FROM brivany_whatsapp_integration_checks WHERE release=? AND provider=?',[MELODI_RELEASE,'real-phone-call']))[0].results[0];
 if(row&&row.updated_at!==previous?.updated_at)break;
}
assert.ok(row,'the private call check did not finish');
assert.notEqual(row.updated_at,previous?.updated_at,'the private call check did not refresh');
const report={checkedAt:new Date().toISOString(),release:MELODI_RELEASE,call:JSON.parse(row.status),authorization:'Explicit user request to call own number and control linked PC',automaticallyRedialed:false};
await writeFile(new URL('../../.local/whatsapp-migration/reports/real-phone-call-'+(dial?'dispatch':'status')+'.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
