import { driveHash, driveRandom } from './drive-store.js';
import { createDriveStore } from './drive-store.js';
import { DRIVE_SCOPE, hasDriveAccess, DriveError, createDriveClient, buildDriveAuthorizationUrl, exchangeDriveCode, refreshDriveToken, readDriveJson, validateDriveDocument } from './drive-client.js';

const BASE='https://ia.vetsa.es', CALLBACK=`${BASE}/oauth/google/callback`;
export const driveConfigured=env=>Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.MEMORY_ENCRYPTION_KEY && env.VETSA_CLOUD);
export function driveOwner(env,phone=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')) {
  if(!/^\d{8,15}$/.test(phone) || phone!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,''))throw Error('drive_owner_required');return phone;
}
export const expectedDriveEmail=env=>String(env.DRIVE_OWNER_EMAIL || env.GMAIL_OWNER_EMAIL || env.GOOGLE_CALENDAR_OWNER_EMAIL || '').toLowerCase();
const expectedEmail=expectedDriveEmail;
function validToken(token,identity=false) {
  if(typeof token?.access_token!=='string' || !token.access_token || token.access_token.length>8192 || /[\r\n]/.test(token.access_token)
    || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in)<1 || Number(token.expires_in)>86400)throw new DriveError('invalid_token');
  const scopes=String(token.scope || '').split(/\s+/);
  if((identity || token.scope) && (!hasDriveAccess(scopes) || identity && (!scopes.includes('openid') || !scopes.some(scope=>scope==='email' || scope==='https://www.googleapis.com/auth/userinfo.email'))))throw new DriveError('missing_scope');
  if(token.refresh_token!==undefined && (typeof token.refresh_token!=='string' || !token.refresh_token || token.refresh_token.length>8192 || /[\r\n]/.test(token.refresh_token)))throw new DriveError('invalid_refresh_token');
}
const page=(body,status=200)=>new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brivany · Drive</title><body style="font:17px/1.6 system-ui;background:#07111f;color:#e5eefb;margin:0;padding:5vw"><main style="max-width:680px;margin:auto"><h1>Conectar Drive</h1><p>${body}</p><p><a href="/privacy.html" style="color:#7de0c6">Política de privacidad</a></p></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'x-content-type-options':'nosniff'}});
const clearCookie=response=>{response.headers.set('set-cookie','vetsa_drive_oauth=; Path=/oauth/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');return response;};
export async function createDriveLink(env,{store:providedStore,now=Date.now()}={}) {
  if(!driveConfigured(env))return {configured:false};
  const store=providedStore || createDriveStore(env);
  await store.ensureSchema();const token=await store.createNonce(driveOwner(env),'link',{},now+24*3600000);
  return {configured:true,url:`${BASE}/oauth/drive/start?link=${token}`,expiresAt:new Date(now+24*3600000).toISOString()};
}
/** Disconnect locally only: Google's shared project grant may also cover Calendar. */
export async function disconnectDrive(env,{store=createDriveStore(env)}={}) {await store.ensureSchema();await store.disconnect(driveOwner(env));return {disconnected:true};}
export async function getDriveAccessToken(env,connection,store,{leaseToken,now=Date.now(),fetcher=fetch}={}) {
  if(!hasDriveAccess(connection.scopes))throw new DriveError('authorization_required');
  if(env.MELODI_GOOGLE_CLIENT_REQUIRED && connection.clientId!==env.GOOGLE_CLIENT_ID)throw new DriveError('authorization_required');
  if(connection.accessToken && connection.accessTokenExpiresAt>now+60000)return connection.accessToken;
  if(!leaseToken)throw new DriveError('lease_required');
  try {
    const token=await refreshDriveToken({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refreshToken:connection.refreshToken,fetcher});validToken(token);
    const updated={...connection,accessToken:token.access_token,accessTokenExpiresAt:now+Number(token.expires_in)*1000,...(token.refresh_token?{refreshToken:token.refresh_token}:{})};
    await store.putConnection(driveOwner(env),updated,{leaseToken});Object.assign(connection,updated);return updated.accessToken;
  }catch(error){if(error.code==='authorization_required')await store.putConnection(driveOwner(env),{...connection,status:'reconnect_required'},{leaseToken}).catch(()=>{});throw error;}
}
export async function withDriveClient(env,phone,operation,{store=createDriveStore(env),fetcher=fetch,now=Date.now()}={}) {
  driveOwner(env,phone);await store.ensureSchema();
  const leaseToken=await store.acquireLease(phone);
  if(!leaseToken){const connection=await store.getConnection(phone);throw new DriveError(connection?.status==='connected'?'connection_busy':'authorization_required');}
  try {
    const connection=await store.getConnection(phone);
    if(!connection || connection.status!=='connected' || (expectedEmail(env) && String(connection.email || '').toLowerCase()!==expectedEmail(env)) || !hasDriveAccess(connection.scopes))throw new DriveError('authorization_required');
    const accessToken=await getDriveAccessToken(env,connection,store,{leaseToken,now,fetcher});
    return await operation(createDriveClient({accessToken:async()=>{await store.assertLease(phone,leaseToken);return accessToken;},fetcher}),{email:connection.email,store});
  }catch(error){
    if(error.code==='authorization_required'){
      const connection=await store.getConnection(phone);
      if(connection)await store.putConnection(phone,{...connection,status:'reconnect_required'},{leaseToken}).catch(()=>{});
    }
    throw error;
  }finally{await store.releaseLease(phone,leaseToken);}
}
/** Call before Calendar's route for the shared, already registered callback. */
export async function handleDriveRoute(request,env,url,{store:customStore,fetcher=fetch,now=Date.now()}={}) {
  const driveCallback=url.pathname==='/oauth/google/callback' && /^drive\./.test(url.searchParams.get('state') || '');
  if(!url.pathname.startsWith('/oauth/drive/') && !driveCallback)return null;
  if(url.origin!==BASE || !['GET','POST'].includes(request.method))return page('Ruta no disponible.',404);
  if(!driveConfigured(env))return page('La conexión con Drive todavía no está configurada.',503);
  const store=customStore || createDriveStore(env);await store.ensureSchema();const owner=driveOwner(env);
  if(url.pathname==='/oauth/drive/start') {
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
      const result=page(`Google te pedirá permiso de lectura de tus archivos existentes y acceso a los archivos que crees con Brivany. Melodi podrá buscar y leer los formatos compatibles y crear documentos privados de texto cuando se lo pidas. Esta integración no ofrece eliminar ni compartir archivos. Conectar la cuenta no crea ni cambia documentos.<form method="post" action="/oauth/drive/start"><input type="hidden" name="link" value="${link}"><button type="submit" style="background:#7de0c6;color:#07111f;border:0;padding:12px 18px;font:inherit">Autorizar acceso a Drive con Google</button></form>`);
      result.headers.set('referrer-policy','same-origin');result.headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com");return result;
    }
    const verifier=driveRandom(),browserToken=driveRandom();
    const token=await store.createNonce(owner,'consent',{verifier,browserHash:await driveHash(browserToken)},now+15*60000);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    const codeChallenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return new Response(null,{status:302,headers:{location:buildDriveAuthorizationUrl({clientId:env.GOOGLE_CLIENT_ID,redirectUri:CALLBACK,state:`drive.${token}`,codeChallenge,expectedEmail:expectedEmail(env)}),'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`vetsa_drive_oauth=${browserToken}; Path=/oauth/; Max-Age=900; HttpOnly; Secure; SameSite=Lax`}});
  }
  if(!driveCallback || request.method!=='GET')return page('Ruta no disponible.',404);
  const state=url.searchParams.get('state');if(!/^drive\.[a-f0-9]{64}$/.test(state))return page('Vinculación inválida.',400);
  const browserToken=(request.headers.get('cookie') || '').match(/(?:^|;\s*)vetsa_drive_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
  const consent=browserToken?await store.consumeNonce(state.slice(6),'consent',{owner,browserHash:await driveHash(browserToken)}):null;
  if(!consent)return page('No se pudo verificar esta vinculación. Solicita otro enlace.',400);
  if(url.searchParams.has('error'))return clearCookie(page('No concediste el permiso. Puedes conectar Drive más adelante.',400));
  try{
    const token=await exchangeDriveCode({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:CALLBACK,code:url.searchParams.get('code'),codeVerifier:consent.verifier,fetcher});validToken(token,true);
    const identityResponse=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!identityResponse.ok || identityResponse.status>=300)throw new DriveError('account_unverified');
    const profile=await readDriveJson(identityResponse,65536);
    if(typeof profile.sub!=='string' || !profile.sub || profile.sub.length>255 || profile.email_verified!==true || (!String(profile.email||'').includes('@') || expectedEmail(env) && String(profile.email).toLowerCase()!==expectedEmail(env)))return clearCookie(page('Selecciona la cuenta autorizada para vincular Drive. Pide un enlace nuevo.',403));
    const driveProfile=await createDriveClient({accessToken:token.access_token,fetcher}).getAccount();
    if(String(driveProfile.user?.emailAddress || '').toLowerCase()!==String(profile.email).toLowerCase())throw new DriveError('account_unverified');
    const previous=await store.getConnection(owner);
    if(!token.refresh_token && (!previous?.refreshToken || previous.subject!==profile.sub || env.MELODI_GOOGLE_CLIENT_REQUIRED && previous.clientId!==env.GOOGLE_CLIENT_ID || !hasDriveAccess(previous.scopes)))throw new DriveError('missing_refresh_token');
    await store.putConnection(owner,{status:'connected',email:String(profile.email).toLowerCase(),clientId:env.GOOGLE_CLIENT_ID,subject:profile.sub,accessToken:token.access_token,
      scopes:String(token.scope).split(/\s+/),refreshToken:token.refresh_token || previous.refreshToken,accessTokenExpiresAt:now+Number(token.expires_in)*1000,connectedAt:new Date(now).toISOString()},{expectedVersion:previous?.version ?? 0,consentToken:state.slice(6)});
    return clearCookie(page('Tu Drive está conectado. Ya puedes volver al chat.'));
  }catch(error){
    const missing=error?.code==='missing_scope';
    if(error?.code==='api_disabled')return clearCookie(page('Drive API está desactivada en el proyecto de Google Cloud. <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=brivany" style="color:#7de0c6" rel="noreferrer">Activa Drive API en brivany</a> y después pide un enlace nuevo para conectar tu cuenta.',503));
    return clearCookie(page(missing?'Google no concedió todos los permisos solicitados. Pide otro enlace y revisa los permisos.':'No pude completar la conexión con Drive. Pide un enlace nuevo e inténtalo otra vez.',missing?403:502));
  }
}

/** Plain-text uploads use Google's pre-generated IDs; Workspace conversions do not support them.
 * https://developers.google.com/workspace/drive/api/guides/create-file#generate-ids
 * The stable requestKey must be the originating owner message/action identity.
 */
export async function createDriveDocument(env,phone,input,{requestKey,...options}={}) {
  driveOwner(env,phone);const document=validateDriveDocument(input);
  if(typeof requestKey!=='string' || !requestKey || requestKey.length>500)throw new DriveError('create_request_required');
  return withDriveClient(env,phone,async(api,{store})=>{
    const mutation=await store.claimMutation(phone,requestKey,JSON.stringify(document));
    const requestHash=await driveHash(JSON.stringify([phone,requestKey]));
    if(mutation.status==='created')return {created:true,replayed:true,file:{id:mutation.fileId,name:document.name,mimeType:'text/plain',webViewLink:`https://drive.google.com/file/d/${mutation.fileId}/view`}};
    let fileId=mutation.fileId;
    const finish=async file=>{
      try{await store.finishMutation(phone,requestKey,{fileId});}catch{throw new DriveError('create_unconfirmed',{uncertain:true});}
      return {created:true,replayed:!mutation.claimed,file};
    };
    if(fileId){
      try{return await finish(await api.verifyCreatedDocument(fileId,{...document,requestHash}));}
      catch(error){if(error.code!=='not_found')throw error;}
    }else fileId=await store.setMutationFileId(phone,requestKey,await api.generateFileId());
    try{return await finish(await api.createDocument({...document,fileId,requestHash}));}
    catch(error){
      if(error.code!=='already_exists')throw error;
      return finish(await api.verifyCreatedDocument(fileId,{...document,requestHash}));
    }
  },options);
}

