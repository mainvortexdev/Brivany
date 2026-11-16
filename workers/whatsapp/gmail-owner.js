import { stripAgentAddress } from './melodi-address.js';
import { createGmailStore } from './gmail-store.js';
import { createGmailLink, disconnectGmail, gmailConfigured, gmailOwner, withGmailClient } from './gmail-auth.js';
import { gmailAddress, gmailMessageText } from './gmail-client.js';

const fold=text=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function naturalGmailQuery(text) {
  let subject=text.replace(/^[¿?\s]+|[?!.\s]+$/g,'');
  const unread=/\b(?:sin leer|no le[ií]dos?)\b/i.test(subject),inbox=/\b(?:bandeja de entrada|recibidos)\b/i.test(subject);
  subject=subject.replace(/\b(?:sin leer|no le[ií]dos?|bandeja de entrada|recibidos)\b/gi,' ')
    .replace(/^(?:(?:el|los|mis|mi|un|unos|las|la|todos|todas)\s+)*(?:(?:[uú]ltimos?|m[aá]s recientes?)\s+)?(?:correos?|mensajes?)\b\s*/i,'')
    .replace(/^(?:(?:que\s+)?(?:tengo|hay)\s*)/i,'').replace(/^(?:de(?:l)?|sobre|acerca de|relacionados? con)\s+/i,'').trim();
  // Preserve explicitly supplied Gmail operators. A plain topic stays a topic;
  // only an actual sender address becomes a from: filter.
  const sender=subject.match(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)?.[0];
  const term=sender?`from:${sender}`:subject;
  return [inbox?'in:inbox':'',unread?'is:unread':'',term].filter(Boolean).join(' ') || undefined;
}
export function parseGmailOwnerRequest(message) {
  if(typeof message!=='string' || message.length>55000)return null;
  const text=stripAgentAddress(message,{includeStacy:true}).trim(),t=fold(text);
  if(!/\bgmail\b/.test(t) || /^(?:no\b|nunca\b|ejemplo\b|imagina\b|texto\b|["“«])/.test(t))return null;
  const send=text.match(/^(?:env[ií]a|manda)(?:\s+un\s+correo)?\s+(?:desde|por)\s+Gmail\s+a\s+([^\s,;]+)\s*\r?\nAsunto:\s*([^\r\n]+)\r?\nCuerpo:\s*([\s\S]+)$/i);
  if(send){try{gmailAddress(send[1]);}catch{return {action:'clarify_send'};}return {action:'send',to:send[1],subject:send[2].trim(),body:send[3]};}
  if(/[\r\n]/.test(text))return null;
  if(/^(?:desconecta|desvincula)\s+(?:mi\s+)?gmail[.!]*$/.test(t))return {action:'disconnect'};
  if(/^(?:(?:quiero|necesito)\s+)?(?:conecta|vincula|conectar|vincular)\s+(?:mi\s+)?gmail[.!]*$/.test(t) || /^(?:dame|env[ií]ame)\s+(?:el\s+)?enlace\s+para\s+(?:conectar|vincular)\s+(?:mi\s+)?gmail[.!]*$/.test(t))return {action:'connect'};
  if(/^(?:[¿?]\s*)?(?:esta\s+(?:mi\s+)?gmail\s+conectado|(?:mi\s+)?gmail\s+esta\s+conectado|estado\s+de\s+(?:mi\s+)?gmail)[?.!]*$/.test(t))return {action:'status'};
  if(/^(?:envia|manda|redacta|prepara)\b/.test(t))return {action:'clarify_send'};
  const read=text.match(/^(?:lee|mu[eé]strame|abre)\s+(?:el\s+)?(?:correo|mensaje)\s+(?:de\s+)?Gmail\s+([a-zA-Z0-9_-]{1,200})[.!]?$/i);
  if(read)return {action:'read',messageId:read[1]};
  const search=text.match(/^busca\s+(?:en\s+)?(?:mi\s+)?Gmail\s*[:,-]?\s+(.+)$/i);
  if(search)return {action:'search',q:naturalGmailQuery(search[1])};
  const contextualRead=text.match(/^(?:lee|mu[eé]strame|abre|consulta|revisa)\s+(.+?)\s+(?:en|de|del)\s+(?:mi\s+)?Gmail[?!.]*$/i);
  if(contextualRead)return {action:/\b(?:ultimo|mas reciente)\b/.test(fold(contextualRead[1]))?'latest':'search',q:naturalGmailQuery(contextualRead[1])};
  if(/^(?:[¿?]\s*)?(?:(?:que|cuales)\s+(?:son\s+)?(?:mis\s+)?(?:correos|mensajes)|revisa|muestrame|consulta|lee|ver)\b/.test(t)){
    const last=/\b(?:ultimo|mas reciente)\b/.test(t);
    const subject=text.replace(/^[¿?]\s*/,'').replace(/^(?:qu[eé]|cu[aá]les)\s+(?:son\s+)?|^(?:revisa|mu[eé]strame|consulta|lee|ver)\s+/i,'')
      .replace(/(?:en\s+|de\s+|del\s+)?(?:mi\s+)?Gmail[?!.]*$/i,'').trim();
    return {action:last?'latest':'search',q:naturalGmailQuery(subject)};
  }
  return null;
}
/** Explicit owner requests only. Retrieved email is displayed as untrusted text;
 * it is never routed back as an executable instruction or sent to a model. */
export async function handleGmailOwnerMessage(env,phone,message,agent,sendText,{client,store:customStore,createLink=createGmailLink,run=withGmailClient,messageId,runAction=(_name,operation)=>operation()}={}) {
  if(phone!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''))return false;
  const request=parseGmailOwnerRequest(message);if(!request)return false;gmailOwner(env,phone);
  const reply=body=>sendText(env,phone,body,{agent:agent || 'melodi'});
  if(!gmailConfigured(env) && !customStore){await reply('La conexión con Gmail todavía no está configurada.');return true;}
  const store=customStore || createGmailStore(env);await store.ensureSchema();
  if(request.action==='connect'){const link=await runAction('gmail_connect',()=>createLink(env,{store}));await reply(link.configured?`Conecta tu Gmail aquí: ${link.url}\nEl enlace es personal y Google te mostrará el acceso solicitado antes de aceptar.`:'La conexión con Gmail todavía no está configurada.');return true;}
  if(request.action==='status'){const connection=await store.getConnection(phone);await reply(connection?.status==='connected'?'Tu Gmail está conectado.':connection?.status==='reconnect_required'?'Google necesita que vuelvas a conectar tu Gmail.':'Todavía no conectaste tu Gmail.');return true;}
  if(request.action==='disconnect'){await runAction('gmail_disconnect',()=>disconnectGmail(env,{store}));await reply('Desconecté Gmail y eliminé sus credenciales guardadas. Tu calendario conserva su conexión.');return true;}
  if(request.action==='clarify_send'){await reply('Indica el destinatario, el asunto y el texto que quieres enviar desde Gmail. Puedes escribir: «Envía desde Gmail a correo@ejemplo.com» y, en líneas nuevas, «Asunto: …» y «Cuerpo: …».');return true;}
  const execute=async(api,context={email:'',store})=>{
    if(request.action==='send'){
      if(typeof messageId!=='string' || !messageId)throw Error('gmail_send_request_required');
      const send={to:request.to,subject:request.subject,body:request.body,...(context.email?{from:context.email}:{})};
      const receipt=await store.claimMutation(phone,messageId,JSON.stringify(send));
      if(!receipt.claimed){await reply(receipt.status==='sent'?`Ese correo ya se envió a ${send.to}.`:'El envío está pendiente de verificación. Evitaré repetirlo mientras se revisa.');return;}
      try{const result=await runAction('gmail_send',()=>api.sendMessage(send));if(!result?.id)throw Error('gmail_send_unconfirmed');await store.finishMutation(phone,messageId,{status:'sent',messageId:result.id});await reply(`Envié el correo a ${send.to}.`);}
      catch(error){if(error.status>=400 && error.status<500 && error.status!==408 && error.status!==409)await store.finishMutation(phone,messageId,{status:'rejected'});throw error;}
      return;
    }
    if(request.action==='read'){const msg=gmailMessageText(await api.getMessage(request.messageId));await reply(`De: ${msg.from || 'Remitente no indicado'}\nAsunto: ${msg.subject || '(sin asunto)'}\n\n${msg.body || msg.snippet || 'Este mensaje no contiene texto legible.'}`.slice(0,3500));return;}
    const listed=await api.listMessages({q:request.q,maxResults:request.action==='latest'?1:5});
    if(!Array.isArray(listed.messages || []))throw Error('gmail_invalid_message_list');
    if(!(listed.messages || []).length){await reply('No encontré correos con esa búsqueda.');return;}
    const messages=await Promise.all(listed.messages.slice(0,5).map(row=>api.getMessage(row.id).then(gmailMessageText)));
    if(request.action==='latest'){const msg=messages[0];await reply(`De: ${msg.from || 'Remitente no indicado'}\nAsunto: ${msg.subject || '(sin asunto)'}\n\n${msg.body || msg.snippet || 'Este mensaje no contiene texto legible.'}`.slice(0,3500));return;}
    await reply(messages.map(msg=>`• ${msg.subject || '(sin asunto)'} — ${msg.from || 'Remitente no indicado'}\n  Correo ${msg.id}${msg.snippet?`\n  ${msg.snippet}`:''}`).join('\n\n').slice(0,3500));
  };
  try{if(client)await execute(client,{email:'',store});else await run(env,phone,execute,{store});}
  catch(error){await reply(error.code==='authorization_required'?'Necesito que vuelvas a conectar tu Gmail.':error.code==='api_disabled'?'Gmail API está desactivada. Actívala en https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=vetsa-calendar-2026 y vuelve a intentarlo.':request.action==='send'?'No pude confirmar el envío. Conservé su estado para evitar enviar el mismo correo dos veces.':'No pude consultar Gmail en este momento. Inténtalo otra vez en unos segundos.');}
  return true;
}
