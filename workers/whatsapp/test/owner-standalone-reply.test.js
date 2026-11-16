import test from 'node:test';
import assert from 'node:assert/strict';
import {writeOwnerStandaloneReply} from '../owner-standalone-reply.js';
const current={message:'Piensa en un nombre para una app de boxeo',referenceAt:'2026-10-27T00:37:00.000Z',timeZone:'America/Santo_Domingo'};

test('a standalone answer receives only the current message and trusted local clock',async()=>{
  const answer=await writeOwnerStandaloneReply({}, {...current,recent:[{content:'Brivana, hackatón, datos privados'}],draft:'Para Brivana'}, {infer:async(request,settings)=>{
    const data=JSON.parse(request.contents);assert.deepEqual(Object.keys(data).sort(),['clock','message']);assert.deepEqual(data.message,{text:current.message});
    assert.equal(data.clock.now_local,'2026-10-26T20:37');assert.doesNotMatch(request.contents,/Brivana|hackatón|datos privados/);
    assert.equal(request.options.purpose,'owner_standalone_reply');assert.equal(request.model,'spaik-flash');assert.equal(settings.timeoutMs,10000);
    assert.equal(Object.hasOwn(request,'tools'),false);assert.equal(Object.hasOwn(request,'jsonMode'),false);
    return{text:'Melodi: «Guardia» es corto y conecta con el boxeo.'};
  }});
  assert.equal(answer,'«Guardia» es corto y conecta con el boxeo.');
});

test('an explicitly named project stays available because it comes from the current owner message',async()=>{
  const text='Quiero llamar Brivana a mi app de boxeo, ¿qué opinas?';
  assert.equal(await writeOwnerStandaloneReply({}, {...current,message:text},{infer:async request=>{
    assert.equal(JSON.parse(request.contents).message.text,text);return'Brivana tiene sonido de marca y puede funcionar.';
  }}),'Brivana tiene sonido de marca y puede funcionar.');
});

test('draft text and ordinary requested JSON remain valid text deliverables without tools',async()=>{
  for(const answer of ['Hola, Alfredo: nos vemos el domingo a las cinco.','{"nombre":"Guardia","categoria":"boxeo"}'])
    assert.equal(await writeOwnerStandaloneReply({},current,{infer:async()=>answer}),answer);
});

test('control envelopes, empty acknowledgements and unverified execution claims are rejected',async()=>{
  for(const answer of ['',JSON.stringify({version:1,route:'reply',answer:'Para Brivana',actions:[]}), 'Ya tengo tu mensaje. Lo reviso y te respondo.', 'Ya envié el correo.', 'He guardado el evento en tu calendario.'])
    await assert.rejects(writeOwnerStandaloneReply({},current,{infer:async()=>answer}),error=>error.retryable===true&&error.message.startsWith('owner_standalone_reply_'));
});

test('provider failures cannot expose a previous draft and remain retryable',async()=>{
  await assert.rejects(writeOwnerStandaloneReply({}, {...current,draft:'Para Brivana, algo del hackatón'},{infer:async()=>{throw Error('synthetic_provider_error');}}),error=>error.retryable===true&&error.message==='owner_standalone_reply_unavailable');
});

test('inference has a bounded deadline and invalid input never reaches a provider',async()=>{
  await assert.rejects(writeOwnerStandaloneReply({},current,{timeoutMs:5,infer:async()=>new Promise(resolve=>setTimeout(()=>resolve('Respuesta tardía'),20))}),/owner_standalone_reply_timeout/);
  for(const input of [{...current,message:''},{...current,referenceAt:'not-a-date'},{...current,message:'x'.repeat(12001)}])
    await assert.rejects(writeOwnerStandaloneReply({},input,{infer:async()=>assert.fail('invalid context must not infer')}),/invalid_context/);
});
