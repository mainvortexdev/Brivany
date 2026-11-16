import test from 'node:test';
import assert from 'node:assert/strict';
import { runAssistantInference,ASSISTANT_FLASH_MODEL,ASSISTANT_PRO_MODEL,ASSISTANT_FAST_CONTEXT_MODEL } from '../assistant-inference.js';
import { ownerAutonomyServices } from '../owner-features.js';

const body={model:'spaik-pro',contents:'Synthetic request',options:{systemPrompt:'JSON only.',jsonMode:true,max_tokens:100}};
const env={ASSISTANT_NATIVE_AI_ENABLED:'true'};
test('assistant Pro is pinned to V4 Pro with distinct reasoning controls and no shared API changes',async()=>{
  const calls=[];
  const result=await runAssistantInference({...env,AI:{async run(model,input){calls.push({model,input});return{model,choices:[{message:{content:'{"ok":true}',reasoning_content:'private deliberation'},finish_reason:'stop'}]};}}},body);
  assert.equal(calls[0].model,ASSISTANT_PRO_MODEL); assert.equal(calls[0].input.chat_template_kwargs.thinking,false);
  assert.equal(result.providerModel,ASSISTANT_PRO_MODEL); assert.equal(result.text,'{"ok":true}'); assert.doesNotMatch(JSON.stringify(result),/private deliberation/);
});
test('visible Flash uses the small Cloudflare model and forwards verified context as data',async()=>{
  let call;
  const result=await runAssistantInference({...env,AI:{async run(model,input){call={model,input};return{response:'Con gusto.'};}}},{model:'spaik-flash',contents:'Gracias',options:{max_tokens:30}});
  assert.equal(call.model,ASSISTANT_FLASH_MODEL); assert.equal(result.text,'Con gusto.'); assert.equal(call.input.max_tokens,30);
});
test('Pro orchestration services use real Pro and preserve private agent identity and tool catalog',async()=>{
  let call;
  const services=ownerAutonomyServices({...env,AI:{async run(model,input){call={model,input};return{model,response:{action:'wait'}};}}});
  const result=await services.generate('melodi',{tools:[{name:'manage_calendar'}]},'Only use permitted tools.');
  assert.equal(call.model,ASSISTANT_PRO_MODEL); assert.equal(call.input.chat_template_kwargs.thinking,true);
  assert.match(call.input.messages[0].content,/permitted tools/); assert.equal(JSON.parse(result.text).action,'wait');
});
test('unavailable, wrong-model, truncated and reasoning-only Pro responses never downgrade to Flash',async()=>{
  for(const value of [
    {model:ASSISTANT_FLASH_MODEL,response:'ok'}, {model:ASSISTANT_PRO_MODEL,choices:[{finish_reason:'length',message:{content:'{"x":'}}]},
    {model:ASSISTANT_PRO_MODEL,choices:[{message:{reasoning_content:'private'}}]},
  ]) await assert.rejects(runAssistantInference({...env,AI:{async run(){return value;}}},body),/mismatch|truncated|empty/);
  await assert.rejects(runAssistantInference(env,body),/binding_unavailable/);
});
test('legacy configuration and image and voice routes are left to their existing service',async()=>{
  let calls=0;const current={...env,AI:{async run(){calls++;}}};
  assert.equal(await runAssistantInference({},body),null);
  assert.equal(await runAssistantInference(current,{...body,model:'spaik-sight'}),null);
  assert.equal(await runAssistantInference(current,{...body,options:{mode:'tts'}}),null);
  assert.equal(calls,0);
});
test('a bounded timeout cannot return a late answer or an unhandled rejection',async()=>{
  await assert.rejects(runAssistantInference({...env,AI:{run:()=>new Promise(resolve=>setTimeout(()=>resolve({response:'late'}),30))}},body,{timeoutMs:5}),/timeout/);
});
test('the configured context model stays on Flash, disables deliberation and rejects an unexpected provider model',async()=>{
  let call;const current={...env,ASSISTANT_FLASH_MODEL:ASSISTANT_FAST_CONTEXT_MODEL,AI:{async run(model,input){call={model,input};return{model,response:{version:1,route:'reply'}};}}};
  const result=await runAssistantInference(current,{...body,model:'spaik-flash'});
  assert.equal(result.providerModel,ASSISTANT_FAST_CONTEXT_MODEL);assert.equal(call.input.reasoning_effort,'none');assert.equal(call.input.chat_template_kwargs.enable_thinking,false);
  await assert.rejects(runAssistantInference({...current,AI:{run:async()=>({model:ASSISTANT_FLASH_MODEL,response:'wrong'})}},{...body,model:'spaik-flash'}),/mismatch/);
});
