import {createWhatsAppProcessing} from './whatsapp-processing.js';

export async function runWhatsAppAction(env,key,work) {
  return env.WHATSAPP_PROCESSING_SCOPE ? env.WHATSAPP_PROCESSING_SCOPE.action(key,work) : work();
}

/** One request-local ledger. Never put a claim on a shared env or a global. */
export async function processWhatsAppEnvelope(env,payload,process,sendRaw,services) {
  if(env.TEAM_CONVERSATION_LEADER!=='melodi') {await process(env,payload);return {status:'done'};}
  const value=payload?.entry?.[0]?.changes?.[0]?.value,message=value?.messages?.[0];
  const owner=String(message?.from || '');
  if(value?.metadata?.phone_number_id!==env.WHATSAPP_PHONE_NUMBER_ID || !/^\d{8,15}$/.test(owner)
    || typeof message?.id!=='string' || !message.id || message.id.length>300) return {status:'ignored'};
  const inbox=createWhatsAppProcessing(env.VETSA_CLOUD,services);
  await inbox.ensureSchema();
  const serializeOwner=env.OWNER_TURN_RUNTIME_ENABLED==='true' && owner===String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  const claim=await inbox.begin({owner,messageId:message.id,serializeOwner});
  if(claim.action==='busy') return {status:'busy',retry:true,retryAfterMs:claim.retryAfterMs,...(claim.status==='waiting_for_owner_turn'?{waitingForOwner:true}:{})};
  if(['done','legacy','uncertain'].includes(claim.action)) return {status:claim.action};
  if(Number.isSafeInteger(env.VETSA_MESSAGE_RECEIVED_AT)&&env.VETSA_MESSAGE_RECEIVED_AT<=Date.now())console.log(JSON.stringify({event:'whatsapp_request_started',
    sinceIngressMs:Date.now()-env.VETSA_MESSAGE_RECEIVED_AT,entryMode:env.VETSA_OWNER_INLINE_PLAN_ONLY?'inline':'queue'}));
  let responseIndex=0,actionIndex=0;
  const ensure=async()=>{if(!await inbox.heartbeat(claim))throw Error('processing_lease_lost');};
  const scope={
    heartbeat:ensure,
    async action(key,work) {
      await ensure();
      const effectKey=`action:${actionIndex++}:${key}`;
      if(!(await inbox.markExternalEffect({...claim,effectKey,phase:'started',kind:'action'})).allowed) throw Error('processing_action_not_owned');
      const result=await work();
      const receipt={status:result?.status || 'accepted',...(typeof result==='string'?{id:result.slice(0,180)}:{}),
        ...(result?.jobId?{jobId:result.jobId}:{}),...(result?.taskId?{taskId:result.taskId}:{}),...(result?.eventId?{eventId:result.eventId}:{}),...(result?.id?{id:result.id}:{})};
      if(!(await inbox.markExternalEffect({...claim,effectKey,phase:'confirmed',kind:'action',receipt})).allowed) throw Error('processing_receipt_not_owned');
      return result;
    },
    async reply(phone,body,options={}) {
      if(phone!==owner) throw Error('processing_reply_owner_mismatch');
      await ensure();
      const response={body:String(body).slice(0,4096),agent:options.agent || 'melodi'};
      if(responseIndex===0 && claim.action==='process') await inbox.saveResponse({...claim,response});
      const effectKey=`reply:${responseIndex++}`;
      if(!(await inbox.markExternalEffect({...claim,effectKey,kind:'response',phase:'started'})).allowed) throw Error('processing_reply_not_owned');
      const result=await sendRaw(env,phone,response.body,{...options,agent:response.agent});
      if(!result?.messageId) throw Error('processing_send_receipt_missing');
      if(!(await inbox.markExternalEffect({...claim,effectKey,kind:'response',phase:'confirmed',receipt:{status:'sent',messageId:result.messageId}})).allowed) throw Error('processing_send_receipt_not_owned');
      return result;
    },
  };
  try {
    if(claim.action==='resume') {
      if(!claim.effects.some(effect=>effect.kind==='response'&&effect.status==='confirmed') && claim.response) {
        await scope.reply(owner,claim.response.body,{agent:claim.response.agent});
      }
    } else {
      await env.VETSA_CLOUD.prepare('INSERT OR IGNORE INTO wa_messages(message_id,received_at) VALUES(?,?)').bind(message.id,new Date().toISOString()).run();
      const result=await process({...env,WHATSAPP_PROCESSING_SCOPE:scope},payload);
      if(result?.handoff===true){
        if(!await inbox.handoff(claim))throw Error('processing_handoff_not_owned');
        return{status:'deferred',retry:true};
      }
    }
    if(!await inbox.finish(claim))throw Error('processing_finish_not_owned');
    return{status:'done'};
  } catch {
    const failure=await inbox.fail({...claim,code:'incoming_processing_failed'});
    console.error(JSON.stringify({event:'whatsapp_processing_failed',state:failure.status,retry:failure.retry}));
    return{status:failure.status,retry:failure.retry};
  }
}
