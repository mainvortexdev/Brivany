// Scoped deployment: preserve every existing WhatsApp/Recall module and append
// only the tested demo provider and desktop-account integration.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {build} from '../workers/whatsapp/node_modules/esbuild/lib/main.js';
import {current,uploadMetadata,cf,digest,SCRIPT} from '../workers/whatsapp/tools/cloudflare-release.mjs';
import {binarySourceParts} from './release_recall.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local/demo-jon/whatsapp-release');
const fingerprint=state=>digest(JSON.stringify(binarySourceParts(state).map(p=>[p.name,digest(p.bytes)]).sort((a,b)=>a[0].localeCompare(b[0]))));
export async function prepare(){
 await mkdir(out,{recursive:true});const state=await current(),parts=binarySourceParts(state),main=parts.find(p=>p.name==='worker-main.js');if(!main)throw Error('main_missing');
 let source=main.bytes.toString('utf8');
 if(source.includes('BRIVANY_DEMO_CHANNEL_V1')){
  const previous=JSON.parse(await readFile(join(out,'deployment.json'),'utf8'));
  if(digest(main.bytes)!==previous.bundleSha256)throw Error('live_changed_after_own_overlay');
  const baseline=binarySourceParts({bytes:await readFile(join(root,'.local/demo-jon/whatsapp-live.multipart')),contentType:await readFile(join(root,'.local/demo-jon/whatsapp-live-type.txt'),'utf8')});
  source=baseline.find(p=>p.name==='worker-main.js').bytes.toString('utf8');
  if(!main.bytes.subarray(0,Buffer.byteLength(source)).equals(Buffer.from(source)))throw Error('original_worker_changed');
  if(source.includes('BRIVANY_DEMO_CHANNEL_V1'))throw Error('unexpected_nested_overlay');
 }
 for(const name of ['tenantEnvironment','createDesktopCommand','handleDesktopRoute','runAssistantInference'])if(!new RegExp('function '+name+'\\(').test(source))throw Error('hook_missing_'+name);
 const built=await build({stdin:{contents:"export {tenantEnvironment,linkedTenant} from './workers/whatsapp/melodi-tenants.js'; export {createDesktopCommand,handleDesktopRoute} from './workers/whatsapp/melodi-desktop.js';export {runAssistantInference} from './workers/whatsapp/assistant-inference.js';export {prepareReviewDraft} from './workers/whatsapp/review-draft.js';",resolveDir:root},bundle:true,format:'iife',globalName:'BrivanyDemoChannel',platform:'browser',target:'es2022',write:false,legalComments:'inline'});
 const overlay='\n'+built.outputFiles[0].text+`
// BRIVANY_DEMO_CHANNEL_V1: account-scoped server budget, no provider keys on PC.
tenantEnvironment=BrivanyDemoChannel.tenantEnvironment;
linkedTenant=BrivanyDemoChannel.linkedTenant;
createDesktopCommand=BrivanyDemoChannel.createDesktopCommand;
handleDesktopRoute=BrivanyDemoChannel.handleDesktopRoute;
runAssistantInference=BrivanyDemoChannel.runAssistantInference;
const brivanyReviewOriginalQueue=worker_default.queue;
worker_default.queue=async function(batch,env,ctx){
 const rest=[];
 for(const message of batch.messages){
  if(message.body?.type!=='melodi_review_draft'){rest.push(message);continue;}
  try{await BrivanyDemoChannel.prepareReviewDraft(melodiEnvironment(env),message.body,sendWhatsApp);message.ack();}
  catch{console.error(JSON.stringify({event:'review_draft_unavailable'}));message.ack();}
 }
 if(rest.length)return brivanyReviewOriginalQueue.call(this,{...batch,messages:rest},env,ctx);
};
`;
 await writeFile(join(out,'baseline.multipart'),state.bytes);await writeFile(join(out,'baseline-type.txt'),state.contentType);await writeFile(join(out,'settings.json'),JSON.stringify(state.settings));
 const bundle=Buffer.from(source+overlay);await writeFile(join(out,'worker-main.js'),bundle);
 const report={baseline:fingerprint(state),bundleSha256:digest(bundle),existingCodePreserved:bundle.subarray(0,Buffer.byteLength(source)).equals(Buffer.from(source)),addedBytes:Buffer.byteLength(overlay),preparedAt:new Date().toISOString()};await writeFile(join(out,'prepared.json'),JSON.stringify(report,null,2));return report;
}
export async function deploy(){
 const report=JSON.parse(await readFile(join(out,'prepared.json'),'utf8')),proof=JSON.parse(await readFile(join(out,'runtime.json'),'utf8')),bundle=await readFile(join(out,'worker-main.js'));
 if(!proof.passed||proof.bundleSha256!==report.bundleSha256||digest(bundle)!==report.bundleSha256)throw Error('runtime_verification_required');
 const state=await current();if(fingerprint(state)!==report.baseline)throw Error('live_changed_reprepare');
 const metadata=uploadMetadata(state.settings,'worker-main.js',[{name:'BRIVANY_DEMO',type:'service',service:'brivany-demo',entrypoint:'DemoAccess'}]);const form=new FormData();form.set('metadata',JSON.stringify(metadata));
 for(const part of binarySourceParts(state)){const bytes=part.name==='worker-main.js'?bundle:part.bytes;if(part.name.endsWith('.wasm')&&!WebAssembly.validate(bytes))throw Error('invalid_original_wasm');form.set(part.name,new Blob([bytes],{type:part.name.endsWith('.wasm')?'application/wasm':'application/javascript+module'}),part.name);}
 const result=await(await cf('/workers/scripts/'+SCRIPT+'?bindings_inherit=strict',{method:'PUT',body:form})).json();if(!result.success)throw Error('deploy_failed');const saved={...report,version:result.result?.version_id,deployedAt:new Date().toISOString(),inheritedBindings:metadata.bindings.filter(b=>b.type==='inherit').length};await writeFile(join(out,'deployment.json'),JSON.stringify(saved,null,2));return saved;
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/release_demo_whatsapp.mjs')){const action=process.argv[2];if(!['prepare','deploy'].includes(action))throw Error('choose_prepare_or_deploy');console.log(JSON.stringify(await(action==='prepare'?prepare():deploy()),null,2));}
