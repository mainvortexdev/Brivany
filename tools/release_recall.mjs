// Scoped release: keep the deployed WhatsApp code byte-for-byte and append Recall.
// This avoids publishing unrelated edits from a shared, dirty development tree.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {build} from '../workers/whatsapp/node_modules/esbuild/lib/main.js';
import {current,codeDigest,sourceParts,uploadMetadata,cf,digest,SCRIPT} from '../workers/whatsapp/tools/cloudflare-release.mjs';
const root=resolve(import.meta.dirname,'..'),local=join(root,'.local'),out=join(root,'tmp/recall-release');
// Cloudflare's download omits filename on some binary parts. Response.formData()
// then decodes those parts as text, corrupting Wasm. Preserve the original bytes.
export function binarySourceParts(state){
 const boundary=state.contentType?.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);if(!boundary)throw Error('worker_multipart_source_required');
 const marker=Buffer.from('--'+(boundary[1]||boundary[2])),separator=Buffer.concat([Buffer.from('\r\n'),marker]),bytes=Buffer.from(state.bytes),parts=[];let cursor=0;
 while((cursor=bytes.indexOf(marker,cursor))>=0){cursor+=marker.length;if(bytes.subarray(cursor,cursor+2).toString()==='--')break;if(bytes.subarray(cursor,cursor+2).toString()!=='\r\n')throw Error('invalid_source_multipart');cursor+=2;
  const headerEnd=bytes.indexOf('\r\n\r\n',cursor);if(headerEnd<0||headerEnd-cursor>4096)throw Error('invalid_source_headers');const headers=bytes.subarray(cursor,headerEnd).toString('ascii'),name=headers.match(/\bname="([A-Za-z0-9_.-]+)"/i)?.[1];if(!name)throw Error('invalid_source_module_name');
  const end=bytes.indexOf(separator,headerEnd+4);if(end<0)throw Error('invalid_source_module_end');parts.push({name,bytes:bytes.subarray(headerEnd+4,end)});cursor=end+2;
 }
 if(!parts.length||new Set(parts.map(p=>p.name)).size!==parts.length)throw Error('invalid_source_modules');return parts;
}
const binaryDigest=state=>digest(JSON.stringify(binarySourceParts(state).map(p=>[p.name,digest(p.bytes)]).sort((a,b)=>a[0].localeCompare(b[0]))));
export async function prepareRecallRelease(){
 await mkdir(out,{recursive:true});
 const source=await readFile(join(local,'recall-live-worker.mjs'),'utf8');
 for(const name of ['appAgentRoute','userFromRequest','linkedTenant','tenantEnvironment','melodiEnvironment'])if(!new RegExp('(?:async )?function '+name+'\\(').test(source))throw Error('live_recall_hook_missing_'+name);
 if(!source.includes('worker_default as default')||source.includes('BRIVANY_RECALL_OVERLAY_V1'))throw Error('unexpected_live_worker_revision');
 const built=await build({stdin:{contents:"export {meetingRoute,recallWebhook,recallJob} from './workers/whatsapp/meetings/service.js'; export {meetingMedia} from './workers/whatsapp/meetings/media.js';",resolveDir:root,sourcefile:'recall-backend-entry.js'},bundle:true,format:'iife',globalName:'BrivanyRecallBackend',platform:'browser',target:'es2022',loader:{'.png':'binary','.jpg':'binary'},write:false,legalComments:'inline'});
 const adapter=`
// BRIVANY_RECALL_OVERLAY_V1: append-only Recall integration, existing handlers preserved.
const brivanyRecallOriginalAppRoute=appAgentRoute;
appAgentRoute=async function(request,env,services){
 const path=new URL(request.url).pathname;
 if(path!=='/agents/meetings'&&!path.startsWith('/agents/meetings/'))return brivanyRecallOriginalAppRoute(request,env,services);
 env=melodiEnvironment(env);
 const user=await userFromRequest(request,env);
 if(!user)return Response.json({error:'Inicia sesión con tu cuenta Vetsa.'},{status:401,headers:{'Cache-Control':'no-store'}});
 const link=await env.VETSA_CLOUD.prepare('SELECT phone FROM vetsa_app_agent_links WHERE user_id=? AND linked_at IS NOT NULL').bind(user.id).first();
 if(!link?.phone)return Response.json({error:'Vincula tu WhatsApp autorizado desde Brivany.'},{status:403,headers:{'Cache-Control':'no-store'}});
 const tenant=await linkedTenant(env,link.phone,services);
 if(!tenant||tenant.userId!==user.id)return Response.json({error:'Vuelve a vincular tu cuenta.'},{status:403,headers:{'Cache-Control':'no-store'}});
 return BrivanyRecallBackend.meetingRoute(request,tenantEnvironment(env,tenant),user.id,link.phone);
};
const brivanyRecallOriginalFetch=worker_default.fetch;
worker_default.fetch=async function(request,env,ctx){
 const url=new URL(request.url);
 if(url.hostname==='ia.vetsa.es'&&url.pathname==='/webhooks/recall')return BrivanyRecallBackend.recallWebhook(request,melodiEnvironment(env));
 if(url.hostname==='ia.vetsa.es'&&url.pathname.startsWith('/meeting-media/'))return BrivanyRecallBackend.meetingMedia(request,melodiEnvironment(env),ctx);
 return brivanyRecallOriginalFetch.call(this,request,env,ctx);
};
const brivanyRecallOriginalQueue=worker_default.queue;
worker_default.queue=async function(batch,env,ctx){
 const other=[];
 for(const message of batch.messages){
  if(!['recall_meeting','recall_webhook','recall_tick','recall_operator_test','recall_operator_media','recall_summary','recall_operator_summary','recall_operator_voice_check','recall_operator_calendar_check','recall_operator_board'].includes(message.body?.type)){other.push(message);continue;}
  try{await BrivanyRecallBackend.recallJob(melodiEnvironment(env),message.body);message.ack();}
  catch(error){console.error(JSON.stringify({event:'recall_queue_unavailable'}));message.retry({delaySeconds:Math.max(10,Math.min(300,error?.retryDelaySeconds||30))});}
 }
 if(other.length)return brivanyRecallOriginalQueue.call(this,{...batch,messages:other},env,ctx);
};
const brivanyRecallOriginalScheduled=worker_default.scheduled;
worker_default.scheduled=async function(event,env,ctx){
 await brivanyRecallOriginalScheduled.call(this,event,env,ctx);
 if(env.RECALL_API_KEY&&env.RECALL_REGION==='eu-central-1')ctx.waitUntil(melodiEnvironment(env).MELODI_JOBS.send({type:'recall_tick'}));
};
`;
 const overlay='\n'+built.outputFiles[0].text+adapter;
 await writeFile(join(out,'worker-main.js'),source+overlay);
 const baseline={bytes:await readFile(join(local,'recall-live-source.multipart')),contentType:await readFile(join(local,'recall-live-source-type.txt'),'utf8')};
 const report={worker:SCRIPT,workspace:'Vetsa AI',workspaceId:'1501389b-6c5d-4194-bbf8-90b2abd6a895',region:'eu-central-1',baselineDigest:binaryDigest(baseline),baselineBytes:Buffer.byteLength(source),baselineSourceSha256:digest(Buffer.from(source)),bundleSha256:digest(Buffer.from(source+overlay)),addedBytes:Buffer.byteLength(overlay),existingCodePreserved:true,webhook:'https://ia.vetsa.es/webhooks/recall',calendarRule:'explicit-event',preparedAt:new Date().toISOString()};
 await writeFile(join(out,'prepared.json'),JSON.stringify(report,null,2));return report;
}
export async function deployRecallRelease(){
 const report=JSON.parse(await readFile(join(out,'prepared.json'),'utf8')),bundle=await readFile(join(out,'worker-main.js'));
 if(digest(bundle)!==report.bundleSha256)throw Error('recall_bundle_changed_since_verification');
 const verified=JSON.parse(await readFile(join(out,'runtime-verification.json'),'utf8'));
 if(!verified.passed||verified.bundleSha256!==report.bundleSha256)throw Error('recall_runtime_verification_required');
 const voiceVerified=JSON.parse(await readFile(join(out,'voice-runtime-verification.json'),'utf8'));
 if(!voiceVerified.passed||voiceVerified.bundleSha256!==report.bundleSha256)throw Error('recall_voice_runtime_verification_required');
 const state=await current(),oldSettings=JSON.parse(await readFile(join(local,'recall-live-settings.json'),'utf8'));
 let previous;try{previous=JSON.parse(await readFile(join(out,'deployment.json'),'utf8'));}catch{}
 const oldParts=binarySourceParts({bytes:await readFile(join(local,'recall-live-source.multipart')),contentType:await readFile(join(local,'recall-live-source-type.txt'),'utf8')});
 const currentParts=binarySourceParts(state),currentMain=currentParts.find(p=>p.name==='worker-main.js');
 const ownPrevious=previous&&currentMain&&digest(currentMain.bytes)===previous.bundleSha256&&currentParts.filter(p=>p.name!=='worker-main.js').every(part=>oldParts.some(old=>old.name===part.name&&digest(old.bytes)===digest(part.bytes)));
 if(!ownPrevious&&(binaryDigest(state)!==report.baselineDigest||JSON.stringify(state.settings.bindings)!==JSON.stringify(oldSettings.bindings)))throw Error('live_worker_changed_reprepare_and_reverify');
 const python=join(root,'.venv/Scripts/python.exe');
 const credentials=JSON.parse(execFileSync(python,['-X','utf8','-B','-c',"from services.private_store import PrivateStore;import json;print(json.dumps(PrivateStore('.local/recall-backend.dpapi').read()))"],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:20000}));
 if(credentials.workspace_id!==report.workspaceId||credentials.RECALL_REGION!==report.region||!credentials.RECALL_API_KEY||!credentials.RECALL_WEBHOOK_VERIFICATION_SECRET)throw Error('protected_recall_credentials_required');
 const overrides=[{name:'RECALL_REGION',type:'plain_text',text:report.region},{name:'RECALL_WORKSPACE_ID',type:'plain_text',text:report.workspaceId},{name:'PUBLIC_API_BASE_URL',type:'plain_text',text:'https://ia.vetsa.es'},...['RECALL_API_KEY','RECALL_WEBHOOK_VERIFICATION_SECRET'].map(name=>({name,type:'secret_text',text:credentials[name]}))];
 for(const name of ['BRIVANY_MUSE_API_KEY','BRIVANY_META_API_KEY'])if(credentials[name])overrides.push({name,type:'secret_text',text:credentials[name]});
 if(credentials.BRIVANY_META_MODEL)overrides.push({name:'BRIVANY_META_MODEL',type:'plain_text',text:credentials.BRIVANY_META_MODEL});
 const metadata=uploadMetadata(state.settings,'worker-main.js',overrides),form=new FormData();form.set('metadata',JSON.stringify(metadata));
 for(const part of binarySourceParts(state)){if(!/^[A-Za-z0-9_.-]+$/.test(part.name))throw Error('unexpected_module_name');const bytes=part.name==='worker-main.js'?bundle:part.bytes;form.set(part.name,new Blob([bytes],{type:part.name.endsWith('.wasm')?'application/wasm':'application/javascript+module'}),part.name);}
 const response=await cf('/workers/scripts/'+SCRIPT+'?bindings_inherit=strict',{method:'PUT',body:form});const result=await response.json();if(!result.success)throw Error('recall_deployment_failed');
 const saved={...report,deployedAt:new Date().toISOString(),version:result.result?.version_id||result.result?.deployment_id,bindingsInherited:metadata.bindings.filter(b=>b.type==='inherit').length,secretNames:['RECALL_API_KEY','RECALL_WEBHOOK_VERIFICATION_SECRET']};
 await writeFile(join(out,'deployment.json'),JSON.stringify(saved,null,2));return saved;
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/release_recall.mjs')){
 const action=process.argv[2];if(!['prepare','deploy'].includes(action))throw Error('choose_prepare_or_deploy');
 console.log(JSON.stringify(action==='prepare'?await prepareRecallRelease():await deployRecallRelease(),null,2));
}
