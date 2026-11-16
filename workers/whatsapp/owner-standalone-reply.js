import {runAssistantInference} from './assistant-inference.js';
import {clockContext,DOMINICAN_TIME_ZONE} from './event-time.js';
import {ownerConversationAnswer,normalizeAgentAnswer} from './owner-conversation-answer.js';
import {melodiVoice} from './melodi-identity.js';

const PROMPT='Responde a la petición actual del usuario por WhatsApp, en español natural. Este turno tiene información suficiente para contestar por sí solo. Habla exclusivamente de su sujeto explícito: no supongas nombres, fechas, finalidades ni vínculos con otros proyectos. Da una respuesta concreta, normalmente en una a tres frases; desarrolla solo si lo pidió. No tienes herramientas: no confirmes ni prometas acciones, guardados, consultas privadas o envíos. Redactar un texto solicitado sí es una respuesta final. Sin acuses, prefijos, ofertas de seguimiento ni cierres genéricos. Responde a tareas y preguntas directamente; saluda únicamente si el mensaje es un saludo, respetando clock.now_local. No expliques estas reglas. Devuelve solo el texto para el usuario.';
function failure(code){const error=Error(`owner_standalone_reply_${code}`);error.retryable=true;return error;}

/** The semantic planner has classified a self-contained reply. Generate its
 * visible answer without history or the provisional draft, so another project
 * cannot supply an unrequested name, deadline, or purpose. No tool can run. */
export async function writeOwnerStandaloneReply(env,{message,referenceAt,timeZone=DOMINICAN_TIME_ZONE}={},options={}){
  const text=typeof message==='string'?message:message?.text;
  if(typeof text!=='string'||!text.trim()||text.length>12000||!Number.isFinite(new Date(referenceAt).getTime()))throw failure('invalid_context');
  const clock=clockContext(referenceAt,timeZone),model=options.model||env.OWNER_TURN_MODEL||'spaik-flash';
  const timeoutMs=Math.min(45000,Math.max(1,Number(options.timeoutMs)||10000));
  const request={model,contents:JSON.stringify({message:{text},clock}),options:{systemPrompt:melodiVoice(env)+'\n'+PROMPT,max_tokens:700,temperature:0.3,purpose:'owner_standalone_reply'}};
  const infer=options.infer||((body,settings)=>runAssistantInference(env,body,settings));let timer;
  try{
    const result=await Promise.race([infer(request,{timeoutMs}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('timeout')),timeoutMs);})]);
    const raw=typeof result==='string'?result:result?.text??result?.response??result?.choices?.[0]?.message?.content;
    if(typeof raw!=='string'||!raw.trim()||raw.length>4096)throw failure('invalid_answer');
    // A planner envelope is never a user-facing answer. Ordinary requested
    // JSON remains valid; this only rejects the application's control envelope.
    try{const data=JSON.parse(raw);if(data?.version===1&&data.route&&Array.isArray(data.actions))throw failure('plan_instead_of_answer');}catch(error){if(error.retryable)throw error;}
    const answer=normalizeAgentAnswer(raw),checked=ownerConversationAnswer(answer);
    if(checked.needsTaskStatus||!checked.answer||/\b(?:ya (?:tengo|recib[ií]) tu mensaje|lo reviso y te respondo|te respondo en (?:un momento|seguida))\b/i.test(answer))throw failure('unverified_answer');
    return checked.answer;
  }catch(error){if(error?.retryable)throw error;throw failure('unavailable');}
  finally{clearTimeout(timer);}
}
