import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const ACCOUNT = '62a87427406c2ed15f92d4da29116214';
export const SCRIPT = 'vetsa-whatsapp-assistant';
export const BACKUP = 'C:/Users/felix/AppData/Local/Brivany/migration-backups/20261113-vetsa-before-melodi';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function cf(path, options = {}) {
  const config = await readFile(join(process.env.APPDATA, 'xdg.config/.wrangler/config/default.toml'), 'utf8');
  const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw Error('cloudflare_login_required');
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (!response.ok){const details=await response.json().catch(()=>({}));throw Error(`cloudflare_http_${response.status}_codes_${(details.errors||[]).map(e=>e.code).filter(Number.isSafeInteger).join('_')}`);}
  return response;
}
const ALLOWED=new Set([SCRIPT,'brivany-site','brivany-calls','vetsa-public-media','vetsa-instagram-operations']);
function scriptName(script){if(!ALLOWED.has(script))throw Error('unexpected_worker');return script;}
const location=(script,revision='initial')=>{
  if(!/^[a-z0-9-]{1,50}$/.test(revision))throw Error('invalid_snapshot_revision');
  return join(BACKUP,(script===SCRIPT?'cloudflare':'cloudflare-'+scriptName(script))+(revision==='initial'?'':'-'+revision));
};
export async function sourceParts(state){
  if(!state.contentType?.startsWith('multipart/'))return [{name:'worker',bytes:state.bytes}];
  const data=await new Response(state.bytes,{headers:{'Content-Type':state.contentType}}).formData();
  return Promise.all([...data.entries()].map(async([name,part])=>({name,bytes:Buffer.from(typeof part==='string'?part:await part.arrayBuffer())})));
}
export async function codeDigest(state){
  const parts=await sourceParts(state);
  return digest(JSON.stringify(parts.map(part=>[part.name,digest(part.bytes)]).sort((a,b)=>a[0].localeCompare(b[0]))));
}
export async function current(script=SCRIPT) {
  scriptName(script);
  const [source, settingResponse] = await Promise.all([
    cf(`/workers/scripts/${script}`), cf(`/workers/scripts/${script}/settings`),
  ]);
  const settingsEnvelope = await settingResponse.json();
  if (!settingsEnvelope.success) throw Error('cloudflare_settings_failed');
  const bytes = Buffer.from(await source.arrayBuffer());
  return { bytes, contentType: source.headers.get('content-type'), settings: settingsEnvelope.result };
}
export async function snapshot(script=SCRIPT,revision='initial'){
  const state=await current(script),target=location(script,revision);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'source.multipart'), state.bytes, { flag: 'wx' });
  await writeFile(join(target, 'settings.json'), JSON.stringify(state.settings), { flag: 'wx' });
  await writeFile(join(target, 'source-type.txt'), state.contentType, { flag: 'wx' });
  const report = { worker: script, sha256: digest(state.bytes), codeDigest:await codeDigest(state),compatibilityDate: state.settings.compatibility_date,
    bindings: state.settings.bindings.map(({name,type})=>({name,type})), observability: state.settings.observability };
  await writeFile(join(target, 'snapshot-report.json'), JSON.stringify(report, null, 2));
  return report;
}
export function uploadMetadata(settings,mainModule,overrides=[]){
  const names=new Set(overrides.map(b=>b.name));
  const metadata={main_module:mainModule,compatibility_date:settings.compatibility_date,
    bindings:[...settings.bindings.filter(b=>!names.has(b.name)).map(b=>({name:b.name,type:'inherit'})),...overrides],
    annotations:{'workers/message':'Brivany: Melodi en WhatsApp; conserva recursos y assets'},
    ...(settings.bindings.some(b=>b.type==='assets')?{keep_assets:true}:{})};
  for(const key of ['compatibility_flags','logpush','tail_consumers','tags','placement','limits','observability']){
    if(settings[key]!==undefined&&settings[key]!==null)metadata[key]=structuredClone(settings[key]);
  }
  metadata.observability={...metadata.observability,enabled:true,logs:{...metadata.observability?.logs,enabled:true,head_sampling_rate:1},
    traces:{...metadata.observability?.traces,enabled:true,head_sampling_rate:1},redact_query_string:true};
  return metadata;
}
export async function deploy(script,bundle,revision='initial'){
  scriptName(script);
  const bundlePath=resolve(bundle),workspace=resolve(import.meta.dirname,'../../..');
  if(!bundlePath.startsWith(workspace+'\\')&&!bundlePath.startsWith(workspace+'/'))throw Error('bundle_outside_brivany');
  const baseline={bytes:await readFile(join(location(script,revision),'source.multipart')),contentType:await readFile(join(location(script,revision),'source-type.txt'),'utf8')};
  const baselineSettings=JSON.parse(await readFile(join(location(script,revision),'settings.json'),'utf8'));
  const live=await current(script);
  if(await codeDigest(live)!==await codeDigest(baseline)||JSON.stringify(live.settings.bindings)!==JSON.stringify(baselineSettings.bindings))throw Error('worker_changed_since_snapshot');
  const overrides=[];
  if(script===SCRIPT){
    const config=JSON.parse(await readFile(join(BACKUP,'google-web-client.json'),'utf8'));
    const client=config.web||config;
    if(!client.client_id?.startsWith('125198900429-')||!client.client_secret)throw Error('brivany_google_client_required');
    overrides.push({name:'BRIVANY_GOOGLE_WEB_CLIENT_ID',type:'secret_text',text:client.client_id},
      {name:'BRIVANY_GOOGLE_WEB_CLIENT_SECRET',type:'secret_text',text:client.client_secret},
      {name:'MELODI_CALLS',type:'service',service:'brivany-calls'},
      {name:'TEAM_CONVERSATION_LEADER',type:'plain_text',text:'melodi'},
      // Nombre verificado del titular: Melodi se dirige a él por su nombre y
      // nunca por el de la aplicación.
      {name:'MELODI_OWNER_NAME',type:'plain_text',text:'Daniel'});
  }
  if(script==='brivany-site')overrides.push({name:'MELODI_WHATSAPP',type:'service',service:SCRIPT});
  if(script==='brivany-calls')overrides.push({name:'MELODI_DESKTOP',type:'service',service:SCRIPT,entrypoint:'MelodiPhoneDesktop'});
  const main=script==='brivany-site'?'worker.mjs':script===SCRIPT?'worker-main.js':'worker.js';
  const metadata=uploadMetadata(live.settings,main,overrides),bytes=await readFile(bundlePath),form=new FormData();
  form.set('metadata',JSON.stringify(metadata));form.set(main,new Blob([bytes],{type:'application/javascript+module'}),main);
  // El módulo principal puede referirse a otros módulos del mismo build, como
  // el WebAssembly del codificador de voz. Subir sólo el principal dejaría al
  // Worker sin resolverlos y fallaría al arrancar, así que se adjuntan todos
  // los que el propio bundle nombra, leídos de la carpeta del build.
  const source=bytes.toString('latin1');
  const companions=[...new Set(source.match(/[A-Za-z0-9_.-]+\.wasm/g)||[])];
  for(const name of companions){
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.wasm$/.test(name)||name.includes('..'))throw Error('unexpected_module_name');
    const modulePath=resolve(bundlePath,'..',name);
    if(!modulePath.startsWith(workspace+'\\')&&!modulePath.startsWith(workspace+'/'))throw Error('module_outside_brivany');
    const moduleBytes=await readFile(modulePath);
    form.set(name,new Blob([moduleBytes],{type:'application/wasm'}),name);
  }
  const response=await cf(`/workers/scripts/${script}?bindings_inherit=strict`,{method:'PUT',body:form});
  const result=await response.json();if(!result.success)throw Error('worker_upload_failed');
  const report={worker:script,uploadedAt:new Date().toISOString(),bundleSha256:digest(bytes),version:result.result?.version_id||result.result?.deployment_id,
    inheritedBindings:metadata.bindings.filter(b=>b.type==='inherit').length,assetsRetained:true,modules:[main,...companions],
    googleProject:script===SCRIPT?'brivany':undefined};
  await writeFile(join(location(script,revision),'deployment-report.json'),JSON.stringify(report,null,2));
  return report;
}
async function main() {
  const [action,script=SCRIPT,bundle,revision='initial']=process.argv.slice(2);
  const result=action==='snapshot'?await snapshot(script,bundle||'initial'):action==='deploy'?await deploy(script,bundle,revision):null;
  if(!result)throw Error('unsupported_release_action');
  console.log(JSON.stringify(result,null,2));
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/cloudflare-release.mjs')) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
