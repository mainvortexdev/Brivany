// Preserve the existing resources/secrets of the two dedicated services.
// The WhatsApp/Recall Worker and all public routes remain outside this release.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {build} from '../workers/whatsapp/node_modules/esbuild/lib/main.js';
import {cf,digest} from '../workers/whatsapp/tools/cloudflare-release.mjs';
import {binarySourceParts} from './release_recall.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local/transfer-release');
const targets=[['brivany-file-transfer','workers/file-transfer/src/index.mjs'],['brivany-demo','workers/demo/worker.mjs']];
async function current(name){const [code,meta]=await Promise.all([cf('/workers/scripts/'+name),cf('/workers/scripts/'+name+'/settings')]);const settings=await meta.json();if(!settings.success)throw Error('settings_unavailable');return {bytes:Buffer.from(await code.arrayBuffer()),type:code.headers.get('Content-Type'),settings:settings.result};}
const fingerprint=state=>digest(JSON.stringify({modules:binarySourceParts({bytes:state.bytes,contentType:state.type}).map(p=>[p.name,digest(p.bytes)]).sort((a,b)=>a[0].localeCompare(b[0])),bindings:[...state.settings.bindings].sort((a,b)=>a.name.localeCompare(b.name))}));
const action=process.argv[2];
if(action==='prepare'){
 await mkdir(out,{recursive:true});const reports=[];
 for(const [name,source] of targets){
  const state=await current(name);await writeFile(join(out,name+'.before.multipart'),state.bytes);await writeFile(join(out,name+'.before.type'),state.type);await writeFile(join(out,name+'.settings.json'),JSON.stringify(state.settings));
  const result=await build({entryPoints:[join(root,source)],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers']});
  const bundle=result.outputFiles[0].text;await writeFile(join(out,name+'.mjs'),bundle);reports.push({name,baseline:fingerprint(state),bundleSha256:digest(bundle)});
 }
 await writeFile(join(out,'prepared.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify({prepared:true,workers:reports.map(r=>r.name)}));
}else if(action==='deploy'){
 const selected=process.argv[3];if(selected&&!targets.some(([name])=>name===selected))throw Error('unexpected_worker');
 const reports=JSON.parse(await readFile(join(out,'prepared.json'),'utf8')).filter(r=>!selected||r.name===selected),proof=JSON.parse(await readFile(join(out,'runtime.json'),'utf8')),results=[];
 if(!proof.passed)throw Error('runtime_verification_required');
 for(const report of reports){
  if(!targets.some(([name])=>name===report.name))throw Error('unexpected_worker');
  const bundle=await readFile(join(out,report.name+'.mjs'));if(digest(bundle)!==report.bundleSha256||report.bundleSha256!==proof[report.name==='brivany-demo'?'demo_sha256':'transfer_sha256'])throw Error('tested_bundle_mismatch');
  const state=await current(report.name);if(fingerprint(state)!==report.baseline)throw Error('worker_changed_since_prepare');
  const override=report.name==='brivany-demo'?[{name:'DEMO_TRANSFERS',type:'service',service:'brivany-file-transfer',entrypoint:'DemoDropIssuer'}]:[];
  const metadata={main_module:'worker.mjs',compatibility_date:state.settings.compatibility_date,bindings:[...state.settings.bindings.filter(b=>!override.some(o=>o.name===b.name)).map(b=>({name:b.name,type:'inherit'})),...override],annotations:{'workers/message':'Brivany: 1000 files, 20 GB and private demo pairing'}};
  for(const key of ['compatibility_flags','logpush','tail_consumers','tags','placement','limits','observability'])if(state.settings[key]!=null)metadata[key]=state.settings[key];
  const form=new FormData();form.set('metadata',JSON.stringify(metadata));form.set('worker.mjs',new Blob([bundle],{type:'application/javascript+module'}),'worker.mjs');
  const value=await(await cf('/workers/scripts/'+report.name+'?bindings_inherit=strict',{method:'PUT',body:form})).json();if(!value.success)throw Error('deploy_not_confirmed');
  results.push({worker:report.name,bundleSha256:report.bundleSha256,deployedAt:new Date().toISOString(),existingBindingsPreserved:state.settings.bindings.length});
  await writeFile(join(out,'deployment.json'),JSON.stringify(results,null,2));
 }
 console.log(JSON.stringify({deployed:true,workers:results}));
}else throw Error('choose_prepare_or_deploy');
