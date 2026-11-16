import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {current,sourceParts,digest,cf} from './cloudflare-release.mjs';
import {MELODI_RELEASE} from '../melodi-identity.js';
import {setTimeout as delay} from 'node:timers/promises';
let publicRequests=0;
async function call(url,options={}){publicRequests++;return fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});}
let health;
for(let attempt=0;attempt<8;attempt++){
 health=await(await call('https://ia.vetsa.es/health',{headers:{'Cache-Control':'no-cache'}})).json();
 if(health.release===MELODI_RELEASE)break;
 await delay(2000);
}
assert.equal(health.service,'brivany-whatsapp');assert.equal(health.assistant,'Melodi');assert.equal(health.release,MELODI_RELEASE);
for(const origin of ['https://ia.vetsa.es','https://brivany.vetsa.es']){
 const number=await(await call(origin+'/api/brivany/whatsapp/number')).json();assert.equal(number.number,'18294249873');assert.equal(number.name,'Melodi');
 assert.equal((await call(origin+'/api/brivany/whatsapp/status')).status,401);
}
const forged=await call('https://ia.vetsa.es/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256=invalid'},body:'{}'});assert.equal(forged.status,401);
const contact=await call('https://brivany.vetsa.es/whatsapp');assert.equal(contact.status,200);assert.match(await contact.text(),/Vincular|VINCULA/);
const privacy=await call('https://ia.vetsa.es/privacy.html');assert.equal(privacy.status,302);assert.equal(privacy.headers.get('location'),'https://brivany.vetsa.es/privacidad');
const callsResponse=await call('https://ia.vetsa.es/health/calls');assert.equal(callsResponse.status,200);
const calls=await callsResponse.json();assert.equal(calls.configured,true);assert.equal(calls.transport,'cloud');assert.equal(calls.channel,'telephone');assert.equal(calls.tts.provider,'Cartesia');assert.equal(calls.tts.id,'3597a26f-80ef-4bd5-8101-9699bc764917');assert.equal(calls.limits.ringSeconds,45);
assert.equal((await call('https://ia.vetsa.es/webhooks/telnyx-cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
assert.equal((await call('https://brivany.vetsa.es/api/brivany/whatsapp/desktop/call-signal',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
const code=[];
for(const [script,path] of [['vetsa-whatsapp-assistant','../.wrangler-melodi-build/worker-main.js'],['brivany-calls','../../calls/.wrangler-melodi-build/worker.js'],['brivany-site','../../../official-site/.wrangler-melodi-build/worker.js'],['vetsa-public-media','../../whatsapp-media/.wrangler-melodi-build/worker.js']]){
 const live=await current(script),parts=await sourceParts(live),expected=digest(await readFile(new URL(path,import.meta.url)));
 assert.ok(parts.some(part=>digest(part.bytes)===expected),'published bundle differs');
 assert.equal(live.settings.observability.redact_query_string,true);code.push({script,bundleMatches:true,bindings:live.settings.bindings.length});
}
const queue=await(await cf('/queues/f5735b1cec994457bc3e6d8b40115298')).json();assert.notEqual(queue.result?.settings?.delivery_paused,true);
const report={checkedAt:new Date().toISOString(),publicRequests,health:{service:health.service,assistant:health.assistant,release:health.release,googleCalendarConfigured:health.googleCalendarConfigured,gmailConfigured:health.gmailConfigured,driveConfigured:health.driveConfigured},code,queueResumed:true,
 signedWebhookRequired:true,privateApiRequiresSession:true,publicNumberConfirmed:true,googleConsentNotTested:true,cloudCalls:{configured:calls.configured,transport:calls.transport,tts:calls.tts,limits:calls.limits,forgedWebhookRejected:true,retiredWhatsAppCallingRoute:true,telephoneDialedByThisCheck:false}};
await writeFile(new URL('../../../.local/whatsapp-migration/reports/live-check.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
