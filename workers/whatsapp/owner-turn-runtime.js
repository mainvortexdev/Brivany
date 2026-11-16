import {planOwnerConversationTurn} from './owner-turn-planner.js';
import {ownerActionToolCatalog,executeOwnerActionPlan} from './owner-action-plan-executor.js';
import {createOwnerTurnStore} from './owner-turn-store.js';
import {renderOwnerActionResponse} from './owner-turn-response.js';
import {writeOwnerStandaloneReply} from './owner-standalone-reply.js';

/** One semantic entry point owns the visible turn. A frozen per-message plan
 * and per-action checkpoints survive retries independently of final transport.
 * The original WhatsApp scope owns the single final reply, never early acks. */
/**
 * Qué queda esperando al cerrar el turno: la pregunta que se acaba de hacer,
 * venga de una aclaración pura o de la parte incompleta de un encargo que sí
 * se ejecutó. Sin pregunta, lo que esperaba deja de esperar.
 */
export function pendingAfterTurn({plan,answer,pending}={}){
  const asked=plan?.route==='clarify'?String(answer||'').trim()
    :typeof plan?.clarification==='string'?plan.clarification.trim():'';
  if(asked)return{question:asked,clear:false};
  return{question:'',clear:pending?.type==='await_owner_turn'};
}

/**
 * El encargo que sigue vivo mientras se espera un dato. Si el turno ya venía
 * continuando otro, se conserva aquel: la aclaración no reemplaza la petición.
 */
function pendingOriginalRequest(context,incoming){
  const prior=context?.pending?.originalRequest;
  const earlier=typeof prior?.text==='string'&&prior.text.trim()?prior.text.trim():'';
  if(!earlier)return incoming;
  return earlier.includes(incoming.trim())?earlier:`${earlier}
${incoming}`.slice(0,12000);
}

export async function runOwnerConversationTurn(env,context,dependencies={}){
  const {phone,message,incoming,referenceAt,recent=[],quotedMessage=null,pending=null,activeAgent='melodi'}=context;
  const {infer,services={},servicesForAction,authorize,delegate,reply,remember,markTyping,authorizationLinks,
    render=renderOwnerActionResponse,planner=planOwnerConversationTurn}=dependencies;
  if(phone!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'') || !message?.id || typeof reply!=='function')throw Error('owner_turn_authenticated_context_required');
  const storage=dependencies.store || createOwnerTurnStore(env.VETSA_CLOUD,dependencies.crypto);
  const started=performance.now();
  const initial=await storage.load(phone,message.id,incoming);
  if(initial?.answer){
    await reply(initial.answer,{agent:initial.plan.agent});
    if(remember)await remember({agent:initial.plan.agent,message:incoming,answer:initial.answer,plan:initial.plan}).catch(()=>{
      console.error(JSON.stringify({event:'owner_turn_context_checkpoint_deferred'}));
    });
    return{handled:true,replayed:true};
  }
  if(markTyping)await markTyping();
  const toolEnv={...env};delete toolEnv.WHATSAPP_PROCESSING_SCOPE;
  if(env.WHATSAPP_PROCESSING_SCOPE){
    const heartbeat=env.WHATSAPP_PROCESSING_SCOPE.heartbeat;
    if(typeof heartbeat!=='function')throw Error('owner_turn_processing_fence_required');
    // Keep the live inbox lease fence while the finer action ledger owns its
    // receipts. This avoids the legacy inbox's resume-only shortcut after the
    // first tool, without permitting a stale consumer to execute later effects.
    toolEnv.WHATSAPP_PROCESSING_SCOPE={heartbeat,
      action:async(_key,work)=>{await heartbeat();return work();},
      reply:async()=>{throw Error('owner_turn_early_reply_blocked');}};
  }
  const executionContext={...context,env:toolEnv,normalized:incoming,agent:activeAgent};
  const catalog=ownerActionToolCatalog(executionContext,services);
  const baseInput={message:{id:message.id,text:incoming,timestamp:message.timestamp},referenceAt,timeZone:env.TIME_ZONE || 'America/Santo_Domingo',
    activeAgent,recent,quotedMessage,pending};
  let aggregate=[],aggregateActions=[],answer,finalPlan=initial?.plan,allowed=null;
  for(let phase=0;phase<3;phase++){
    const phaseId=phase?`${message.id}:phase:${phase+1}`:message.id;
    const phaseMessage={...message,id:phaseId};
    const saved=phase?await storage.load(phone,phaseId,incoming):initial;
    const allowedCatalog=phase?catalog.filter(tool=>allowed.has(tool.name)):catalog;
    let plan=saved?.plan;
    if(!plan){
      const input={...baseInput,message:{...baseInput.message,id:phaseId},...(phase?{
        observations:aggregate,completedActions:aggregate.filter(item=>['observed','committed','accepted','running'].includes(item.state)).map(item=>({id:item.id,tool:item.tool,input:item.input})),
      }:{})};
      // Reading source data and interpreting a requested change is a different
      // task from conversational routing. Use the stronger model for every
      // follow-up, under the same frozen authority and tool scope.
      const followUp=phase?{model:env.OWNER_TURN_FOLLOWUP_MODEL||'spaik-pro',timeoutMs:45000}:{};
      try{plan=await planner(env,input,{infer,catalog:allowedCatalog,executionContext,services,...followUp,...(env.VETSA_OWNER_INLINE_PLAN_ONLY?{timeoutMs:8000}:{})});}
      catch(error){
        if(env.VETSA_OWNER_INLINE_PLAN_ONLY || !error.retryable || env.OWNER_TURN_PRO_FALLBACK==='false')throw error;
        console.error(JSON.stringify({event:'owner_turn_model_fallback',phase:phase+1}));
        plan=await planner(env,input,{infer,catalog:allowedCatalog,executionContext,services,model:'spaik-pro',timeoutMs:45000});
      }
      if(env.WHATSAPP_PROCESSING_SCOPE)await env.WHATSAPP_PROCESSING_SCOPE.heartbeat();
      plan=(await storage.savePlan(phone,phaseId,incoming,plan)).plan;
    }
    if(env.WHATSAPP_PROCESSING_SCOPE)await env.WHATSAPP_PROCESSING_SCOPE.heartbeat();
    finalPlan=plan;
    if(env.VETSA_OWNER_INLINE_PLAN_ONLY && (!['reply','clarify'].includes(plan.route)
      ||Date.now()-Number(env.VETSA_MESSAGE_RECEIVED_AT)>12000))return{handoff:true};
    if(!phase)allowed=new Set([...plan.actions.map(action=>action.tool),...(plan.followUpTools || [])]);
    else if(plan.actions.some(action=>!allowed.has(action.tool)))throw Error('owner_turn_followup_authority_changed');
    if(['reply','clarify'].includes(plan.route)){
      // A later conversational response may describe read data, but cannot
      // replace the durable confirmations from an earlier execution phase.
      if(!aggregate.length || !aggregate.some(item=>['committed','accepted','running'].includes(item.state))){
        answer=plan.answer;
        if(!phase&&plan.route==='reply'&&plan.contextRelation==='new_topic'&&recent.length){
          const current={message:incoming,referenceAt,timeZone:baseInput.timeZone};
          try{answer=await writeOwnerStandaloneReply(env,current,{infer,timeoutMs:env.VETSA_OWNER_INLINE_PLAN_ONLY?8000:10000});}
          catch(error){
            if(env.VETSA_OWNER_INLINE_PLAN_ONLY||!error.retryable||env.OWNER_TURN_PRO_FALLBACK==='false')throw error;
            answer=await writeOwnerStandaloneReply(env,current,{infer,model:'spaik-pro',timeoutMs:45000});
          }
        }
      }
      break;
    }
    if(plan.route==='delegate'){
      if(phase || typeof delegate!=='function')throw Error('owner_turn_delegate_unavailable');
      const checkpoint=storage.actions(phone,phaseId),action={id:'legacy',tool:plan.legacy.intent};
      const prior=await checkpoint.loadActionResult(action.id);
      if(prior?.data?.answer){answer=prior.data.answer;break;}
      if(prior){answer='No pude confirmar el resultado de esa acción. No la he repetido para evitar duplicarla.';break;}
      await checkpoint.onActionStarted(action);
      let result;
      try{result=await delegate(plan,{...executionContext,message:phaseMessage});}
      catch{
        await checkpoint.onActionResult(action,{...action,state:'uncertain',error:'delegated_action_pending_verification'});
        answer='No pude confirmar el resultado de esa acción. No la he repetido para evitar duplicarla.';break;
      }
      if(result?.handled===true)return result;
      if(typeof result?.answer==='string' && result.answer.trim()){
        answer=result.answer;await checkpoint.onActionResult(action,{...action,state:'committed',data:{answer}});break;
      }
      if(result?.results)aggregate.push(...result.results);
      else throw Error('owner_turn_delegate_unconfirmed');
      break;
    }
    // A numerical deadline check cannot alter intent or attach a different day.
    // Keep the entire requested batch while asking only for an elapsed item.
    const elapsed=plan.actions.flatMap(action=>action.tool==='calendar.create_events'?action.input.events:[]).find(event=>Date.parse(event.eventAt)<=Date.now());
    if(elapsed){answer=`La hora de «${elapsed.title}» ya pasó. ¿Para qué día quieres dejar esa actividad?`;finalPlan={...plan,route:'clarify'};break;}
    const authorityText=pending?.originalRequest?`${pending.originalRequest.text}\n${incoming}`:undefined;
    if(plan.authorityText && plan.authorityText!==authorityText)throw Error('owner_turn_pending_authority_changed');
    const checkpoint=storage.actions(phone,phaseId);
    const fenced=operation=>async(...args)=>{if(env.WHATSAPP_PROCESSING_SCOPE)await env.WHATSAPP_PROCESSING_SCOPE.heartbeat();return operation(...args);};
    const result=await executeOwnerActionPlan(plan,{...executionContext,authorityText,priorResults:aggregate,message:phaseMessage,agent:plan.agent},{services,servicesForAction,authorize,
      loadActionResult:checkpoint.loadActionResult,onActionStarted:fenced(checkpoint.onActionStarted),onActionResult:fenced(checkpoint.onActionResult)});
    aggregateActions.push(...plan.actions.map(action=>({...action,id:`p${phase+1}_${action.id}`})));
    aggregate.push(...result.results.map(item=>({...item,id:`p${phase+1}_${item.id}`,phase:phase+1,input:plan.actions.find(action=>action.id===item.id)?.input})));
    // No matching source means there is nothing to update or cancel. Do not
    // ask a model to manufacture an event ID or a replacement creation.
    if(result.results.length&&result.results.every(item=>item.tool==='calendar.search'&&item.state==='observed'&&!item.data.matches.length)
      &&plan.followUpTools?.length&&plan.followUpTools.every(name=>['calendar.update_event','calendar.cancel_event'].includes(name)))break;
    const needsFollowup=result.results.some(item=>item.state==='observed') && (plan.followUpTools || []).length>0
      && !result.results.some(item=>['failed','blocked','uncertain'].includes(item.state));
    if(!needsFollowup)break;
  }
  if(!answer){
    const needsAuthorization=[...new Set(aggregate.filter(item=>/authorization_required|not_connected/.test(item.error || ''))
      .map(item=>item.tool.split('.')[0]).filter(service=>['gmail','drive'].includes(service)))];
    let authLinks=[];
    if(needsAuthorization.length && authorizationLinks)authLinks=await authorizationLinks(needsAuthorization).catch(()=>[]);
    answer=await render(env,{message:incoming,plan:{...finalPlan,actions:aggregateActions},outcome:{results:aggregate,
      status:aggregate.some(item=>['failed','blocked','uncertain'].includes(item.state))?'partial':'committed'},authLinks,recent,referenceAt,timeZone:baseInput.timeZone},{infer});
  }
  if(env.WHATSAPP_PROCESSING_SCOPE)await env.WHATSAPP_PROCESSING_SCOPE.heartbeat();
  // Una respuesta entregada por voz no deja texto que enviar; repetirla por
  // escrito sobra. Lo dicho sí se guarda, para que el hilo conserve el tema.
  const spoken=answer?'':aggregateActions.find(action=>action.tool==='message.voice_note'
    && aggregate.some(item=>item.id===action.id && item.state==='committed'))?.input?.text||'';
  await storage.saveAnswer(phone,message.id,incoming,answer||spoken);
  // Una pregunta sin el encargo detrás obliga al titular a repetirlo todo. Se
  // conserva lo que se preguntó y el mensaje original, de modo que su respuesta
  // llegue como continuación y se ejecute en vez de volver a preguntar.
  const nextPending=pendingAfterTurn({plan:finalPlan,answer,pending});
  if(typeof services.setOwnerSession==='function'){
    try{
      if(nextPending.question)await services.setOwnerSession(env,phone,'await_owner_turn',{question:nextPending.question,
        originalRequest:{text:pendingOriginalRequest(context,incoming),messageId:message.id,referenceAt}});
      else if(nextPending.clear&&typeof services.clearOwnerSession==='function')await services.clearOwnerSession(env,phone);
    }catch{console.error(JSON.stringify({event:'owner_turn_pending_not_saved'}));}
  }
  if(answer)await reply(answer,{agent:finalPlan.agent});
  if(remember)await remember({agent:finalPlan.agent,message:incoming,answer:answer||spoken,plan:finalPlan}).catch(()=>{
    console.error(JSON.stringify({event:'owner_turn_context_checkpoint_deferred'}));
  });
  console.log(JSON.stringify({event:'owner_turn_completed',route:finalPlan.route,actions:aggregate.length,durationMs:Math.round(performance.now()-started)}));
  return{handled:true};
}
