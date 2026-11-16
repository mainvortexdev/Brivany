// Administrative, read-only provider checks through the deployed service RPC.
// Queue format: https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {cf} from '../whatsapp/tools/cloudflare-release.mjs';
import {query} from '../whatsapp/tools/melodi-db.mjs';
import {MELODI_RELEASE} from '../whatsapp/melodi-identity.js';
const PHONE='18495205246',QUEUE='f5735b1cec994457bc3e6d8b40115298';
async function enqueue(body){
 const result=await(await cf('/queues/'+QUEUE+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,content_type:'json'})})).json();
 assert.equal(result.success,true);
}
const notify=process.argv.includes('--notify-owner');
const previous=(await query("SELECT MAX(updated_at) AS at FROM brivany_whatsapp_integration_checks WHERE release=? AND provider LIKE 'calls-%'",[MELODI_RELEASE]))[0].results[0]?.at||0;
if(!notify)await enqueue({type:'melodi_cloud_call_check',ownerPhone:PHONE,release:MELODI_RELEASE});
let checks=[];
for(let attempt=0;attempt<12;attempt++){
 checks=(await query("SELECT provider,status,http_status,updated_at FROM brivany_whatsapp_integration_checks WHERE release=? AND provider IN ('calls-telnyx','calls-cartesiaVoice','calls-storage','calls-desktop') ORDER BY provider",[MELODI_RELEASE]))[0].results;
 if(checks.length===4&&(notify||checks.every(check=>check.updated_at>previous)))break;await delay(1500);
}
const report={checkedAt:new Date().toISOString(),release:MELODI_RELEASE,checks,readOnlyProviderRequests:true,telephoneDialed:false,audioSynthesized:false};
await writeFile(new URL('../../.local/whatsapp-migration/reports/cloud-call-preflight.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
assert.equal(checks.length,4,'deployed cloud checks did not finish');
if(!notify)assert.ok(checks.every(check=>check.updated_at>previous),'deployed check did not refresh');
assert.ok(checks.every(check=>check.status==='passed'),'a deployed cloud dependency is unavailable');
if(notify){
 await enqueue({type:'melodi_notify',kind:'cloud-calls',ownerPhone:PHONE,release:MELODI_RELEASE});
 let notice;
 for(let attempt=0;attempt<12;attempt++){
  notice=(await query('SELECT status,delivery_status,error_code,updated_at FROM brivany_whatsapp_service_notices WHERE notice_key=?',[MELODI_RELEASE+':cloud-calls']))[0].results[0];
  if(notice&&['read','delivered','failed'].includes(notice.delivery_status)||notice&&['rejected','uncertain','preflight_failed'].includes(notice.status))break;
  await delay(1500);
 }
 const result={checkedAt:new Date().toISOString(),release:MELODI_RELEASE,notice:notice||null,automaticallyRetried:false};
 await writeFile(new URL('../../.local/whatsapp-migration/reports/cloud-call-notice.json',import.meta.url),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}
