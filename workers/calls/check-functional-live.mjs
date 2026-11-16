import {cf} from '../whatsapp/tools/cloudflare-release.mjs';
import {query} from '../whatsapp/tools/melodi-db.mjs';
import {MELODI_RELEASE} from '../whatsapp/melodi-identity.js';
import {setTimeout as delay} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const modelOnly=process.argv.includes('--model-only'),secondModel=process.argv.includes('--model-2'),provider=modelOnly?'calls-functional-model'+(secondModel?'-2':''):'calls-functional';
const envelope=await(await cf('/queues/f5735b1cec994457bc3e6d8b40115298/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content_type:'json',body:{type:modelOnly?'melodi_call_model_check':'melodi_functional_call_check',ownerPhone:'18495205246',release:MELODI_RELEASE,...(secondModel?{probeVersion:2}:{})}})})).json();
assert.equal(envelope.success,true);
let result;
for(let i=0;i<24;i++){
 await delay(1500);
 const row=(await query('SELECT status FROM brivany_whatsapp_integration_checks WHERE release=? AND provider=?',[MELODI_RELEASE,provider]))[0].results[0];
 if(row&&row.status!=='running'){result=JSON.parse(row.status);break;}
}
const report={checkedAt:new Date().toISOString(),release:MELODI_RELEASE,result:result||{state:'unconfirmed'},realProviders:true,telephoneDialed:false,audioPersisted:false,automaticallyRetried:false};
await writeFile(new URL('../../.local/whatsapp-migration/reports/cloud-functional-'+(modelOnly?'model'+(secondModel?'-2':''):'check')+'.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
assert.ok(modelOnly?result?.modelRouting==='passed':result&&['cartesia','muse','asr','modelRouting'].every(k=>result.voice?.[k]==='passed')&&result.desktop?.state==='succeeded','functional check is incomplete; do not dial');
