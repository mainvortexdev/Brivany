export const ASSISTANT_FLASH_MODEL='@cf/meta/llama-3.2-3b-instruct';
export const ASSISTANT_PRO_MODEL='@cf/deepseek-ai/deepseek-v4-pro-0813';
export const ASSISTANT_FAST_CONTEXT_MODEL='@cf/deepseek-ai/deepseek-v4.1-flash-1017';
export const assistantFlashModel=env=>env.ASSISTANT_FLASH_MODEL===ASSISTANT_FAST_CONTEXT_MODEL?ASSISTANT_FAST_CONTEXT_MODEL:ASSISTANT_FLASH_MODEL;
export const assistantNativeInferenceEnabled=env=>env.ASSISTANT_NATIVE_AI_ENABLED==='true';

function completion(result,jsonMode) {
  const content=result?.choices?.[0]?.message?.content;
  const value=typeof content==='string' ? content : result?.response ?? result?.text;
  // Deliberately never expose reasoning_content as a user answer or tool plan.
  if (jsonMode && value && typeof value==='object' && !Array.isArray(value)) return JSON.stringify(value);
  return typeof value==='string' ? value.replace(/<think>[\s\S]*?<\/think>/g,'').trim() : '';
}

/** Private assistant aliases have pinned upstream models. Existing image,
 * voice and shared Intelligence API routes remain on their current providers. */
export async function runAssistantInference(env,body,{timeoutMs=45000}={}) {
  if (!assistantNativeInferenceEnabled(env) || !['spaik-flash','spaik-pro'].includes(body?.model)) return null;
  const options=body.options || {};
  if (options.image || options.audio || options.imageUrl || options.audioBase64 || options.mode || options.output) return null;
  if (typeof env.AI?.run!=='function') throw Error('assistant_ai_binding_unavailable');
  if (typeof body.contents!=='string' || body.contents.length>150000) throw Error('assistant_text_input_invalid');
  const pro=body.model==='spaik-pro',model=pro ? ASSISTANT_PRO_MODEL : assistantFlashModel(env),deepseek=pro || model===ASSISTANT_FAST_CONTEXT_MODEL;
  const requested=Number(options.max_tokens || options.maxTokens || 1100);
  if (!Number.isInteger(requested) || requested<1 || requested>16384) throw Error('assistant_token_budget_invalid');
  const effort=pro && options.reasoningEffort==='low' ? 'low' : 'none';
  const messages=[...(options.systemPrompt ? [{role:'system',content:String(options.systemPrompt)}] : []),{role:'user',content:body.contents}];
  const input={messages,temperature:Number.isFinite(options.temperature) ? options.temperature : 0.3,
    max_tokens:pro ? Math.min(16384,requested+(effort==='low' ? 3072 : 512)) : requested,
    ...(options.jsonMode ? {response_format:{type:'json_object'}} : {}),
    ...(deepseek ? {reasoning_effort:effort,chat_template_kwargs:{enable_thinking:effort!=='none',thinking:effort!=='none',reasoning_effort:effort}} : {})};
  const started=performance.now(); let timer;
  try {
    const result=await Promise.race([
      env.AI.run(model,input),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('assistant_inference_timeout')),Math.max(1,Math.min(120000,timeoutMs)));}),
    ]);
    const resolved=result?.model || model;
    if (pro && resolved!==ASSISTANT_PRO_MODEL && resolved!=='deepseek-ai/DeepSeek-V4-Pro-0813') throw Error('assistant_pro_model_mismatch');
    if(model===ASSISTANT_FAST_CONTEXT_MODEL && ![model,'deepseek-ai/DeepSeek-V4.1-Flash-1017'].includes(resolved))throw Error('assistant_flash_model_mismatch');
    if (result?.choices?.[0]?.finish_reason==='length') throw Error('assistant_inference_truncated');
    const text=completion(result,options.jsonMode);
    if (!text) throw Error('assistant_inference_empty');
    console.log(JSON.stringify({event:'assistant_inference',alias:body.model,providerModel:resolved,
      durationMs:Math.round(performance.now()-started),purpose:options.purpose || (pro ? 'decision' : 'conversation')}));
    return {text,response:text,modelUsed:body.model,provider:'Cloudflare Workers AI',providerModel:resolved,usage:result.usage};
  } finally {clearTimeout(timer);}
}
