import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../whatsapp/package.json',import.meta.url));const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild'),VOICE='10000000-0000-4000-8000-000000000001';
function wav(seconds){const b=Buffer.alloc(44+seconds*48000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
test('workerd: video prefix ASR is bounded and temporary clones/TTS/delete are scoped to their own device',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});const calls=[];
 const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'demo',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-19',bindings:{DEMO_ADMIN_TOKEN:'admin',DEMO_DATA_KEY:Buffer.alloc(32,7).toString('base64')},durableObjects:{DEMO_ACCOUNTS:{className:'DemoAccount',useSQLite:true}},outboundService:async r=>{
  const path=new URL(r.url).pathname;calls.push(path);
  if(path==='/v1/asr/transcribe'){const form=await r.formData(),settings=JSON.parse(form.get('request'));assert.equal(settings.model,'muse-voice-transcribe-1.0');assert(!settings.authorization);assert.equal((await form.get('audio').arrayBuffer()).byteLength,336044);return Response.json({turns:[]});}
  if(path==='/voices/clone'){const form=await r.formData();assert.equal(form.get('access'),'private');assert(form.get('name').startsWith('Brivany demo '));return Response.json({id:VOICE,access:'private',language:'es'});}
  if(path==='/tts/bytes'){const body=await r.json();assert.equal(body.voice.id,VOICE);return new Response(new Uint8Array(8));}
  if(path==='/voices/'+VOICE&&r.method==='DELETE')return new Response(null,{status:204});throw Error('unexpected_provider');
 }}]}));
 const json=(path,body,token='admin')=>mf.dispatchFetch('https://demo.invalid'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const multipart=async(path,form,token)=>{const request=new Request('https://demo.invalid'+path,{method:'POST',body:form});return mf.dispatchFetch(request.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':request.headers.get('Content-Type')},body:await request.arrayBuffer()});};
 try{
  await json('/admin/configure',{name:'Synthetic',invitation:'i'.repeat(43),expiresAt:Date.now()+86400000});await json('/admin/providers',{meta:'synthetic-meta-key-0123456789',cartesia:'synthetic-cartesia-key-0123456789',deepgram:'synthetic-deepgram-key-0123456789'});await json('/admin/enable',{});
  const tokens=[];for(let i=0;i<2;i++)tokens.push((await(await json('/v1/activate',{deviceId:randomUUID(),invitation:'i'.repeat(43)})).json()).token);
  const prefix=new FormData();prefix.set('request',JSON.stringify({model:'unpriced',authorization:'not-forwarded'}));prefix.set('audio',new Blob([wav(7)],{type:'audio/wav'}),'prefix.wav');
  const batch=await multipart('/proxy/meta/v1/asr/transcribe',prefix,tokens[0]);assert.equal(batch.status,200,await batch.text());
  const clone=new FormData();clone.set('name','Synthetic voice');clone.set('language','es');clone.set('access','private');clone.set('clip',new Blob([wav(10)],{type:'audio/wav'}),'voice.wav');const created=await multipart('/proxy/cartesia/voices/clone',clone,tokens[0]);assert.equal(created.status,200,await created.text());
  assert.equal((await json('/proxy/cartesia/tts/bytes',{voice:VOICE,transcript:'Synthetic'},tokens[1])).status,400);assert.equal((await json('/proxy/cartesia/tts/bytes',{voice:VOICE,transcript:'Synthetic'},tokens[0])).status,200);
  assert.equal((await mf.dispatchFetch('https://demo.invalid/proxy/cartesia/voices/'+VOICE,{method:'DELETE',headers:{Authorization:'Bearer '+tokens[1]}})).status,404);
  await json('/admin/revoke',{});assert.equal(calls.filter(p=>p==='/voices/'+VOICE).length,1);
 }finally{await mf.dispose()}
});
