import {runExecutor} from './executors/index.js';
import {continueDocumentDelivery,continueDocumentTemplate} from './executors/documents.js';
import {continueReminderRecipient,continueReminderAttachment} from './executors/calendar.js';
import {continueRetrieval,continueMemoryCapture} from './executors/memory.js';
import {agentEmailIdentity,agentForEmail} from './melodi-email-identity.js';

const text=maxLength=>({type:'string',minLength:1,maxLength});
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const recipient={recipientEmail:text(254),recipientName:text(180),recipientSelf:{type:'boolean'}};
const protocols=Object.freeze({
  await_document_recipient:'document.continue',document_template:'document.continue',
  await_email_delivery:'email.continue',
  await_reminder_recipient:'calendar.continue',await_reminder_attachment:'calendar.continue',
  retrieve:'memory.continue',capture:'memory.continue',staging:'memory.continue',
});
export const ownerPendingTools=Object.freeze({
  'document.continue':{intent:'generate_document',permissionTool:'prepare_document',effect:'write',resource:'documents',
    description:'Continuar el documento ya solicitado y guardado que espera destinatario o plantilla. Solo para responder al protocolo pendiente; una tarea nueva usa su propia herramienta. No cambia el contenido original.',
    inputSchema:schema(recipient)},
  'email.continue':{intent:'send_email',permissionTool:'send_owner_email',effect:'external',resource:'email',
    description:'Completar el correo solicitado que espera destinatario, cuerpo o archivo. body es el texto que el dueño quiere enviar ahora; no es otra orden ni un mensaje social. Conserva el asunto y remitente ya guardados. Encolado no significa enviado.',
    inputSchema:schema({...recipient,body:text(16000)})},
  'calendar.continue':{intent:'create_reminder',permissionTool:'manage_calendar',effect:'write',resource:'calendar',
    description:'Completar el destinatario o archivo de un recordatorio con correo ya solicitado, conservando fecha, tarea y remitente originales. Solo para el protocolo pendiente, sin crear otro encargo.',
    inputSchema:schema(recipient)},
  'memory.continue':{intent:'save_memory',permissionTool:'manage_memory',effect:'write',resource:'memory',
    description:'Continuar una captura privada pendiente o elegir qué parte de un recuerdo solicitado recuperar. action append/finish para la captura; action select con selection text/reference/both para recuperar. text solo contiene el material literal que el dueño aporta, nunca una tarea nueva.',
    inputSchema:schema({action:{type:'string',enum:['append','finish','select']},text:text(12000),selection:{type:'string',enum:['text','reference','both']}},['action'])},
});

/** Only these small facts enter the planner. Saved content, recipients, file
 * locations and credential values remain in the trusted runtime session. */
export function ownerPendingContinuationSummary(session){
  if(!session || !Object.hasOwn(protocols,session.type))return null;
  const state=session.state || {},summary={tool:protocols[session.type]};
  if(session.type==='await_document_recipient')summary.missingFields=['recipient'];
  else if(session.type==='document_template')summary.missingFields=['document_or_image'];
  else if(session.type==='await_email_delivery')summary.missingFields=[...(!state.to?['recipient']:[]),...(!state.body?['body']:[]),...((state.requiresAttachment||state.imageEditPrompt)&&!state.attachment?['attachment']:[])];
  else if(session.type==='await_reminder_recipient')summary.missingFields=['recipient'];
  else if(session.type==='await_reminder_attachment')summary.missingFields=['attachment'];
  else if(session.type==='retrieve')summary.missingFields=['selection'];
  else {summary.missingFields=['capture_content_or_finish'];summary.hasText=Boolean(state.prompt);summary.hasReference=Boolean(state.refs?.length);}
  return summary;
}
export function ownerPendingContinuationTool(context={}){
  const name=protocols[context.session?.type];
  return name?{name,...ownerPendingTools[name],status:'available'}:null;
}
const validEmail=value=>typeof value==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&value.length<=254;
export function validateOwnerPendingInput(name,input){
  const spec=ownerPendingTools[name];
  if(!spec||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(spec.inputSchema.properties,key)))throw Error('invalid_pending_input');
  for(const key of spec.inputSchema.required)if(!Object.hasOwn(input,key))throw Error('invalid_pending_input');
  const value={...input};
  for(const [key,item]of Object.entries(value)){
    const rule=spec.inputSchema.properties[key];
    if(typeof item!==rule.type || rule.type==='string'&&(!item.trim()||item.length>rule.maxLength||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)) || rule.enum&&!rule.enum.includes(item))throw Error('invalid_pending_input');
  }
  if(value.recipientEmail&&!validEmail(value.recipientEmail))throw Error('invalid_pending_recipient');
  if(value.recipientSelf&&(value.recipientEmail||value.recipientName))throw Error('ambiguous_pending_recipient');
  if(name==='memory.continue'&&(value.action==='select'?!value.selection||value.text:value.selection!==undefined))throw Error('invalid_pending_selection');
  return value;
}

function interpretation(input,agent,intent){return{intent,agent,contactName:input.recipientName||'',emailTo:input.recipientEmail||'',contactEmail:input.recipientEmail||'',emailToSelf:input.recipientSelf===true};}

/** Semantic body continuation deliberately has no text-trigger parser. The
 * planner chooses this exact action, while account, recipient and original
 * message authority remain application data. */
async function continueSemanticEmail(context,services){
  const {env,phone,session,descriptor,message,pendingInput:input,reply}=context,state=session.state;
  const identity=agentEmailIdentity(state.agent || context.agent || agentForEmail(state.from) || 'melodi',{from:state.emailFromExplicit?state.from:''});
  let attachment=state.attachment||null;
  if(!attachment&&descriptor){
    if(state.imageEditPrompt&&descriptor.kind!=='image'){await reply('Para editarla necesito una imagen. El correo sigue guardado.');return true;}
    attachment=await services.storeIncomingMedia(env,phone,message);
  }
  const target=input.recipientSelf?{contactEmail:env.OWNER_EMAIL_FORWARD_TO}:{contactName:input.recipientName||state.recipientName,contactEmail:input.recipientEmail};
  const resolved=state.to?{name:state.recipientName,email:state.to}:await services.resolveOwnerRecipient(env,phone,target);
  const body=state.body || input.body || '';
  if(!resolved?.email){await services.setOwnerSession(env,phone,'await_email_delivery',{...state,attachment,...(body?{body}:{})});await reply('¿A qué correo lo envío? Puedes darme la dirección o un contacto guardado.');return true;}
  if(!validEmail(resolved.email))throw Error('invalid_pending_resolved_recipient');
  const next={...state,to:resolved.email,recipientName:resolved.name||state.recipientName,body,attachment};
  if(!body){await services.setOwnerSession(env,phone,'await_email_delivery',next);await reply('¿Qué quieres que le diga en el correo?');return true;}
  if((state.requiresAttachment||state.imageEditPrompt)&&!attachment){await services.setOwnerSession(env,phone,'await_email_delivery',next);await reply('Envíame el archivo que quieres adjuntar al correo.');return true;}
  const jobId=await services.enqueueDirectOwnerEmail(env,phone,{...next,agent:identity.agent,from:identity.from,senderName:identity.senderName});
  if(typeof jobId!=='string'||!jobId.trim())throw Error('pending_email_not_accepted');
  await services.clearOwnerSession(env,phone);
  await reply(`El correo para ${resolved.email} quedó en preparación. Te avisaré cuando se envíe.`);
  return true;
}

/** Executes exactly the trusted session's continuation, never an ordered
 * search through handlers. The outer action ledger owns retries and effects. */
export async function executeOwnerPendingContinuation(name,rawInput,context,services){
  const input=validateOwnerPendingInput(name,rawInput),session=context?.session;
  if(!session||protocols[session.type]!==name||!session.state||typeof session.state!=='object')throw Error('pending_protocol_changed');
  if(context.phone!==String(context.env?.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''))throw Error('pending_owner_context_required');
  const messages=[],operations=[];
  const bound={...services};
  for(const key of ['enqueueOwnerJob','enqueueDirectOwnerEmail','scheduleEmailReminder','storeExactMemory','finishCapture'])if(typeof services[key]==='function')bound[key]=async(...args)=>{
    const value=await services[key](...args),id=typeof value==='string'?value:value?.event?.id||value?.id;
    if(typeof id==='string'&&id)operations.push(id);
    if(key==='finishCapture'){
      if(!value?.id || typeof services.getMemoryItem!=='function')throw Error('pending_memory_unverified');
      const stored=await services.getMemoryItem(context.env,context.phone,value.id),state=args[2];
      if(!stored?.payload||stored.payload.text!==(state.prompt||'')||JSON.stringify(stored.payload.refs||[])!==JSON.stringify(state.refs||[]))throw Error('pending_memory_unverified');
    }
    return value;
  };
  const agent=context.agent||context.interpretation?.agent||'melodi';
  const ctx={...context,session:{...session,state:structuredClone(session.state)},agent,pendingInput:input,receiptSent:false,
    normalized:context.normalized||context.incoming||'',links:context.links||[],markTyping:context.markTyping||(async()=>{}),
    reply:async text=>messages.push(text),sendText:async(_env,_phone,text)=>messages.push(text)};
  let executor;
  if(name==='document.continue'){
    ctx.interpretation=interpretation(input,agent,'send_email');
    executor=session.type==='document_template'?continueDocumentTemplate:continueDocumentDelivery;
  }else if(name==='email.continue'){
    if(input.body&&session.state.body)throw Error('pending_email_body_already_supplied');
    if(session.state.to&&(input.recipientEmail||input.recipientName||input.recipientSelf))throw Error('pending_email_recipient_already_supplied');
    ctx.interpretation=interpretation(input,agent,'send_email');executor=continueSemanticEmail;
  }else if(name==='calendar.continue'){
    ctx.interpretation=interpretation(input,agent,'create_reminder');
    if(input.recipientSelf)ctx.interpretation.contactEmail=context.env.OWNER_EMAIL_FORWARD_TO || '';
    executor=session.type==='await_reminder_attachment'?continueReminderAttachment:continueReminderRecipient;
  }else{
    if(session.type==='retrieve'){
      if(input.action!=='select')throw Error('pending_retrieval_requires_selection');
      ctx.interpretation={intent:'recall_memory',agent};
      bound.resolveRetrievalSelection=async()=>({text:'prompt',reference:'reference',both:'both'})[input.selection];executor=continueRetrieval;
    }else{
      if(input.action==='select')throw Error('pending_capture_requires_content');
      if(input.text)ctx.normalized=input.text;
      ctx.interpretation={intent:input.action==='finish'?'save_memory':'stage_memory',agent};executor=continueMemoryCapture;
    }
  }
  const result=await runExecutor(executor,ctx,bound);
  if(!result)throw Error('pending_continuation_not_handled');
  const queued=result.receipts.some(item=>item.verified&&item.status==='queued');
  const stored=result.receipts.some(item=>item.verified&&['persisted','scheduled'].includes(item.status))||operations.length>0;
  const state=queued?'accepted':stored?'committed':'observed';
  const operationId=operations.at(-1)||`${context.message?.id||'turn'}:${session.type}`;
  const response=messages.join('\n').trim() || (session.type==='capture'||session.type==='staging'?'Añadí ese contenido a la captura pendiente.':'La solicitud sigue guardada; falta completar el dato pendiente.');
  return{state,receipt:{tool:name,status:queued?'queued':stored?'completed':'observed',...(state==='observed'?{}:{operationId}),verified:true},
    data:{response,protocol:session.type,queued,pending:result.receipts.some(item=>item.status==='waiting')},messages};
}
