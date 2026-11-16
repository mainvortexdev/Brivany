import { withGmailClient, createGmailLink, gmailOwner } from './gmail-auth.js';
import { gmailMessageText, gmailAddress, GmailError, validateMailAttachments } from './gmail-client.js';
import { mailPage } from './software-mail-page.js';

export const MAILBOXES = Object.freeze(['ceo@vetsa.es', 'daniel@vetsa.es']);
const json = (data, status=200) => Response.json(data,{status,headers:{'cache-control':'no-store, private'}});
const header=(message,name)=>String(message.payload?.headers?.find(h=>h.name.toLowerCase()===name)?.value||'');
function mailbox(value) { if(!MAILBOXES.includes(value))throw new TypeError('invalid_mailbox');return value; }
function addresses(value) { return String(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[]; }
export function belongsToMailbox(message,email) {
  return ['to','cc','delivered-to','x-original-recipient','from'].some(name=>addresses(header(message,name)).includes(email));
}
export function buildMailReply(original,{account,body,attachments=[]}) {
  mailbox(account);
  if(!belongsToMailbox(original,account))throw new GmailError('not_found');
  if(typeof body!=='string'||!body.trim()||body.length>10000)throw new TypeError('invalid_reply_body');
  const to=addresses(header(original,'reply-to')||header(original,'from'))[0];gmailAddress(to);
  if(MAILBOXES.includes(to))throw new TypeError('cannot_reply_to_self');
  const messageId=header(original,'message-id').trim();
  if(!/^<[^<>\s]+@[^<>\s]+>$/.test(messageId))throw new TypeError('missing_message_id');
  const references=[...header(original,'references').matchAll(/<[^<>\s]+@[^<>\s]+>/g)].map(m=>m[0]).slice(-20);
  if(!references.includes(messageId))references.push(messageId);
  const subject=header(original,'subject').trim()||'(Sin asunto)';
  validateMailAttachments(attachments);
  return {from:account,to,subject:/^re:/i.test(subject)?subject:'Re: '+subject,body,threadId:original.threadId,inReplyTo:messageId,references:references.join(' '),attachments};
}
async function brevoStatus(env,fetcher) {
  if(!env.BREVO_API_KEY)return false;
  const response=await fetcher('https://api.brevo.com/v3/senders/domains/vetsa.es',{headers:{'api-key':env.BREVO_API_KEY},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;
  const data=await response.json();return data.verified===true&&data.authenticated===true;
}
async function brevoSenders(env,fetcher,configure=false) {
  if(!await brevoStatus(env,fetcher))return new Set();
  const headers={'api-key':env.BREVO_API_KEY,'content-type':'application/json'};
  const listing=await fetcher('https://api.brevo.com/v3/senders?domain=vetsa.es',{headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!listing.ok)return new Set();
  const data=await listing.json(),accepted=new Set((data.senders||[]).filter(s=>s.active===true).map(s=>s.email?.toLowerCase()));
  if(configure)for(const email of MAILBOXES)if(!accepted.has(email)){
    const created=await fetcher('https://api.brevo.com/v3/senders',{method:'POST',headers,redirect:'manual',signal:AbortSignal.timeout(10000),body:JSON.stringify({email,name:'Daniel · Vetsa'})});
    if(!created.ok)throw new GmailError('sender_unverified');
  }
  return configure?brevoSenders(env,fetcher):accepted;
}
async function senderOptions(api,env,fetcher) {
  const aliases=await api.listSendAs();
  const accepted=new Set((aliases.sendAs||[]).filter(a=>a.verificationStatus==='accepted'||a.isPrimary).map(a=>a.sendAsEmail?.toLowerCase()));
  const fallback=MAILBOXES.every(email=>accepted.has(email))?new Set():await brevoSenders(env,fetcher).catch(()=>new Set());
  return MAILBOXES.map(email=>({email,receiveReady:true,sendReady:accepted.has(email)||fallback.has(email),transport:accepted.has(email)?'gmail':fallback.has(email)?'brevo':null}));
}
async function sendBrevo(env,input,fetcher) {
  let response;
  try {response=await fetcher('https://api.brevo.com/v3/smtp/email',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'api-key':env.BREVO_API_KEY,'content-type':'application/json'},body:JSON.stringify({sender:{email:input.from,name:'Daniel · Vetsa'},to:[{email:input.to}],replyTo:{email:input.from},subject:input.subject,textContent:input.body,headers:{'In-Reply-To':input.inReplyTo,References:input.references},...(input.attachments.length?{attachment:input.attachments.map(file=>({name:file.name,content:file.data}))}:{})})});}
  catch {throw new GmailError('send_unconfirmed',{uncertain:true});}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new GmailError('provider_rejected',{status:response.status,uncertain:response.status>=500});
  if(typeof data.messageId!=='string')throw new GmailError('send_unconfirmed',{uncertain:true});
  return {id:data.messageId};
}
export async function handleSoftwareMail(request,env,url,{authenticated=false,withClient=withGmailClient,fetcher=fetch}={}) {
  if(!['/correo','/emails'].includes(url.pathname)&&!url.pathname.startsWith('/api/mail/'))return null;
  if(!authenticated)return url.pathname.startsWith('/api/')?json({error:'Inicia sesión para acceder al correo.'},401):new Response(null,{status:302,headers:{location:'/software-login'}});
  if(!['GET','POST'].includes(request.method))return json({error:'Método no permitido.'},405);
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Origen no permitido.'},403);
  if(['/correo','/emails'].includes(url.pathname)&&request.method==='GET')return mailPage();
  try {
    if(url.pathname==='/api/mail/connect'&&request.method==='POST')return json(await createGmailLink(env));
    return await withClient(env,gmailOwner(env),async(api,{email,store})=>{
      if(url.pathname==='/api/mail/configure'&&request.method==='POST'){
        await brevoSenders(env,fetcher,true);
        return json({configured:true,accounts:await senderOptions(api,env,fetcher)});
      }
      if(url.pathname==='/api/mail/status'&&request.method==='GET')return json({connected:true,connectedEmail:email,accounts:await senderOptions(api,env,fetcher)});
      const account=mailbox(url.searchParams.get('account'));
      if(url.pathname==='/api/mail/messages'&&request.method==='GET') {
        const search=url.searchParams.get('q')||'';if(search.length>200)throw new TypeError('invalid_search');
        const folder=url.searchParams.get('folder')==='sent'?'sent':'inbox';
        const q=`${folder==='sent'?`in:sent from:${account}`:`{to:${account} cc:${account} deliveredto:${account}} -in:trash -in:spam`}${search?` (${search})`:''}`;
        const list=await api.listMessages({q,maxResults:20,...(url.searchParams.get('pageToken')?{pageToken:url.searchParams.get('pageToken')}:{})});
        const messages=await Promise.all((list.messages||[]).map(row=>api.getMessage(row.id)));
        return json({messages:messages.filter(m=>belongsToMailbox(m,account)).map(m=>({...gmailMessageText(m),unread:m.labelIds?.includes('UNREAD')===true})),nextPageToken:list.nextPageToken||null});
      }
      const match=url.pathname.match(/^\/api\/mail\/messages\/([a-zA-Z0-9_-]{1,200})(?:\/(reply|draft))?$/);
      if(!match)return json({error:'Ruta no encontrada.'},404);
      const original=await api.getMessage(match[1]);if(!belongsToMailbox(original,account))throw new GmailError('not_found');
      if(request.method==='GET'&&!match[2])return json({message:gmailMessageText(original),replyTo:addresses(header(original,'reply-to')||header(original,'from'))[0]||''});
      if(request.method!=='POST'||!match[2])return json({error:'Método no permitido.'},405);
      const reader=request.body?.getReader();if(!reader)throw new TypeError('missing_body');
      const chunks=[];let length=0;
      try {while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>8*1024*1024){await reader.cancel();return json({error:'Respuesta demasiado larga.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const body=JSON.parse(new TextDecoder().decode(bytes)),input=buildMailReply(original,{account,body:body.body,attachments:body.attachments});
      if(!/^[a-f0-9-]{36}$/.test(body.requestId||''))throw new TypeError('invalid_request_id');
      const key=`workspace:${match[2]}:${body.requestId}`,claim=await store.claimMutation(gmailOwner(env),key,JSON.stringify(input));
      if(!claim.claimed)return claim.status==='sent'?json({ok:true,id:claim.messageId,draft:match[2]==='draft',replayed:true}):json({error:'La operación sigue pendiente de confirmación. Comprueba el estado antes de repetirla.',uncertain:true},409);
      let providerAccepted=false;
      try {
        let result,transport='gmail';
        if(match[2]==='draft')result=await api.createDraft(input);
        else {
          const sender=(await senderOptions(api,env,fetcher)).find(s=>s.email===account);
          if(!sender.sendReady)throw new GmailError('sender_unverified');
          transport=sender.transport;result=transport==='gmail'?await api.sendMessage(input):await sendBrevo(env,input,fetcher);
        }
        providerAccepted=true;
        await store.finishMutation(gmailOwner(env),key,{status:'sent',messageId:result.id});
        return json({ok:true,id:result.id,draft:match[2]==='draft',transport,accepted:match[2]==='reply'});
      }catch(error){if(providerAccepted)throw new GmailError('send_unconfirmed',{uncertain:true});if(error.uncertain!==true)await store.finishMutation(gmailOwner(env),key,{status:'rejected'});throw error;}
    });
  }catch(error){
    const messages={authorization_required:'Es necesario volver a autorizar Gmail.',connection_busy:'El correo está ocupado. Inténtalo de nuevo en unos segundos.',sender_unverified:'Este remitente todavía no está autorizado para enviar.',not_found:'No se encontró este correo en la cuenta seleccionada.',api_disabled:'Gmail API no está habilitada para esta conexión.'};
    const status=error.code==='authorization_required'?401:error.code==='not_found'?404:error instanceof TypeError||error instanceof SyntaxError?400:502;
    return json({error:messages[error.code]||(error.uncertain?'No se pudo confirmar el envío. No lo repitas hasta comprobarlo.':status===400?'Revisa los datos de la respuesta.':'No se pudo completar la operación de correo.'),code:error.code||'mail_error',uncertain:error.uncertain===true},status);
  }
}
