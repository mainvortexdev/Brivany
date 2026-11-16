import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWhatsApp} from '../whatsapp.mjs';
import {sitePage} from '../pages.mjs';
test('the fixed WhatsApp binding forwards only the allowed route and account authorization',async()=>{
 let received;const env={MELODI_WHATSAPP:{async fetch(request){received=request;return Response.json({linked:false});}}};
 const request=new Request('https://brivany.vetsa.es/api/brivany/whatsapp/link',{method:'POST',headers:{Authorization:'Bearer synthetic-token',Cookie:'unrelated-cookie','Content-Type':'application/json'},body:'{"timeZone":"UTC"}'});
 assert.equal((await handleWhatsApp(request,env)).status,200);
 assert.equal(received.url,'https://ia.vetsa.es/api/brivany/whatsapp/link');assert.equal(received.headers.get('authorization'),'Bearer synthetic-token');assert.equal(received.headers.has('cookie'),false);assert.equal(await received.text(),'{"timeZone":"UTC"}');
});
test('unknown routes, queries, wrong methods and oversized bodies never reach the service',async()=>{
 let calls=0;const env={MELODI_WHATSAPP:{fetch(){calls++;throw Error('unexpected');}}};
 for(const path of ['/api/brivany/whatsapp/not-allowed','/api/brivany/whatsapp/number?url=https://example.com'])assert.equal((await handleWhatsApp(new Request('https://brivany.vetsa.es'+path),env)).status,404);
 assert.equal((await handleWhatsApp(new Request('https://brivany.vetsa.es/api/brivany/whatsapp/link'),env)).status,405);
 assert.equal((await handleWhatsApp(new Request('https://brivany.vetsa.es/api/brivany/whatsapp/link',{method:'POST',headers:{'Content-Type':'application/json'},body:'a'.repeat(10001)}),env)).status,413);assert.equal(calls,0);
});
test('public contact and privacy explain linking and separate cloud Google consent',()=>{
 assert.match(sitePage('/whatsapp'),/https:\/\/wa.me\/18294249873/);assert.match(sitePage('/whatsapp'),/código es personal/);
 const privacy=sitePage('/privacidad');for(const text of ['calendar.app.created','gmail.compose','D1 y R2','Desvincular WhatsApp detiene'])assert.ok(privacy.includes(text));
});
