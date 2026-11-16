import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';import {fileURLToPath}from'node:url';import {randomUUID}from'node:crypto';
import {provisionTelnyx} from '../phone.mjs';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
test('real workerd: API + number provisions separate Telnyx connections without dialing or borrowing another device credentials',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const admin='admin-'+randomUUID(),setup='setup-'+randomUUID(),invitation='invite-'+randomUUID(),profiles=new Map(),apps=new Map(),requests=[];let sequence=100;
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:admin,DEMO_SETUP_TOKEN:setup,DEMO_DATA_KEY:Buffer.alloc(32,3).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true},DEMO_PHONES:{className:'DemoPhone',useSQLite:true}},outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.hostname,'api.telnyx.com');const path=url.pathname.replace('/v2',''),method=request.method,key=request.headers.get('Authorization');requests.push({path,method,key});assert(!path.startsWith('/calls'),'Test must never dial');let data;
  if(path==='/phone_numbers')data=[{phone_number:'+34111111111',status:'active'},{phone_number:'+34222222222',status:'active'}];
  else if(path==='/verified_numbers')data=[];
  else if(path==='/public_key')data={public:Buffer.alloc(32,4).toString('base64')};
  else if(path==='/outbound_voice_profiles'&&method==='GET')data=[...profiles.values()].filter(p=>p.owner===key);
  else if(path==='/call_control_applications'&&method==='GET')data=[...apps.values()].filter(p=>p.owner===key);
  else if(path.startsWith('/outbound_voice_profiles')&&method==='POST'){data={...await request.json(),id:String(sequence++),owner:key};profiles.set(data.id,data);assert.deepEqual(data.whitelisted_destinations,['ES']);assert.equal(data.daily_spend_limit,'1.00');}
  else if(path.startsWith('/call_control_applications')&&method==='POST'){data={...await request.json(),id:String(sequence++),owner:key};apps.set(data.id,data);}
  else if(path.startsWith('/call_control_applications/')&&method==='GET')data=apps.get(path.split('/').at(-1));
  else assert.fail('Unexpected Telnyx mutation: '+method+' '+path);
  return Response.json({data});
 }}]}));
 const send=(path,body,token)=>mf.dispatchFetch('https://demo.invalid'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await send('/admin/configure',{name:'Simulated team',invitation,expiresAt:Date.now()+86400000},admin)).status,200);
  assert.equal((await send('/admin/providers',{meta:'synthetic-meta-'.repeat(3),cartesia:'synthetic-cartesia-'.repeat(3),deepgram:'synthetic-deepgram-'.repeat(3)},setup)).status,200);assert.equal((await send('/admin/enable',{},admin)).status,200);
  const deviceA=randomUUID(),deviceB=randomUUID(),a=await(await send('/v1/activate',{deviceId:deviceA,invitation})).json(),b=await(await send('/v1/activate',{deviceId:deviceB,invitation})).json();
  const keyA='KEY'+'a'.repeat(40),keyB='KEY'+'b'.repeat(40);
  assert.equal((await send('/v1/telnyx/connect',{api_key:keyA,from_number:'+34999999999'},a.token)).status,400);assert.equal(profiles.size,0);
  const connectedA=await send('/v1/telnyx/connect',{api_key:keyA,from_number:'+34111111111'},a.token);assert.equal(connectedA.status,200,(await connectedA.clone().text())+' requests='+JSON.stringify(requests));const infoA=await connectedA.json();assert.equal(infoA.configured,true);assert(!JSON.stringify(infoA).includes(keyA));
  assert.equal((await(await send('/v1/telnyx/status',undefined,b.token)).json()).configured,false);
  const connectedB=await send('/v1/telnyx/connect',{api_key:keyB,from_number:'+34222222222'},b.token);assert.equal(connectedB.status,200);
  assert.equal((await(await send('/v1/telnyx/status',undefined,a.token)).json()).from_number,'+34111111111');
  assert.equal(profiles.size,2);assert.equal(apps.size,2);
  const id=randomUUID(),request={id,to:'+34333333333',objective:'Synthetic scheduled test',confirmed:true,due_at:Date.now()+600000};
  assert.equal((await send('/v1/calls',{...request,confirmed:false},a.token)).status,400);
  assert.equal((await send('/v1/calls',request,a.token)).status,200);
  assert.equal((await(await send('/v1/calls',undefined,a.token)).json()).calls.length,1);assert.equal((await(await send('/v1/calls',undefined,b.token)).json()).calls.length,0);
  assert.equal((await send('/v1/calls/'+id+'/cancel',{},b.token)).status,404);
  assert.equal((await send('/admin/revoke',{},admin)).status,200);assert(!requests.some(r=>r.path==='/calls'));
 }finally{await mf.dispose()}
});
