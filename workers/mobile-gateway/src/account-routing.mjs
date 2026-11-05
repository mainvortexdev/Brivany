import {AccountError,accountKey,emailAddress,sessionParts,equal} from './account-crypto.mjs';

const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
export function bearer(request){return request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';}
export function hubFor(env,key){if(!env.ACCOUNTS)throw new AccountError('not_configured',503);return env.ACCOUNTS.getByName(key);}
export async function accountIdentity(request,env){
  const token=bearer(request),parts=sessionParts(token);if(!parts)return null;
  const hub=hubFor(env,parts.account),identity=await hub.authorize(parts.account,token);
  return {...identity,key:parts.account,token,hub};
}
async function body(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AccountError('invalid_request');
  const reader=request.body?.getReader();if(!reader)throw new AccountError('invalid_request');let size=0;const rows=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new AccountError('invalid_request',413);rows.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const raw=new Uint8Array(size);let at=0;for(const row of rows){raw.set(row,at);at+=row.length;}
  let parsed;try{parsed=JSON.parse(new TextDecoder().decode(raw));}catch{throw new AccountError('invalid_request');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new AccountError('invalid_request');return parsed;
}
export async function accountRoute(request,env){
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/v1/account/')&&!path.startsWith('/v1/commands')&&path!=='/v1/devices'&&path!=='/v1/host')return null;
  try{
    if(request.headers.has('Origin'))throw new AccountError('unsupported_origin',403);
    if(path==='/v1/account/provision'&&request.method==='POST'){
      if(typeof env.ACCOUNT_ADMIN_TOKEN!=='string'||env.ACCOUNT_ADMIN_TOKEN.length<32||!equal(bearer(request),env.ACCOUNT_ADMIN_TOKEN))throw new AccountError('unauthorized',401);
      const input=await body(request),key=accountKey(emailAddress(input.email),env.ACCOUNT_PEPPER);
      return json(await hubFor(env,key).provision(key,input),201);
    }
    if(path==='/v1/account/login'&&request.method==='POST'){
      const rate=await env.ACCOUNT_AUTH_LIMIT?.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
      if(!rate?.success)throw new AccountError('rate_limit',429);
      const input=await body(request),key=accountKey(emailAddress(input.email),env.ACCOUNT_PEPPER);
      return json(await hubFor(env,key).login(key,input));
    }
    const identity=await accountIdentity(request,env);if(!identity)throw new AccountError('unauthorized',401);
    const limited=await env.MOBILE_LIMIT?.limit({key:'account:'+identity.key});if(!limited?.success)throw new AccountError('rate_limit',429);
    const op=(action,input)=>identity.hub.operation(identity.key,identity.token,action,input);
    if(path==='/v1/account/me'&&request.method==='GET')return json({account:identity.account,session:{device_id:identity.session.device_id,expires_at:identity.session.expires},devices:identity.devices});
    if(path==='/v1/account/logout'&&request.method==='POST')return json(await op('logout'));
    if(path==='/v1/account/revoke'&&request.method==='POST')return json(await op('revoke',await body(request)));
    if(path==='/v1/devices'&&request.method==='GET')return json({devices:identity.devices});
    if(path==='/v1/commands'&&request.method==='POST')return json(await op('command',await body(request)),202);
    if(path==='/v1/commands/select'&&request.method==='POST')return json(await op('select',await body(request)),202);
    if(/^\/v1\/commands\/[a-f0-9-]{36}$/.test(path)&&request.method==='GET')return json(await op('command_status',{id:path.split('/').at(-1)}));
    if(path==='/v1/host'&&request.method==='GET')return identity.hub.fetch(request);
    throw new AccountError('not_found',404);
  }catch(error){const code=error?.code||'unauthorized',status=error?.status||401;return json({error:{code,message:({invalid_credentials:'El correo o la contraseña no son correctos.',invalid_request:'Revisa los datos.',rate_limit:'Espera un momento antes de volver a intentarlo.',account_exists:'La cuenta ya existe.',unauthorized:'Inicia sesión en Brivany.'})[code]||'No se pudo completar la solicitud.'}},status);}
}
