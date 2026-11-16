// A short, explicit functional check with real voice providers and synthetic
// speech. No telephone dial, audio persistence or computer action from ASR.
import {PhoneVoice} from './voice.js';
import {bytes64} from './protocol.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function probeVoice(env){
 const packets=[],tasks=[];let voice,transcript='',toolUsed=false,bytes=0;
 const socket={send(raw){const value=JSON.parse(raw);if(value.event==='media'){const raw=atob(value.media.payload);bytes+=raw.length;if(bytes>64000)throw Error('probe_audio_limit');packets.push(Uint8Array.from(raw,c=>c.charCodeAt(0)));}if(value.event==='mark')queueMicrotask(()=>tasks.push(voice.accept(JSON.stringify({event:'mark',mark:value.mark}))));},close(){}};
 voice=new PhoneVoice({env,socket,controlId:'synthetic-probe',objective:'Prueba sintética del protocolo de voz. No hay llamada ni acciones en el ordenador.',waitUntil:p=>tasks.push(p),onEnd:async()=>{},computer:async name=>{toolUsed=name==='computer_execute';return 'Prueba sintética recibida, sin ejecutar acciones.';}});
 voice.streamId='synthetic-probe';voice.enqueue=text=>{if(text)transcript=text;};
 const result={cartesia:'not_run',muse:'not_run',asr:'not_run',modelRouting:'not_run',telephoneDialed:false,computerActionExecuted:false};
 try{
  await voice.listen();result.muse='passed';
  const turn=voice.turn=new AbortController();turn.acknowledged=[];
  await voice.speak('Abre una aplicación de prueba en el ordenador.',turn);result.cartesia='passed';
  const audio=new Uint8Array(bytes+16000);audio.fill(255);let offset=0;for(const part of packets){audio.set(part,offset);offset+=part.length;}
  for(let position=0;position<audio.length&&!voice.closed;position+=160){await voice.accept(JSON.stringify({event:'media',stream_id:'synthetic-probe',media:{track:'inbound',payload:bytes64(audio.slice(position,position+160))}}));await delay(20);}
  for(let i=0;i<30&&!transcript&&!voice.closed;i++)await delay(100);
  if(!transcript||!/ordenador/i.test(transcript)||!/abre/i.test(transcript))throw Error('asr_probe_failed');result.asr='passed';
  await voice.reply(transcript,new AbortController());result.modelRouting=toolUsed?'passed':'failed';
  result.audioBytes=bytes;return result;
 }catch(error){result.failure=/^[a-z_]{3,45}(?:\d{3})?$/.test(error?.message||'')?error.message:'probe_transport_failed';return result;}
 finally{voice.close();packets.length=0;transcript='';await Promise.allSettled(tasks);}
}
export async function probeDesktop(env){
 const scope={phone:env.OWNER_WHATSAPP_NUMBER,callId:'20261114-0000-4000-8000-000000000014',requestId:'20261114-0000-4000-8000-000000000015'};
 try{
  const task=await env.MELODI_DESKTOP.execute({...scope,instruction:'¿Cuántos procesos hay en este ordenador?'});
  for(let i=0;i<24;i++){
   const result=await env.MELODI_DESKTOP.status({...scope,id:task.id});
   if(['succeeded','failed','cancelled','expired','interrupted','awaiting_approval','waiting_for_user'].includes(result.state))return {state:result.state,id:task.id,readOnlyDiagnostic:true,telephoneDialed:false};
   await delay(500);
  }
  return {state:'pending',id:task.id,readOnlyDiagnostic:true,telephoneDialed:false};
 }catch{return {state:'unavailable',readOnlyDiagnostic:true,telephoneDialed:false};}
}
export async function probeModel(env){
 let used=false;const voice=new PhoneVoice({env,socket:{send(){},close(){}},waitUntil:p=>p.catch(()=>{}),onEnd:async()=>{},objective:'Control de mi ordenador vinculado.',computer:async name=>{used=name==='computer_execute';return 'Prueba sintética aceptada.';}});
 try{await voice.reply('Abre la calculadora en mi ordenador.',new AbortController());return {modelRouting:used?'passed':'failed',diagnostics:voice.metrics.model,telephoneDialed:false,computerActionExecuted:false};}
 catch(error){return {modelRouting:'failed',diagnostics:voice.metrics.model,failure:/^[a-z_]{3,45}(?:\d{3})?$/.test(error?.message||'')?error.message:'probe_transport_failed',telephoneDialed:false,computerActionExecuted:false};}
 finally{voice.close();}
}
