import { calendarHash, calendarRandom } from './google-calendar-store.js';
import { createGmailStore } from './gmail-store.js';
import { GMAIL_SCOPE, hasGmailAccess, GmailError, createGmailClient, buildGmailAuthorizationUrl, exchangeGmailCode, refreshGmailToken, readGmailJson } from './gmail-client.js';

const BASE='https://ia.vetsa.es', CALLBACK=`${BASE}/oauth/google/callback`;
export const gmailConfigured=env=>Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.MEMORY_ENCRYPTION_KEY && env.VETSA_CLOUD);
export function gmailOwner(env,phone=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')) {
  if(!/^\d{8,15}$/.test(phone) || phone!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''))throw Error('gmail_owner_required');return phone;
}
const expectedEmail=env=>String(env.GMAIL_OWNER_EMAIL || env.GOOGLE_CALENDAR_OWNER_EMAIL || '').toLowerCase();
function validToken(token,identity=false) {
  if(typeof token?.access_token!=='string' || !token.access_token || token.access_token.length>8192 || /[\r\n]/.test(token.access_token)
    || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in)<1 || Number(token.expires_in)>86400)throw new GmailError('invalid_token');
  const scopes=String(token.scope || '').split(/\s+/);
  if((identity || token.scope) && (!hasGmailAccess(scopes) || identity && (!scopes.includes('openid') || !scopes.some(scope=>scope==='email' || scope==='https://www.googleapis.com/auth/userinfo.email'))))throw new GmailError('missing_scope');
  if(token.refresh_token!==undefined && (typeof token.refresh_token!=='string' || !token.refresh_token || token.refresh_token.length>8192 || /[\r\n]/.test(token.refresh_token)))throw new GmailError('invalid_refresh_token');
}
const page=(body,status=200)=>new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brivany · Gmail</title><body style="font:17px/1.6 system-ui;background:#07111f;color:#e5eefb;margin:0;padding:5vw"><main style="max-width:680px;margin:auto"><h1>Conectar Gmail</h1><p>${body}</p><p><a href="/privacy.html" style="color:#7de0c6">Política de privacidad</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'x-content-type-options':'nosniff'}});
const clearCookie=response=>{response.headers.set('set-cookie','vetsa_gmail_oauth=; Path=/oauth/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');return response;};
export async function createGmailLink(env,{store:providedStore,now=Date.now()}={}) {
  if(!gmailConfigured(env))return {configured:false};
  const store=providedStore || createGmailStore(env);
  await store.ensureSchema();const token=await store.createNonce(gmailOwner(env),'link',{},now+24*3600000);
  return {configured:true,url:`${BASE}/oauth/gmail/start?link=${token}`,expiresAt:new Date(now+24*3600000).toISOString()};
}
/** Disconnect locally only: Google's shared project grant may also cover Calendar. */
export async function disconnectGmail(env,{store=createGmailStore(env)}={}) {await store.ensureSchema();await store.disconnect(gmailOwner(env));return {disconnected:true};}
export async function getGmailAccessToken(env,connection,store,{leaseToken,now=Date.now(),fetcher=fetch}={}) {
  if(!hasGmailAccess(connection.scopes))throw new GmailError('authorization_required');
  if(env.MELODI_GOOGLE_CLIENT_REQUIRED && connection.clientId!==env.GOOGLE_CLIENT_ID)throw new GmailError('authorization_required');
  if(connection.accessToken && connection.accessTokenExpiresAt>now+60000)return connection.accessToken;
  if(!leaseToken)throw new GmailError('lease_required');
  try {
    const token=await refreshGmailToken({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refreshToken:connection.refreshToken,fetcher});validToken(token);
    const updated={...connection,accessToken:token.access_token,accessTokenExpiresAt:now+Number(token.expires_in)*1000,...(token.scope?{scopes:token.scope.split(/\s+/)}:{}),...(token.refresh_token?{refreshToken:token.refresh_token}:{})};
    await store.putConnection(gmailOwner(env),updated,{leaseToken});Object.assign(connection,updated);return updated.accessToken;
  }catch(error){if(error.code==='authorization_required')await store.putConnection(gmailOwner(env),{...connection,status:'reconnect_required'},{leaseToken}).catch(()=>{});throw error;}
}
export async function withGmailClient(env,phone,operation,{store=createGmailStore(env),fetcher=fetch,now=Date.now()}={}) {
  gmailOwner(env,phone);await store.ensureSchema();
  const leaseToken=await store.acquireLease(phone);
  if(!leaseToken){const connection=await store.getConnection(phone);throw new GmailError(connection?.status==='connected'?'connection_busy':'authorization_required');}
  try {
    const connection=await store.getConnection(phone);
    if(!connection || connection.status!=='connected' || (expectedEmail(env) && connection.email.toLowerCase()!==expectedEmail(env)))throw new GmailError('authorization_required');
    const accessToken=await getGmailAccessToken(env,connection,store,{leaseToken,now,fetcher});
    return await operation(createGmailClient({accessToken,fetcher}),{email:connection.email,store});
  }catch(error){
    if(error.code==='authorization_required'){
      const connection=await store.getConnection(phone);
      if(connection)await store.putConnection(phone,{...connection,status:'reconnect_required'},{leaseToken}).catch(()=>{});
    }
    throw error;
  }finally{await store.releaseLease(phone,leaseToken);}
}
/** Call before Calendar's route for the shared, already registered callback. */
export async function handleGmailRoute(request,env,url,{sendWhatsApp,store:customStore,fetcher=fetch,now=Date.now()}={}) {
  const gmailCallback=url.pathname==='/oauth/google/callback' && /^gmail\./.test(url.searchParams.get('state') || '');
  if(!url.pathname.startsWith('/oauth/gmail/') && !gmailCallback)return null;
  if(url.origin!==BASE || !['GET','POST'].includes(request.method))return page('Ruta no disponible.',404);
  if(!gmailConfigured(env))return page('La conexión con Gmail todavía no está configurada.',503);
  const store=customStore || createGmailStore(env);await store.ensureSchema();const owner=gmailOwner(env);
  if(url.pathname==='/oauth/gmail/start') {
    let link=url.searchParams.get('link');
    if(request.method==='POST'){
      if(request.headers.get('origin')!==BASE || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type') || ''))return page('No se pudo verificar esta solicitud.',403);
      const declared=Number(request.headers.get('content-length'));if(declared>2048)return page('Solicitud inválida.',400);
      const reader=request.body?.getReader();if(!reader)return page('Solicitud inválida.',400);const chunks=[];let length=0;
      try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>2048){await reader.cancel();return page('Solicitud inválida.',400);}chunks.push(part.value);}}finally{reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}link=new URLSearchParams(new TextDecoder().decode(bytes)).get('link');
    }
    const linked=request.method==='GET'?await store.peekNonce(link,'link'):await store.consumeNonce(link,'link',{owner});
    if(!linked || linked.owner!==owner)return page('Este enlace venció o ya se utilizó. Pide un enlace nuevo.',400);
    if(request.method==='GET'){
      const result=page(`Google te pedirá acceso para leer, redactar, enviar y gestionar borradores. No se solicita permiso para borrar tus mensajes. Melodi ejecutará acciones cuando se las pidas; conectar la cuenta no envía ningún correo.<form method="post" action="/oauth/gmail/start"><input type="hidden" name="link" value="${link}"><button type="submit" style="background:#7de0c6;color:#07111f;border:0;padding:12px 18px;font:inherit">Continuar con Google</button></form>`);
      result.headers.set('referrer-policy','same-origin');result.headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com");return result;
    }
    const verifier=calendarRandom(),browserToken=calendarRandom();
    const token=await store.createNonce(owner,'consent',{verifier,browserHash:await calendarHash(browserToken)},now+15*60000);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    const codeChallenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return new Response(null,{status:302,headers:{location:buildGmailAuthorizationUrl({clientId:env.GOOGLE_CLIENT_ID,redirectUri:CALLBACK,state:`gmail.${token}`,codeChallenge,expectedEmail:expectedEmail(env)}),'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`vetsa_gmail_oauth=${browserToken}; Path=/oauth/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`}});
  }
  if(!gmailCallback || request.method!=='GET')return page('Ruta no disponible.',404);
  const state=url.searchParams.get('state');if(!/^gmail\.[a-f0-9]{64}$/.test(state))return page('Vinculación inválida.',400);
  const browserToken=(request.headers.get('cookie') || '').match(/(?:^|;\s*)vetsa_gmail_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
  const consent=browserToken?await store.consumeNonce(state.slice(6),'consent',{owner,browserHash:await calendarHash(browserToken)}):null;
  if(!consent)return page('No se pudo verificar esta vinculación. Solicita otro enlace.',400);
  if(url.searchParams.has('error'))return clearCookie(page('No concediste el permiso. Puedes conectar Gmail más adelante.',400));
  try{
    const token=await exchangeGmailCode({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:CALLBACK,code:url.searchParams.get('code'),codeVerifier:consent.verifier,fetcher});validToken(token,true);
    const identityResponse=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!identityResponse.ok || identityResponse.status>=300)throw new GmailError('account_unverified');
    const profile=await readGmailJson(identityResponse,65536);
    if(typeof profile.sub!=='string' || !profile.sub || profile.sub.length>255 || profile.email_verified!==true || (!String(profile.email||'').includes('@') || expectedEmail(env) && String(profile.email).toLowerCase()!==expectedEmail(env)))return clearCookie(page('Selecciona la cuenta autorizada para vincular Gmail. Pide un enlace nuevo.',403));
    const gmailProfile=await createGmailClient({accessToken:token.access_token,fetcher}).getProfile();
    if(String(gmailProfile.emailAddress || '').toLowerCase()!==String(profile.email||'').toLowerCase())throw new GmailError('account_unverified');
    const previous=await store.getConnection(owner);
    if(!token.refresh_token && (!previous?.refreshToken || previous.subject!==profile.sub || env.MELODI_GOOGLE_CLIENT_REQUIRED && previous.clientId!==env.GOOGLE_CLIENT_ID || !hasGmailAccess(previous.scopes)))throw new GmailError('missing_refresh_token');
    await store.putConnection(owner,{status:'connected',email:String(profile.email).toLowerCase(),clientId:env.GOOGLE_CLIENT_ID,subject:profile.sub,accessToken:token.access_token,
      scopes:String(token.scope).split(/\s+/),refreshToken:token.refresh_token || previous.refreshToken,accessTokenExpiresAt:now+Number(token.expires_in)*1000,connectedAt:new Date(now).toISOString()},{expectedVersion:previous?.version ?? 0,consentToken:state.slice(6)});
    if(sendWhatsApp)try{await sendWhatsApp(env,owner,'Ya conecté tu Gmail. Puedes pedirme que lea, busque o prepare correos.');}catch{}
    return clearCookie(page('Tu Gmail está conectado. Ya puedes volver al chat.'));
  }catch(error){
    const missing=error?.code==='missing_scope';
    if(error?.code==='api_disabled')return clearCookie(page('Gmail API está desactivada en el proyecto de Google Cloud. <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=brivany" style="color:#7de0c6" rel="noreferrer">Activa Gmail API en brivany</a> y después pide un enlace nuevo para conectar tu cuenta.',503));
    return clearCookie(page(missing?'Google no concedió todos los permisos solicitados. Pide otro enlace y revisa los permisos.':'No pude completar la conexión con Gmail. Pide un enlace nuevo e inténtalo otra vez.',missing?403:502));
  }
}
