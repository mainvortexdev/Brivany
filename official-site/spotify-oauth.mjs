import {DurableObject} from 'cloudflare:workers';

const BASE = 'https://brivany.example';
const REDIRECT = BASE + '/spotify/callback';
const SCOPES = 'user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-read-recently-played streaming user-read-private user-read-email';
const COOKIE = '__Secure-brivany_spotify';
const TTL = 300;
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const sameDigest=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let difference=0;for(let i=0;i<64;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;};
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encoder = new TextEncoder();

const headers = {
  'Cache-Control': 'no-store, private', 'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
const json = (value, status=200) => Response.json(value, {status, headers});
function base64url(bytes) {return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64url(value) {return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
async function sha256(value) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function signingKey(env) {
  if (typeof env.SPOTIFY_RELAY_SIGNING_KEY !== 'string' || env.SPOTIFY_RELAY_SIGNING_KEY.length < 43) throw new Error('unavailable');
  return crypto.subtle.importKey('raw',encoder.encode(env.SPOTIFY_RELAY_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function sign(nonce, expires, env) {
  const payload = nonce+'.'+expires;
  return payload+'.'+base64url(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(payload)));
}
async function verify(state, env) {
  const match = typeof state==='string' && state.match(/^([A-Za-z0-9_-]{43})\.(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const expires=Number(match[2]),now=Math.floor(Date.now()/1000);
  if (expires<=now || expires>now+TTL+5) return null;
  const signature=unbase64url(match[3]);
  if(base64url(signature)!==match[3])return null;
  const valid=await crypto.subtle.verify('HMAC',await signingKey(env),signature,encoder.encode(match[1]+'.'+match[2]));
  return valid?{nonce:match[1],expires}:null;
}
function page(message, status=200, cookie=null) {
  const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify · Melodi WorkSpace</title><script src="/spotify/return.js" defer></script><style>html{color-scheme:dark;background:#080909;color:#eeeae2;font:16px system-ui}body{min-height:90vh;display:grid;place-items:center;margin:0}main{max-width:440px;padding:32px}h1{font-size:25px;font-weight:500}p{color:#a6b1ab;line-height:1.7}a{color:inherit}</style></head><body><main><h1>Melodi WorkSpace</h1><p>'+message+'</p><a href="/">Brivany</a></main></body></html>';
  const result=new Headers({...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
  if(cookie)result.set('Set-Cookie',cookie);
  return new Response(html,{status,headers:result});
}
function clearCookie(){return COOKIE+'=; Path=/spotify/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';}
async function body(request) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('invalid');
  const reader=request.body?.getReader();if(!reader)throw new Error('invalid');
  let size=0,chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw new Error('invalid');}chunks.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid');
  return parsed;
}
function bearer(request) {const match=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);return match?.[1]||null;}

/** One short-lived flow per random identity. Tokens and PKCE verifiers never enter this object. */
export class SpotifyOAuthSession extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS flow (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');}
  read(){if(this.cleared)return null;return this.ctx.storage.sql.exec('SELECT data FROM flow WHERE id=1').toArray().map(row=>JSON.parse(row.data))[0]||null;}
  write(value){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO flow(id,data) VALUES(1,?)',JSON.stringify(value));}
  async initialize(value){
    if(this.read())return {status:409};
    this.write({...value,phase:'pending',browserHash:null,code:null,error:null});
    await this.ctx.storage.setAlarm(value.expires*1000);
    return {status:201};
  }
  launch(launchHash,browserHash){
    const value=this.read();if(!value||value.expires*1000<=Date.now())return {status:410};
    if(!sameDigest(value.launchHash,launchHash)||value.browserHash||value.phase!=='pending')return {status:403};
    this.write({...value,browserHash,launchHash:null});return {status:200,challenge:value.challenge,clientId:value.clientId};
  }
  complete(browserHash,code,error){
    const value=this.read();if(!value||value.expires*1000<=Date.now())return {status:410};
    if(!value.browserHash||!sameDigest(value.browserHash,browserHash))return {status:403};
    if(value.phase!=='pending')return {status:409};
    this.write({...value,phase:'ready',browserHash:null,code,error});return {status:200};
  }
  poll(readHash){
    const value=this.read();if(!value||value.expires*1000<=Date.now())return {status:410};
    if(!sameDigest(value.readHash,readHash))return {status:403};
    return {status:200,phase:value.phase,...(value.phase==='ready'?{code:value.code,error:value.error}:{})};
  }
  async acknowledge(readHash){
    const value=this.read();if(!value)return {status:410};if(!sameDigest(value.readHash,readHash))return {status:403};
    this.cleared=true;await this.ctx.storage.deleteAll();await this.ctx.storage.deleteAlarm();return {status:200};
  }
  async alarm(){this.cleared=true;await this.ctx.storage.deleteAll();}
}

export async function handleSpotifyOAuth(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/spotify/')&&!path.startsWith('/api/spotify/'))return null;
  if(url.origin!==BASE)return json({error:'invalid_origin'},403);
  const origin=request.headers.get('Origin');if(origin&&origin!==BASE)return json({error:'invalid_origin'},403);
  try{
    if(path==='/spotify/return.js'&&request.method==='GET')return new Response("history.replaceState(null,'','/spotify/callback');",{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8','Content-Security-Policy':"default-src 'none'"}});
    const clientId=env.SPOTIFY_CLIENT_ID;
    if(!/^[a-fA-F0-9]{32}$/.test(clientId||'')||!env.SPOTIFY_OAUTH_SESSIONS||!env.SPOTIFY_RELAY_SIGNING_KEY)return json({error:'unavailable'},503);
    if(path==='/api/spotify/config'&&request.method==='GET')return json({client_id:clientId,redirect_uri:REDIRECT,expires_in:TTL});
    if(path==='/api/spotify/oauth/start'&&request.method==='POST'){
      const data=await body(request);
      if(Object.keys(data).some(k=>!['nonce','client_id','challenge','read_hash','launch_hash'].includes(k))||data.client_id!==clientId||!token(data.nonce)||!token(data.challenge)||!digest(data.read_hash)||!digest(data.launch_hash))return json({error:'invalid_request'},400);
      const key=await sha256(request.headers.get('CF-Connecting-IP')||'unknown');
      if(!env.SPOTIFY_START_LIMIT||!(await env.SPOTIFY_START_LIMIT.limit({key:'spotify-start:'+key})).success)return json({error:'slow_down'},429);
      const expires=Math.floor(Date.now()/1000)+TTL,state=await sign(data.nonce,expires,env);
      const result=await env.SPOTIFY_OAUTH_SESSIONS.getByName(data.nonce).initialize({clientId,challenge:data.challenge,readHash:data.read_hash,launchHash:data.launch_hash,expires});
      return result.status===201?json({state,client_id:clientId,redirect_uri:REDIRECT,expires_in:TTL},201):json({error:'flow_exists'},result.status);
    }
    if(path==='/spotify/connect'&&request.method==='GET'){
      const state=url.searchParams.get('state'),launch=url.searchParams.get('launch');
      if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('launch').length!==1||!token(launch))return page('La vinculación no es válida. Comienza de nuevo desde Melodi.',400);
      const valid=await verify(state,env);if(!valid)return page('La vinculación ha caducado. Comienza de nuevo desde Melodi.',400);
      const browser=base64url(crypto.getRandomValues(new Uint8Array(32)));
      const result=await env.SPOTIFY_OAUTH_SESSIONS.getByName(valid.nonce).launch(await sha256(launch),await sha256(browser));
      if(result.status!==200)return page('Esta vinculación ya no está disponible. Comienza de nuevo desde Melodi.',result.status);
      const target=new URL('https://accounts.spotify.com/authorize');
      target.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:REDIRECT,scope:SCOPES,state,code_challenge_method:'S256',code_challenge:result.challenge}).toString();
      return new Response(null,{status:303,headers:{...headers,Location:target.toString(),'Set-Cookie':COOKIE+'='+browser+'; Path=/spotify/; Secure; HttpOnly; SameSite=Lax; Max-Age='+TTL}});
    }
    if(path==='/spotify/callback'&&request.method==='GET'){
      if(!url.search)return page('El retorno seguro de Spotify está preparado. Inicia la vinculación desde Melodi WorkSpace.');
      const state=url.searchParams.get('state'),valid=await verify(state,env),code=url.searchParams.get('code'),error=url.searchParams.get('error');
      const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Secure-brivany_spotify=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
      if(!valid||!cookie||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length>1||url.searchParams.getAll('error').length>1||!!code===!!error||code&&(code.length>4096||/[\x00-\x20\x7f]/.test(code)))return page('No se pudo verificar esta vinculación. Comienza de nuevo desde Melodi.',400,clearCookie());
      const result=await env.SPOTIFY_OAUTH_SESSIONS.getByName(valid.nonce).complete(await sha256(cookie),code||null,error?(error==='access_denied'?'access_denied':'authorization_failed'):null);
      if(result.status!==200)return page('Esta vinculación ya no está disponible. Comienza de nuevo desde Melodi.',result.status,clearCookie());
      return page(error?'La autorización se canceló. Puedes volver a Melodi.':'Autorización recibida. Vuelve a Melodi WorkSpace para terminar la conexión.',200,clearCookie());
    }
    if(['/api/spotify/oauth/poll','/api/spotify/oauth/ack'].includes(path)&&request.method==='POST'){
      const secret=bearer(request);if(!secret)return json({error:'unauthorized'},401);
      const data=await body(request),valid=await verify(data.state,env);if(!valid)return json({error:'expired'},410);
      if(!env.SPOTIFY_POLL_LIMIT||!(await env.SPOTIFY_POLL_LIMIT.limit({key:'spotify-poll:'+await sha256(data.state+secret)})).success)return json({error:'slow_down'},429);
      const stub=env.SPOTIFY_OAUTH_SESSIONS.getByName(valid.nonce),hash=await sha256(secret);
      const result=path.endsWith('/ack')?await stub.acknowledge(hash):await stub.poll(hash);
      if(result.status!==200)return json({error:result.status===410?'expired':'unauthorized'},result.status);
      return json(path.endsWith('/ack')?{ok:true}:{status:result.phase,...(result.phase==='ready'?{code:result.code,error:result.error}:{})});
    }
    return json({error:'not_found'},404);
  }catch{return json({error:'request_failed'},400);}
}
