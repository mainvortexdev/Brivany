import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopMediaRequest} from '../desktop-media.js';
import {stacy_screenshot} from '../executors/desktop.js';
import {handleOwnerMessage} from '../owner-features.js';

test('explicit video and bounded campaign requests bypass the reminder classifier', () => {
  assert.equal(desktopMediaRequest('Edita este video con Melodi', 'video').desktopVideo, true);
  for (const text of ['Dile a Melodi que me esté mandando durante el día y hasta mañana diseños para las historias de instagram', 'Envíame historias de instagram durante el día sobre Melodi y Cognira']) {
    const request = desktopMediaRequest(text);
    assert.equal(request.intent, 'stacy_command');
    assert.equal(request.stacyInstruction, text);
    assert.equal(request.returnArtifact, false);
  }
  for (const text of ['Recuérdame editar este video con Melodi', 'No edites este video con Melodi', 'Recuérdame enviar historias durante el día sobre Melodi', 'Ayer edité este video con Melodi', 'Edité este video con Melodi', 'Hoy mandamos historias de Melodi durante el día']) assert.equal(desktopMediaRequest(text, 'video'), null);
});

test('the exact screenshot caption reaches desktop dispatch without either model classifier',async()=>{
 const replies=[];
 const env={VETSA_CLOUD:{prepare(sql){return {bind(){return {first:async()=>sql.includes('FROM stacy_devices')?{device_name:'PC',status:'offline'}:null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};}};}},VETSA_INTELLIGENCE:{fetch:()=>assert.fail('Explicit editing must not need reminder classification')}};
 await handleOwnerMessage(env,{phone:'owner',message:{type:'video',id:'message',video:{id:'media'}},incoming:'Edita este video con Melodi',markTyping:async()=>{},sendText:async(_env,_phone,text)=>replies.push(text),addReminder:()=>assert.fail('Not a reminder')});
 assert.match(replies[0],/No estoy conectada/);
 assert.doesNotMatch(replies[0],/recordatorio/);
});

test('caption and media traverse the owner handler into the desktop command together',async()=>{
 const fetcher=globalThis.fetch,replies=[],stored=new Map();let queued;
 const env={MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),WHATSAPP_TOKEN:'test-token',VETSA_CLOUD:{prepare(sql){return {bind(...args){return {
  first:async()=>sql.includes('FROM stacy_devices')?{device_id:'pc',device_name:'PC',status:'online',last_seen:new Date().toISOString()}:null,
  all:async()=>({results:[]}),run:async()=>{if(sql.includes('INSERT INTO stacy_commands'))queued=args;return {meta:{changes:1}};}
 };}};}},VETSA_MEDIA:{put:async(key,body)=>{stored.set(key,await new Response(body).arrayBuffer());}},VETSA_INTELLIGENCE:{fetch:()=>assert.fail('No model routing needed')}};
 try{
  globalThis.fetch=async url=>String(url).includes('graph.facebook.com')?Response.json({url:'https://media.test/video',file_size:3,mime_type:'video/mp4'}):new Response(new Uint8Array([1,2,3]));
  await handleOwnerMessage(env,{phone:'owner',message:{type:'video',id:'message',video:{id:'media'}},incoming:'Edita este video con Melodi',markTyping:async()=>{},sendText:async(_env,_phone,text)=>replies.push(text),addReminder:()=>assert.fail('Not a reminder')});
  assert.equal(queued[3],'instruction');assert.equal(queued[4],'Edita este video con Melodi');
  const payload=JSON.parse(queued[5]);assert.equal(payload.returnArtifact,true);assert.ok(stored.has(payload.sourceVideo.objectKey));assert.match(replies[0],/Recibí la tarea/);
 }finally{globalThis.fetch=fetcher;}
});

test('video executor queues the stored video and requests the finished artifact', async () => {
  let command;
  await stacy_screenshot({interpretation:desktopMediaRequest('Edita este video con Melodi','video'), env:{}, phone:'owner', normalized:'Edita este video con Melodi', descriptor:{kind:'video'}, message:{video:{id:'incoming'}}, reply:async()=>{}}, {
    findOwnerDevice:async()=>({device_id:'pc'}), isStacyOnline:()=>true,
    storeIncomingMedia:async(_env,_phone,message)=>{assert.equal(message.video.id,'incoming');return {objectKey:'melodi-private/owner/video',mimeType:'video/mp4'};},
    createStacyCommand:async(...args)=>{command=args;return 'job';},
  });
  assert.equal(command[3],'instruction');
  assert.equal(command[5].sourceVideo.objectKey,'melodi-private/owner/video');
  assert.equal(command[5].referenceImage,undefined);
  assert.equal(command[5].returnArtifact,true);
});

test('staged videos are used; missing video never queues a fake editing task', async () => {
  for (const stagedVideo of [undefined,{objectKey:'melodi-private/owner/video',mimeType:'video/mp4'}]) {
    let queued=false;
    await stacy_screenshot({interpretation:desktopMediaRequest('Edita este video con Melodi'),env:{},phone:'owner',normalized:'Edita este video con Melodi',stagedVideo,reply:async()=>{}}, {
      findOwnerDevice:async()=>({device_id:'pc'}),isStacyOnline:()=>true,
      createStacyCommand:async(...args)=>{queued=true;assert.deepEqual(args[5].sourceVideo,stagedVideo);return 'job';},
    });
    assert.equal(queued,Boolean(stagedVideo));
  }
});
