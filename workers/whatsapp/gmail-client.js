// Preserve compatible legacy grants; fresh consent requests only the read
// and draft/send scopes needed by the exposed tools.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
export const GMAIL_REQUIRED_SCOPES=Object.freeze(['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
export const GMAIL_AUTH_SCOPES = Object.freeze([...GMAIL_REQUIRED_SCOPES,'openid','email']);
export const hasGmailAccess=scopes=>Array.isArray(scopes)&&(scopes.includes('https://mail.google.com/')||scopes.includes(GMAIL_SCOPE)||GMAIL_REQUIRED_SCOPES.every(scope=>scopes.includes(scope)));
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const encode64 = value => {const bytes=new TextEncoder().encode(value);let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(binary);};
const base64url = value => encode64(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export class GmailError extends Error {
  constructor(code,{status=0,uncertain=false,retryable=false}={}) { super(`Gmail: ${code}`);this.name='GmailError';Object.assign(this,{code,status,uncertain,retryable}); }
}
function value(text,max=200) { if(typeof text!=='string' || !text || text.length>max || /[\u0000-\u001f]/.test(text))throw new TypeError('invalid_gmail_value');return text; }
function id(text) { if(!/^[a-zA-Z0-9_-]{1,200}$/.test(text || ''))throw new TypeError('invalid_gmail_id');return text; }
export function gmailAddress(text) { if(typeof text!=='string' || text.length>254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(text))throw new TypeError('invalid_gmail_address');return text; }
export async function readGmailJson(response,maxBytes=2*1024*1024) {
  if(Number(response.headers.get('content-length'))>maxBytes)throw new GmailError('response_too_large');
  const reader=response.body?.getReader();if(!reader)throw new GmailError('invalid_response');
  const chunks=[];let length=0;
  try { while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>maxBytes){await reader.cancel();throw new GmailError('response_too_large');}chunks.push(part.value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try{const result=JSON.parse(new TextDecoder().decode(bytes));if(!result || typeof result!=='object' || Array.isArray(result))throw Error();return result;}
  catch{throw new GmailError('invalid_response');}
}
async function transport(fetcher,url,options,timeoutMs=10000,maxBytes) {
  const mutation=options.method==='POST' || options.method==='PUT';
  try {
    const response=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});
    if(response.status>=300 && response.status<400)throw new GmailError('redirect_rejected',{status:response.status});
    const body=await readGmailJson(response,maxBytes);
    if(!response.ok){const status=response.status,disabled=body.error?.errors?.some(item=>item.reason==='accessNotConfigured')
      || body.error?.details?.some(item=>item.reason==='SERVICE_DISABLED'),code=disabled?'api_disabled':status===401 || body.error==='invalid_grant' ? 'authorization_required':status===404 ? 'not_found':status===429 || status>=500 ? 'temporarily_unavailable':'provider_rejected';throw new GmailError(code,{status,retryable:status===429 || status>=500,uncertain:mutation && status>=500});}
    return body;
  }catch(error){if(error instanceof GmailError){if(mutation && !error.status)error.uncertain=true;throw error;}throw new GmailError(error?.name==='TimeoutError' || error?.name==='AbortError'?'request_timeout':'network_error',{uncertain:mutation,retryable:!mutation});}
}
export function buildGmailAuthorizationUrl({clientId,redirectUri,state,codeChallenge,expectedEmail}) {
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  if(redirectUri!=='https://ia.vetsa.es/oauth/google/callback' || !/^gmail\.[a-f0-9]{64}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))throw new TypeError('invalid_gmail_authorization');
  const fields={client_id:value(clientId,512),redirect_uri:redirectUri,response_type:'code',scope:GMAIL_AUTH_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:codeChallenge,code_challenge_method:'S256'};
  if(expectedEmail!==undefined&&expectedEmail!=='')fields.login_hint=gmailAddress(expectedEmail);
  for(const [key,entry]of Object.entries(fields))url.searchParams.set(key,entry);return url.href;
}
export function exchangeGmailCode({clientId,clientSecret,redirectUri,code,codeVerifier,fetcher=fetch}) {
  if(redirectUri!=='https://ia.vetsa.es/oauth/google/callback' || !/^[a-f0-9]{64}$/.test(codeVerifier))throw new TypeError('invalid_gmail_exchange');
  return transport(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:value(clientId,512),client_secret:value(clientSecret,2048),redirect_uri:redirectUri,code:value(code,8192),code_verifier:codeVerifier,grant_type:'authorization_code'})},10000,65536);
}
export function refreshGmailToken({clientId,clientSecret,refreshToken,fetcher=fetch}) {
  return transport(fetcher,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:value(clientId,512),client_secret:value(clientSecret,2048),refresh_token:value(refreshToken,8192),grant_type:'refresh_token'})},10000,65536);
}
export function validateMailAttachments(attachments=[]) {
  if(!Array.isArray(attachments)||attachments.length>8)throw new TypeError('invalid_mail_attachments');
  let total=0;
  for(const file of attachments){
    if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||/[\x00-\x1f\x7f/\\]/.test(file.name))throw new TypeError('invalid_attachment_name');
    if(typeof file.data!=='string'||file.data.length>7*1024*1024||file.data.length%4!==0||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))throw new TypeError('invalid_attachment_data');
    total+=file.data.length*3/4-(file.data.endsWith('==')?2:file.data.endsWith('=')?1:0);
    if(total>5*1024*1024)throw new TypeError('attachments_too_large');
    if(typeof file.contentType!=='string'||! /^(?:image\/(?:png|jpeg|webp|gif|avif|heic|heif)|application\/(?:pdf|octet-stream)|text\/plain)$/.test(file.contentType))throw new TypeError('invalid_attachment_type');
  }
  return attachments;
}
export function encodeGmailMessage({to,from,subject,body,inReplyTo,references,attachments=[]}) {
  gmailAddress(to);if(from)gmailAddress(from);value(subject,500);
  if(typeof body!=='string' || !body.trim() || body.length>50000 || /\u0000/.test(body))throw new TypeError('invalid_gmail_body');
  if(inReplyTo)value(inReplyTo,1000);if(references)value(references,8000);
  validateMailAttachments(attachments);
  const head=`${from?`From: ${from}\r\n`:''}To: ${to}\r\nSubject: =?UTF-8?B?${encode64(subject)}?=\r\n${inReplyTo?`In-Reply-To: ${inReplyTo}\r\n`:''}${references?`References: ${references}\r\n`:''}MIME-Version: 1.0\r\n`;
  const plain=`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode64(body).match(/.{1,76}/g).join('\r\n')}\r\n`;
  if(!attachments.length)return base64url(head+plain);
  const boundary='vetsa_'+crypto.randomUUID().replace(/-/g,'');
  return base64url(head+`Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n`+plain+attachments.map(file=>`--${boundary}\r\nContent-Type: ${file.contentType}\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}\r\nContent-Transfer-Encoding: base64\r\n\r\n${file.data.match(/.{1,76}/g)?.join('\r\n')||''}\r\n`).join('')+`--${boundary}--\r\n`);
}
function decodeBody(data) {
  if(typeof data!=='string' || data.length>2*1024*1024 || !/^[A-Za-z0-9_\-=]*$/.test(data))return '';
  try {const text=atob(data.replace(/-/g,'+').replace(/_/g,'/'));return new TextDecoder().decode(Uint8Array.from(text,c=>c.charCodeAt(0)));}catch{return '';}
}
/** Remote email is untrusted source data; no attachments or remote HTML are loaded. */
export function gmailMessageText(message) {
  if(!message || typeof message.id!=='string' || !message.payload || typeof message.payload!=='object')throw new GmailError('invalid_message');
  const headers=Array.isArray(message.payload.headers)?message.payload.headers:[];
  const header=name=>String(headers.find(item=>String(item.name).toLowerCase()===name)?.value || '').replace(/[\r\n\u0000]/g,' ').slice(0,1000);
  const parts=[],html=[];let count=0;
  function visit(part,depth=0){if(!part || depth>10 || count++>80)return;if(part.mimeType==='text/plain' || !part.mimeType && part.body?.data){const text=decodeBody(part.body?.data);if(text)parts.push(text);}else if(part.mimeType==='text/html'){const text=decodeBody(part.body?.data);if(text)html.push(text);}for(const child of Array.isArray(part.parts)?part.parts:[])visit(child,depth+1);}
  visit(message.payload);
  const plainHtml=html.join('\n').replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:br\s*\/|br|\/p|\/div|\/li)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[entity]);
  return {id:message.id,threadId:message.threadId || '',from:header('from'),to:header('to'),subject:header('subject'),date:header('date'),
    snippet:String(message.snippet || '').slice(0,1000),body:(parts.length?parts.join('\n'):plainHtml).slice(0,12000),untrusted:true};
}
export function createGmailClient({accessToken,fetcher=fetch,timeoutMs=10000}={}) {
  if(typeof fetcher!=='function' || !Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>30000)throw new TypeError('invalid_gmail_transport');
  const call=async(path,{method='GET',body,query,maxBytes}={})=>{
    const token=typeof accessToken==='function'?await accessToken():accessToken;
    value(token,8192);const url=new URL(API+path);for(const[k,v]of Object.entries(query || {}))if(v!==undefined)url.searchParams.set(k,String(v));
    return transport(fetcher,url.href,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},timeoutMs,maxBytes);
  };
  const list=(path,{q,maxResults=10,pageToken}={})=>{if(!Number.isInteger(maxResults)||maxResults<1||maxResults>50)throw new TypeError('invalid_gmail_page');if(q!==undefined)value(q,1000);if(pageToken!==undefined)value(pageToken,2048);return call(path,{query:{q,maxResults,pageToken}});};
  const raw=input=>({raw:encodeGmailMessage(input),...(input.threadId?{threadId:id(input.threadId)}:{})});
  const confirmed=async promise=>{const result=await promise;if(typeof result.id!=='string'||!result.id)throw new GmailError('send_unconfirmed',{uncertain:true});return result;};
  return {
    getProfile:()=>call('/profile'),listSendAs:()=>call('/settings/sendAs'),listMessages:options=>list('/messages',options),listThreads:options=>list('/threads',options),
    getMessage:messageId=>call(`/messages/${id(messageId)}`,{query:{format:'full'}}),getThread:threadId=>call(`/threads/${id(threadId)}`,{query:{format:'full'}}),
    listLabels:()=>call('/labels'),
    // El adjunto es un dato de origen externo: se acota antes de descargarlo y
    // el llamador comprueba su forma. No se ejecuta nada de su contenido.
    getAttachment:(messageId,attachmentId)=>{
      if(!/^[A-Za-z0-9_-]{1,2048}$/.test(attachmentId || ''))throw new TypeError('invalid_gmail_attachment_id');
      return call(`/messages/${id(messageId)}/attachments/${attachmentId}`,{maxBytes:6*1024*1024});
    },
    modifyMessage:(messageId,{addLabelIds=[],removeLabelIds=[]}={})=>{for(const labels of[addLabelIds,removeLabelIds])if(!Array.isArray(labels)||labels.length>25||labels.some(label=>!id(label)))throw new TypeError('invalid_gmail_labels');return call(`/messages/${id(messageId)}/modify`,{method:'POST',body:{addLabelIds,removeLabelIds}});},
    trashMessage:messageId=>call(`/messages/${id(messageId)}/trash`,{method:'POST',body:{}}),untrashMessage:messageId=>call(`/messages/${id(messageId)}/untrash`,{method:'POST',body:{}}),
    listDrafts:options=>list('/drafts',options),getDraft:draftId=>call(`/drafts/${id(draftId)}`,{query:{format:'full'}}),
    createDraft:input=>confirmed(call('/drafts',{method:'POST',body:{message:raw(input)}})),
    updateDraft:(draftId,input)=>confirmed(call(`/drafts/${id(draftId)}`,{method:'PUT',body:{message:raw(input)}})),
    sendMessage:input=>confirmed(call('/messages/send',{method:'POST',body:raw(input)})),
  };
}
