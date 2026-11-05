import test from 'node:test';
import assert from 'node:assert/strict';
import {accountChat,readAssistant,userComputer} from '../src/account-chat.mjs';

const stream=event=>new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
function fixture(reply){const calls=[];return {calls,runtime:{fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return reply()},setTimeout,clearTimeout},identity:{key:'account',token:'fixture',devices:[{id:'one',name:'Casa',kind:'desktop',online:true},{id:'two',name:'Estudio',kind:'desktop',online:true}],hub:{async operation(key,token,action,body){calls.push({action,body});if(action==='pending')return {command:null};return {command:{id:'fixture-command',state:'needs_device',message:'¿En qué ordenador quieres que lo haga?',computers:[{id:'one',name:'Casa'},{id:'two',name:'Estudio'}]}};}}}};}
const request=()=>new Request('https://mobile.test/v1/chat',{method:'POST',body:'{}'});
test('quick public lookups skip classification, preserve the question and device selection',async()=>{
 const {readFileSync}=await import('node:fs');const {publicLookup}=await import('../src/quick-actions.mjs');
 for(const [text,expected] of JSON.parse(readFileSync(new URL('../../../tests/quick-lookup-vectors.json',import.meta.url),'utf8')))assert.equal(publicLookup(text),expected,text);
 for(const source of ['chat','voice']){
  const f=fixture(()=>{throw Error('No classification request expected')});
  const question='Puedes comprobar el clima hoy en Las Terrenas?';
  const response=await accountChat(request(),{messages:[{role:'user',content:question}],source},{META_API_KEY:'fixture'},f.runtime,f.identity);
  assert.equal(response.status,200);assert(!f.calls.some(c=>c.url));
  const command=f.calls.find(c=>c.action==='command').body;assert.equal(command.kind,'research');assert.equal(command.user_request,question);assert.equal(command.instruction,question);
 }
});
test('chat and live transcription use the same account-scoped command router',async()=>{
 for(const source of ['chat','voice']){
  const f=fixture(()=>stream({choices:[{delta:{tool_calls:[{index:0,function:{name:'control_computer',arguments:JSON.stringify({instruction:'Consulta el tiempo encendido.',kind:'terminal',computer:null})}}]},finish_reason:'tool_calls'}]}));
  const response=await accountChat(request(),{messages:[{role:'user',content:'¿Cuánto tiempo lleva encendido mi ordenador?'}],source}, {META_API_KEY:'fixture'},f.runtime,f.identity);
  const rows=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].type,'computer_choice');assert.equal(rows[1].text,'¿En qué ordenador quieres que lo haga?');
  assert.equal(f.calls.find(c=>c.action==='command').body.source,source);assert.equal(f.calls[1].body.parallel_tool_calls,false);
  assert.equal(f.calls.find(c=>c.action==='command').body.kind,'terminal');assert.equal(f.calls.find(c=>c.action==='command').body.user_request,'¿Cuánto tiempo lleva encendido mi ordenador?');
 }
});
test('ordinary conversation never creates a computer task',async()=>{
 const f=fixture(()=>stream({choices:[{delta:{content:'Podemos preparar esa idea.'},finish_reason:'stop'}]}));
 const response=await accountChat(request(),{messages:[{role:'user',content:'Ayúdame a pensar una idea.'}]},{META_API_KEY:'fixture'},f.runtime,f.identity);
 assert((await response.text()).includes('Podemos preparar'));assert(!f.calls.some(c=>c.action==='command'));
});
test('a model cannot guess a computer that the user did not select',async()=>{
 const f=fixture(()=>stream({choices:[{delta:{tool_calls:[{index:0,function:{name:'control_computer',arguments:JSON.stringify({instruction:'Abre una aplicación.',kind:'desktop',computer:'Casa'})}}]},finish_reason:'tool_calls'}]}));
 await accountChat(request(),{messages:[{role:'user',content:'Abre una aplicación en mi ordenador.'}]},{META_API_KEY:'fixture'},f.runtime,f.identity);
 assert.equal(f.calls.find(c=>c.action==='command').body.computer,null);
});
test('unrecognized or simultaneous tool calls never execute',async()=>{
 for(const calls of [[{index:0,function:{name:'arbitrary_shell',arguments:'{}'}}],[{index:0,function:{name:'control_computer',arguments:'{}'}},{index:1,function:{name:'control_computer',arguments:'{}'}}]]){
  const f=fixture(()=>stream({choices:[{delta:{tool_calls:calls},finish_reason:'tool_calls'}]}));
  await assert.rejects(accountChat(request(),{messages:[{role:'user',content:'Una acción.'}]},{META_API_KEY:'fixture'},f.runtime,f.identity));assert(!f.calls.some(c=>c.action==='command'));
 }
});
test('partial arguments are accumulated but a truncated provider stream is not executable',async()=>{
 const text='data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{name:'control_computer',arguments:'{"instruction":'}}]}}]})+'\n\n';
 await assert.rejects(readAssistant(new Response(text).body,new AbortController().signal));
});
test('explicit offline or unknown choices cannot become a different online computer',()=>{
 const computers=[{id:'id-casa',name:'Casa',online:true},{id:'id-trabajo',name:'Trabajo',online:false}];
 assert.equal(userComputer(computers,'Hazlo en Trabajo.','Casa'),'id-trabajo');
 assert.equal(userComputer(computers,'Hazlo en Oficina.','Oficina'),'Oficina');
 assert.equal(userComputer(computers,'Hazlo en mi ordenador.','Casa'),null);
 assert.equal(userComputer(computers,'El segundo.','Casa',true),'id-trabajo');
});


test('simple program openings use no provider, preserve device choice and vary acknowledgements',async()=>{
 for(const source of ['chat','voice']){
  const f=fixture(()=>{throw Error('No model is needed for a simple opening')});
  const response=await accountChat(request(),{messages:[{role:'user',content:'Abre Word por mí'}],source},{META_API_KEY:'fixture'},f.runtime,f.identity);
  const rows=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(rows[0].type,'computer_choice');assert.equal(f.calls.find(c=>c.action==='command').body.kind,'desktop');assert(!f.calls.some(c=>c.url));
 }
});

test('direct-request parsing matches desktop and excludes examples and compound actions',async()=>{
 const {readFileSync}=await import('node:fs');const {applicationTarget,acknowledgement}=await import('../src/quick-actions.mjs');
 for(const [text,target] of JSON.parse(readFileSync(new URL('../../../tests/quick-application-vectors.json',import.meta.url),'utf8')))assert.equal(applicationTarget(text),target,text);
 assert.notEqual(acknowledgement('one','word'),acknowledgement('one','word',[acknowledgement('one','word')]));
});


test('process-count questions use a direct read-only computer task without a provider',async()=>{
 const f=fixture(()=>{throw Error('No provider needed')});
 const response=await accountChat(request(),{messages:[{role:'user',content:'Cuantos procesos tengo corriendo en mi pc ahora mismo?'}]},{META_API_KEY:'fixture'},f.runtime,f.identity);
 assert.equal(response.status,200);assert.equal(f.calls.find(c=>c.action==='command').body.kind,'terminal');assert(!f.calls.some(c=>c.url));
 const {processCountQuery}=await import('../src/quick-actions.mjs');assert(!processCountQuery('Por ejemplo: cuantos procesos hay?'));
});


test('model acknowledgement is contextual and is not stored as a command instruction',async()=>{
 const acknowledgement='En un momento reviso los procesos, dame un segundo.';
 const f=fixture(()=>stream({choices:[{delta:{tool_calls:[{index:0,function:{name:'control_computer',arguments:JSON.stringify({instruction:'Revisa la RAM.',kind:'terminal',computer:null,acknowledgement})}}]},finish_reason:'tool_calls'}]}));
 const original=f.identity.hub.operation;f.identity.hub.operation=async(...args)=>{const result=await original(...args);return args[2]==='command'?{command:{...result.command,state:'offered'}}:result};
 const response=await accountChat(request(),{messages:[{role:'user',content:'Qué procesos consumen más RAM?'}]},{META_API_KEY:'fixture'},f.runtime,f.identity);const rows=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.equal(rows.find(r=>r.type==='delta').text,acknowledgement);assert(!('acknowledgement' in f.calls.find(c=>c.action==='command').body));
});
