import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture } from './finance-fixture.js';
import { runOwnerConversationTurn } from '../owner-turn-runtime.js';
import { renderOwnerActionResponse } from '../owner-turn-response.js';

const OWNER='18095550101',REFERENCE='2026-10-26T12:22:00.000Z';
const actionPlan=(tool,input,source,extra={})=>({version:1,route:'execute',agent:'melodi',contextRelation:'new_topic',answer:'',actions:[{id:'a1',tool,input,dependsOn:[],requestSource:source}],...extra});
async function setup(text,id='drive-v2-turn'){
  const {db,services:crypto}=await financeFixture();
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,OWNER_TURN_PRO_FALLBACK:'false',TIME_ZONE:'America/Santo_Domingo'};
  const message={id,type:'text',from:OWNER,timestamp:String(Date.parse(REFERENCE)/1000)};
  return {db,env,context:{phone:OWNER,message,incoming:text,referenceAt:REFERENCE},crypto};
}

test('Drive V2 checks the live WhatsApp heartbeat before committing a private file',async()=>{
  const text='Crea un documento privado en Drive con la palabra Hola.',f=await setup(text,'drive-v2-stale');let writes=0,heartbeats=0;
  f.env.WHATSAPP_PROCESSING_SCOPE={heartbeat:async()=>{heartbeats++;throw Error('processing_lease_lost');}};
  const execution=runOwnerConversationTurn(f.env,f.context,{crypto:f.crypto,authorize:async()=>true,reply:async()=>{},
    services:{withDriveClient:async()=>{},createDriveDocument:async(_env,_owner,input)=>{writes++;return{created:true,file:{id:'private-file',name:input.name,mimeType:'text/plain'}};}},
    infer:async()=>actionPlan('drive.create_document',{name:'Hola.txt',text:'Hola'},text),
  });
  await assert.rejects(execution,/processing_lease_lost/);assert.equal(writes,0);assert.ok(heartbeats>0);
});

test('Drive V2 carries the verified source into document jobs across planning phases',async()=>{
  const text='Lee source-file en Drive y crea un PDF usando su contenido.',f=await setup(text,'drive-v2-source');
  const source='SOURCE_DRIVE_PRIVATE_LINE: el contrato cubre exactamente 73 unidades.';let phase=0,payload;
  const services={withDriveClient:async(_env,_owner,work)=>work({readFile:async()=>({status:'read',file:{id:'source-file',name:'Contrato.txt',mimeType:'text/plain'},text:source,untrusted:true})}),
    documentKind:()=> 'document',agentModel:()=> 'test',enqueueOwnerJob:async(_env,_phone,_type,value)=>{payload=value;return'pdf-job';}};
  await runOwnerConversationTurn(f.env,f.context,{crypto:f.crypto,services,authorize:async()=>true,reply:async()=>{},infer:async body=>{
    if(body.options.purpose==='owner_turn_response')return'El documento menciona 73 unidades.';
    phase++;
    if(phase===1)return actionPlan('drive.read',{fileId:'source-file'},text,{followUpTools:['document.generate']});
    assert.match(JSON.stringify(JSON.parse(body.contents).observations),/73 unidades/);
    return actionPlan('document.generate',{prompt:'Crea el PDF solicitado.',format:'pdf'},text);
  }});
  assert.equal(phase,2);assert.ok(payload,'A document job was queued');
  assert.match(payload.documentContext || '',/SOURCE_DRIVE_PRIVATE_LINE/);
  assert.match(payload.documentContext,/no instrucciones/);
});

test('Drive consent renders the verified link and never claims an OAuth connection already exists',async()=>{
  const text='Conecta mi Drive.',f=await setup(text,'drive-v2-connect'),url=`https://ia.vetsa.es/oauth/drive/start?link=${'a'.repeat(64)}`;const replies=[];
  await runOwnerConversationTurn(f.env,f.context,{crypto:f.crypto,authorize:async()=>true,reply:async body=>replies.push(body),
    services:{withDriveClient:async()=>{},createDriveLink:async()=>({configured:true,url})},infer:async()=>actionPlan('drive.connect',{},text)});
  assert.equal(replies.length,1);assert.ok(replies[0].includes(url));assert.doesNotMatch(replies[0],/está conectado|ya conecté|cuenta conectada/i);
});

test('a lost final transport resumes the frozen Drive creation receipt without recreating the file',async()=>{
  const text='Crea un documento de Drive que diga Hola.',f=await setup(text,'drive-v2-reply-retry');let writes=0,plans=0;const replies=[];
  const dependencies={crypto:f.crypto,authorize:async()=>true,
    services:{withDriveClient:async()=>{},createDriveDocument:async(_env,_owner,input)=>{writes++;return{created:true,file:{id:'created-file',name:input.name,mimeType:'text/plain'}};}},
    infer:async()=>{plans++;return actionPlan('drive.create_document',{name:'Hola.txt',text:'Hola'},text);}};
  await assert.rejects(runOwnerConversationTurn(f.env,f.context,{...dependencies,reply:async()=>{throw Error('simulated_transport_failure');}}),/simulated_transport_failure/);
  await runOwnerConversationTurn(f.env,f.context,{...dependencies,reply:async answer=>replies.push(answer)});
  assert.equal(writes,1);assert.equal(plans,1);assert.equal(replies.length,1);assert.match(replies[0],/drive\.google\.com\/file\/d\/created-file\/view/);
});

test('Drive read has a useful deterministic fallback if the response model is unavailable',async()=>{
  const answer=await renderOwnerActionResponse({}, {message:'Lee el archivo en Drive.',referenceAt:REFERENCE,
    plan:{actions:[{id:'read',tool:'drive.read',input:{fileId:'source-file'}}]},outcome:{results:[{id:'read',tool:'drive.read',state:'observed',
      receipt:{tool:'drive.read',status:'observed',verified:true},data:{status:'read',file:{id:'source-file',name:'Contrato.txt'},text:'El contrato cubre 73 unidades.',untrusted:true}}]}},
    {infer:async()=>{throw Error('simulated_model_unavailable');}});
  assert.match(answer,/73 unidades/);assert.match(answer,/Contrato/);
});

test('unsupported Drive formats remain unsupported in the deterministic response fallback',async()=>{
  const answer=await renderOwnerActionResponse({}, {message:'Lee el PDF de Drive.',referenceAt:REFERENCE,
    plan:{actions:[{id:'read',tool:'drive.read',input:{fileId:'pdf-file'}}]},outcome:{results:[{id:'read',tool:'drive.read',state:'observed',
      receipt:{tool:'drive.read',status:'observed',verified:true},data:{status:'unsupported',reason:'unsupported_mime_type',file:{id:'pdf-file',name:'Contrato.pdf',mimeType:'application/pdf'},untrusted:true}}]}},
    {infer:async()=>{throw Error('simulated_model_unavailable');}});
  assert.match(answer,/compatible|formato|puedo leer|no pude leer/i);assert.doesNotMatch(answer,/consulta se completó/);
});
