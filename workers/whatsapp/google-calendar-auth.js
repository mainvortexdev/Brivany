import { buildGoogleCalendarAuthorizationUrl, exchangeGoogleCalendarCode, refreshGoogleCalendarToken, createGoogleCalendarClient, GOOGLE_CALENDAR_SCOPE } from './google-calendar-client.js';
import { createGoogleCalendarStore, calendarRandom, calendarHash } from './google-calendar-store.js';
import { documentArtifactRequest } from './document-workflow.js';
import { stripAgentAddress } from './melodi-address.js';

const BASE = 'https://ia.vetsa.es';
const CALLBACK = `${BASE}/oauth/google/callback`;
const NAMES = {melodi:'Melodi'};
const SAFE_FAILURE_CODES=new Set(['response_too_large','invalid_response','authorization_required','sync_token_expired','conflict','already_exists','not_found','temporarily_unavailable','provider_rejected','request_timeout','network_error','redirect_rejected','google_calendar_invalid_token','google_calendar_invalid_refresh_token','google_calendar_response_too_large','google_calendar_invalid_response','missing_calendar_scope','google_account_unverified','missing_refresh_token','google_calendar_provisioning_uncertain','google_calendar_connection_busy','google_calendar_lease_lost','google_calendar_invalid_calendar']);
function failureCode(error) {
  const value=error?.code || error?.message;
  return SAFE_FAILURE_CODES.has(value) ? value : 'setup_failed';
}
const reply = (message,status=200) => new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brivany · Google Calendar</title><body style="font:17px/1.6 system-ui;background:#07111f;color:#e5eefb;margin:0;padding:5vw"><main style="max-width:680px;margin:auto"><h1>Brivany · Google Calendar</h1><p>${message}</p><p><a style="color:#7de0c6" href="/google-calendar.html">Información de la integración</a> · <a style="color:#7de0c6" href="/privacy.html">Privacidad</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'x-content-type-options':'nosniff'}});
export function googleCalendarConfigured(env) { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.MEMORY_ENCRYPTION_KEY && env.VETSA_CLOUD); }
function owner(env) { const value=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''); if (!/^\d{8,15}$/.test(value)) throw new Error('google_calendar_owner_missing'); return value; }
function expectedEmail(env) { return String(env.GOOGLE_CALENDAR_OWNER_EMAIL || '').toLowerCase(); }
function validToken(token,{requireIdentity=false}={}) {
  if (typeof token?.access_token!=='string' || !token.access_token || /[\r\n]/.test(token.access_token) || token.access_token.length>8192
    || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in)<1 || Number(token.expires_in)>86400) throw new Error('google_calendar_invalid_token');
  const granted=String(token.scope || '').split(/\s+/);
  if ((requireIdentity || token.scope) && (!granted.includes(GOOGLE_CALENDAR_SCOPE)
    || (requireIdentity && (!granted.includes('openid') || !granted.some(scope=>scope==='email' || scope==='https://www.googleapis.com/auth/userinfo.email'))))) throw new Error('missing_calendar_scope');
  if (token.refresh_token!==undefined && (typeof token.refresh_token!=='string' || !token.refresh_token || token.refresh_token.length>8192)) throw new Error('google_calendar_invalid_refresh_token');
}
async function readSmallBody(response,maxBytes) {
  if (Number(response.headers.get('content-length'))>maxBytes) throw new Error('google_calendar_response_too_large');
  const reader=response.body?.getReader(); if (!reader) throw new Error('google_calendar_invalid_response');
  const chunks=[]; let length=0;
  try { while (true) { const {done,value}=await reader.read(); if (done) break; length+=value.byteLength;
    if (length>maxBytes) { await reader.cancel(); throw new Error('google_calendar_response_too_large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const data=new Uint8Array(length); let at=0; for(const part of chunks) {data.set(part,at);at+=part.byteLength;} return new TextDecoder().decode(data);
}
export async function createGoogleCalendarLink(env,agent='melodi') {
  if (!googleCalendarConfigured(env)) return {configured:false};
  if (!Object.hasOwn(NAMES,agent)) throw new Error('invalid_calendar_agent');
  const store=createGoogleCalendarStore(env); await store.ensureSchema();
  const token=await store.createNonce(owner(env),'link',{agent},Date.now()+24*3600000);
  return {configured:true,url:`${BASE}/oauth/google/start?link=${token}`,expiresAt:new Date(Date.now()+24*3600000).toISOString()};
}
export async function getGoogleCalendarAccessToken(env,connection,store,{leaseToken}={}) {
  if(env.MELODI_GOOGLE_CLIENT_REQUIRED && connection.clientId!==env.GOOGLE_CLIENT_ID){const error=Error('authorization_required');error.code='authorization_required';throw error;}
  if (connection.accessToken && connection.accessTokenExpiresAt>Date.now()+60000) return connection.accessToken;
  if (!leaseToken) throw new Error('google_calendar_lease_required');
  const token=await refreshGoogleCalendarToken({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refreshToken:connection.refreshToken});
  validToken(token);
  const updated={...connection,accessToken:token.access_token,accessTokenExpiresAt:Date.now()+Number(token.expires_in)*1000,
    ...(token.refresh_token ? {refreshToken:token.refresh_token}: {})};
  await store.putConnection(owner(env),updated,{leaseToken});
  Object.assign(connection,updated);
  return connection.accessToken;
}
async function revoke(token) {
  if (!token) return;
  const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000),redirect:'manual'});
  if (!response.ok) throw new Error('google_calendar_revoke_failed');
}
export async function disconnectGoogleCalendar(env) {
  const store=createGoogleCalendarStore(env); await store.ensureSchema();
  const connection=await store.disconnect(owner(env));
  const hasGmailTable=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_connections'").first();
  const hasGmail=hasGmailTable && await env.VETSA_CLOUD.prepare('SELECT owner FROM gmail_connections WHERE owner=?').bind(owner(env)).first();
  // Google may revoke the whole client grant, including the separately
  // consented Gmail connection. Local Calendar deletion still takes effect now.
  if (!hasGmail) try { await revoke(connection?.refreshToken || connection?.accessToken); } catch { /* Google account can revoke independently. */ }
  return {disconnected:true};
}
export async function handleGoogleCalendarRoute(request,env,url,{sendWhatsApp,sync}={}) {
  if (!url.pathname.startsWith('/oauth/google/')) return null;
  if (url.origin!==BASE || !['GET','POST'].includes(request.method)) return reply('Ruta no disponible.',404);
  if (!googleCalendarConfigured(env)) return reply('La integración todavía no está configurada. Pide un enlace nuevo cuando esté disponible.',503);
  const store=createGoogleCalendarStore(env); await store.ensureSchema();
  if (url.pathname==='/oauth/google/start') {
    let link=url.searchParams.get('link');
    if (request.method==='POST') {
      if (request.headers.get('origin')!==BASE || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type') || '')) return reply('No se pudo verificar esta solicitud.',403);
      try { link=new URLSearchParams(await readSmallBody(request,2048)).get('link'); } catch { return reply('Solicitud inválida.',400); }
    }
    const linked=request.method==='GET' ? await store.peekNonce(link,'link') : await store.consumeNonce(link,'link',{owner:owner(env)});
    if (!linked || linked.owner!==owner(env)) return reply('Este enlace venció o ya se utilizó. Pide a tu agente un enlace nuevo.',400);
    if (request.method==='GET') {
      const interstitial=reply(`Conecta el calendario privado «Brivany · Melodi». Google verificará tu cuenta y te mostrará los permisos. Revisa la <a style="color:#7de0c6" href="/privacy.html">política de privacidad</a> antes de continuar.<form method="post" action="/oauth/google/start"><input type="hidden" name="link" value="${link}"><button type="submit" style="background:#7de0c6;color:#07111f;border:0;padding:12px 18px;font:inherit;cursor:pointer">Continuar con Google</button></form>`);
      // no-referrer serializes a navigation POST's Origin as null. Preserve
      // same-origin form verification without revealing the link to Google.
      interstitial.headers.set('referrer-policy','same-origin');
      // Browsers also check form-action after redirects. Allow only Google's
      // authorization origin so the successful POST can reach consent.
      interstitial.headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com");
      return interstitial;
    }
    const verifier=calendarRandom(), browserToken=calendarRandom();
    const state=await store.createNonce(linked.owner,'consent',{agent:linked.agent,verifier,browserHash:await calendarHash(browserToken)},Date.now()+15*60000);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const destination=buildGoogleCalendarAuthorizationUrl({clientId:env.GOOGLE_CLIENT_ID,redirectUri:CALLBACK,state,codeChallenge:challenge,expectedEmail:expectedEmail(env)});
    return new Response(null,{status:302,headers:{location:destination,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`vetsa_calendar_oauth=${browserToken}; Path=/oauth/google/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`}});
  }
  if (url.pathname!== '/oauth/google/callback' || request.method!=='GET') return reply('Ruta no disponible.',404);
  const stateToken=url.searchParams.get('state');
  // A one-time state plus a browser cookie prevents linking through someone else's OAuth callback.
  const browserToken=(request.headers.get('cookie') || '').match(/(?:^|;\s*)vetsa_calendar_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
  const consent=browserToken ? await store.consumeNonce(stateToken,'consent',{owner:owner(env),browserHash:await calendarHash(browserToken)}) : null;
  if (!consent) return reply('No se pudo verificar esta vinculación. Solicita otro enlace e inicia desde él.',400);
  if (url.searchParams.has('error')) return reply('No concediste el permiso. Tu agenda de Vetsa continúa disponible y puedes vincularla más adelante.',400);
  let token,leaseToken,stage='token_exchange';
  try {
    token=await exchangeGoogleCalendarCode({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:CALLBACK,code:url.searchParams.get('code'),codeVerifier:consent.verifier});
    stage='token_validation'; validToken(token,{requireIdentity:true});
    stage='account_verification';
    const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000),redirect:'manual'});
    if (!profileResponse.ok) throw new Error('google_account_unverified');
    const profile=JSON.parse(await readSmallBody(profileResponse,65536));
    if (typeof profile.sub!=='string' || !profile.sub || profile.sub.length>255 || profile.email_verified!==true || (!String(profile.email||'').includes('@') || expectedEmail(env) && String(profile.email).toLowerCase()!==expectedEmail(env))) {
      try { await revoke(token.refresh_token || token.access_token); } catch { /* A failed provider revocation must not hide the account rejection. */ }
      return reply('No pude verificar la cuenta seleccionada. Pide a Melodi un enlace nuevo para vincular tu agenda.',403);
    }
    stage='connection_storage';
    const previous=await store.getConnection(consent.owner);
    if (!token.refresh_token && (!previous?.refreshToken || previous.subject!==profile.sub || env.MELODI_GOOGLE_CLIENT_REQUIRED && previous.clientId!==env.GOOGLE_CLIENT_ID)) throw new Error('missing_refresh_token');
    const sameCalendarOwner=previous?.subject===profile.sub&&(!env.MELODI_GOOGLE_CLIENT_REQUIRED||previous.clientId===env.GOOGLE_CLIENT_ID);
    const connection={email:profile.email,clientId:env.GOOGLE_CLIENT_ID,subject:profile.sub,refreshToken:token.refresh_token || previous.refreshToken,accessToken:token.access_token,
      accessTokenExpiresAt:Date.now()+Number(token.expires_in)*1000,calendarId:sameCalendarOwner?previous?.calendarId || null:null,syncToken:sameCalendarOwner?previous?.syncToken || null:null,agent:consent.agent,status:'connected',connectedAt:new Date().toISOString()};
    if (sameCalendarOwner && !connection.calendarId && previous?.calendarProvisionState && previous.calendarProvisionState!=='rejected') throw new Error('google_calendar_provisioning_uncertain');
    await store.putConnection(consent.owner,connection,{consentToken:stateToken});
    stage='calendar_provisioning'; leaseToken=await store.acquireLease(consent.owner);
    if (!leaseToken) throw new Error('google_calendar_connection_busy');
    if(!sameCalendarOwner){
      await store.assertLease(consent.owner,leaseToken);
      await env.VETSA_CLOUD.prepare('DELETE FROM melodi_google_calendar_activity_map WHERE owner=?').bind(consent.owner).run();
    }
    if (!connection.calendarId) {
      connection.calendarProvisionState='pending'; await store.putConnection(consent.owner,connection,{leaseToken});
      const client=createGoogleCalendarClient({accessToken:token.access_token});
      let calendar;
      try { calendar=await client.createCalendar({summary:'Brivany · Melodi',description:'Agenda privada de Melodi en Brivany. Puedes modificar fechas, títulos y recurrencias o cancelar las actividades.'}); }
      catch(error) { connection.calendarProvisionState=error?.uncertain || error?.status>=500 ? 'uncertain':'rejected'; await store.putConnection(consent.owner,connection,{leaseToken}); throw error; }
      if (typeof calendar.id!=='string' || !calendar.id) throw new Error('google_calendar_invalid_calendar');
      connection.calendarId=calendar.id; connection.calendarProvisionState='ready'; await store.putConnection(consent.owner,connection,{leaseToken});
    }
    await store.releaseLease(consent.owner,leaseToken); leaseToken=null;
    if (sync) { try { await sync(env); } catch { /* The durable link remains valid; scheduled synchronization can retry. */ } }
    if (sendWhatsApp) { try { await sendWhatsApp(env,consent.owner,`${NAMES[consent.agent]}: Vinculé tu calendario «Brivany · Melodi» con Google Calendar. Ahí podrás ver las actividades, cambiar sus fechas y cancelar las que ya no necesites. Se sincroniza cada minuto: https://calendar.google.com/calendar/u/0/r`); } catch { /* Transport failure does not undo an established OAuth connection. */ } }
    const result=reply('Tu cuenta está vinculada. Abre Google Calendar y selecciona «Brivany · Melodi». Las actividades y sus cambios se sincronizan cada minuto.');
    result.headers.set('set-cookie','vetsa_calendar_oauth=; Path=/oauth/google/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    return result;
  } catch (error) {
    // Logs intentionally exclude OAuth codes, tokens, account data, and provider response bodies.
    const code=failureCode(error);
    console.error('google_calendar_connect_failed',{code,stage});
    if (code==='missing_calendar_scope') return reply('Google no concedió todos los permisos necesarios. Solicita otro enlace y permite administrar el calendario creado por Vetsa al revisar los permisos de Google.',403);
    return reply('No se pudo completar la vinculación. No se ha confirmado la sincronización. Solicita otro enlace; tu agenda original se conserva.',502);
  } finally {
    if (leaseToken) await store.releaseLease(consent.owner,leaseToken);
  }
}
export async function handleGoogleCalendarOwnerMessage(env,phone,message,agent,sendWhatsApp) {
  if (phone!==owner(env)) return false;
  const mainRequest=stripAgentAddress(message,{includeStacy:true});
  if (documentArtifactRequest(mainRequest)) return false;
  // Only the request heading authorizes Calendar actions. Supplied document
  // text, including an inline body, must never link or disconnect an account.
  const normalized=mainRequest.split(/\r?\n/,1)[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const documentHeading=normalized.replace(/^(?:por favor[, :]*)?(?:quiero|necesito)\s+(?:que\s+)?(?:me\s+)?/,'');
  if (/^(?:por favor[, :]*)?(?:(?:puedes|podrias)\s+)?(?:crea\w*|crees|genera\w*|generes|prepara\w*|prepares|haz\w*|hagas|convierte\w*|transforma\w*|exporta\w*)\b/.test(documentHeading)
    && /\b(?:pdf|docx|txt|documentos?|cotizaciones?|facturas?|plantillas?)\b/.test(documentHeading)) return false;
  if (!/google\s*calendar|calendario\s+de\s+google/.test(normalized)) return false;
  if (/\b(?:no|nunca|evita|sin)\b[^.!?\n]{0,60}\b(?:desvincula|desconecta|revoca|vincula|conecta|vincular|conectar)\b/.test(normalized)) return false;
  if (/\b(?:desvincula|desconecta|revoca)\b/.test(normalized)) {
    await disconnectGoogleCalendar(env); await sendWhatsApp(env,phone,`${NAMES[agent] || 'Melodi'}: Desvinculé Google Calendar y borré las credenciales de acceso guardadas. Tus actividades siguen en Vetsa.`); return true;
  }
  if (!/\b(?:vincula|conecta|vincular|conectar|enlace|link)\b/.test(normalized)) return false;
  const link=await createGoogleCalendarLink(env,agent);
  await sendWhatsApp(env,phone,link.configured ? `${NAMES[agent] || 'Melodi'}: Vincula tu cuenta felixdanielluna40@gmail.com aquí: ${link.url}\nEl enlace es personal, se usa una vez y vence en 24 horas. Google te mostrará los permisos antes de aceptar.` : `${NAMES[agent] || 'Melodi'}: Google Calendar aún requiere configurar sus credenciales. Te enviaré el enlace cuando la vinculación esté disponible.`);
  return true;
}
