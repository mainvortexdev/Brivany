import {melodiEnvironment} from './melodi-identity.js';

const phone=value=>String(value||'').replace(/\D/g,'');
const validPhone=value=>/^\d{8,15}$/.test(value);
export const TENANT_SCHEMA=Object.freeze([
  `CREATE TABLE IF NOT EXISTS brivany_whatsapp_profiles(user_id TEXT PRIMARY KEY,profile_encrypted TEXT NOT NULL,profile_iv TEXT NOT NULL,time_zone TEXT NOT NULL,updated_at INTEGER NOT NULL)`,
  // Ownership survives unlinking. A different account must never inherit the
  // previous account's phone-scoped Google tokens, memory or documents.
  `CREATE TABLE IF NOT EXISTS brivany_whatsapp_identities(phone TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at INTEGER NOT NULL)`,
]);
export async function ensureTenantSchema(env){
  await env.VETSA_CLOUD.batch(TENANT_SCHEMA.map(sql=>env.VETSA_CLOUD.prepare(sql)));
  const existing=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vetsa_app_agent_links'").first();
  if(existing)await env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO brivany_whatsapp_identities(phone,user_id,created_at)
    SELECT phone,user_id,linked_at FROM vetsa_app_agent_links WHERE phone IS NOT NULL AND linked_at IS NOT NULL`).run();
}
export async function saveTenantProfile(env,user,services,{timeZone='UTC'}={}){
  if(typeof user?.id!=='string'||!user.id||typeof user.email!=='string'||!user.email.includes('@'))throw Error('tenant_identity_required');
  if(typeof timeZone!=='string'||timeZone.length>100)throw Error('invalid_tenant_time_zone');
  try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw Error('invalid_tenant_time_zone');}
  await ensureTenantSchema(env);
  const sealed=await services.encrypt(JSON.stringify({userId:user.id,email:user.email,name:typeof user.name==='string'?user.name.slice(0,200):''}));
  await env.VETSA_CLOUD.prepare(`INSERT INTO brivany_whatsapp_profiles(user_id,profile_encrypted,profile_iv,time_zone,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET profile_encrypted=excluded.profile_encrypted,profile_iv=excluded.profile_iv,time_zone=excluded.time_zone,updated_at=excluded.updated_at`)
    .bind(user.id,sealed.encrypted,sealed.iv,timeZone,Date.now()).run();
}
export async function linkedTenant(env,number,services){
  const normalized=phone(number);if(!validPhone(normalized))return null;
  await ensureTenantSchema(env);
  const exists=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vetsa_app_agent_links'").first();
  const row=exists?await env.VETSA_CLOUD.prepare(`SELECT l.user_id,l.phone,p.profile_encrypted,p.profile_iv,p.time_zone FROM vetsa_app_agent_links l
    LEFT JOIN brivany_whatsapp_profiles p ON p.user_id=l.user_id WHERE l.phone=? AND l.linked_at IS NOT NULL`).bind(normalized).first():null;
  if(!row){
    // Keep the configured original operator's phone-owned tools during migration.
    // A durable ownership record prevents unlinking from restoring this access.
    const primary=phone(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER);
    const prior=await env.VETSA_CLOUD.prepare('SELECT user_id FROM brivany_whatsapp_identities WHERE phone=?').bind(normalized).first();
    return normalized===primary&&!prior?{userId:'legacy-owner:'+normalized,phone:normalized,email:env.OWNER_EMAIL_FORWARD_TO||'',timeZone:env.TIME_ZONE||'UTC',legacy:true}:null;
  }
  let profile={};
  if(row.profile_encrypted){const decoded=await services.decrypt(row.profile_encrypted,row.profile_iv);profile=typeof decoded==='string'?JSON.parse(decoded):decoded;
    if(profile?.userId!==row.user_id)throw Error('tenant_profile_integrity');}
  return{userId:row.user_id,phone:normalized,email:profile.email||'',timeZone:row.time_zone||env.TIME_ZONE||'UTC'};
}
export function tenantEnvironment(env,tenant){
  if(!validPhone(tenant?.phone)||typeof tenant.userId!=='string'||!tenant.userId)throw Error('tenant_scope_required');
  const primary=phone(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER);
  const scoped={...env,MELODI_PRIMARY_OWNER:primary,MELODI_TENANT_USER_ID:tenant.userId,MELODI_BUSINESS_ADMIN:tenant.phone===primary,OWNER_WHATSAPP_NUMBER:tenant.phone,TIME_ZONE:tenant.timeZone||'UTC'};
  if(tenant.phone!==primary){
    // These connections belong to the original business, not to every account
    // that knows the public number. Google connections are separately owned.
    for(const key of ['BREVO_API_KEY','INSTAGRAM_INTERNAL_TOKEN','INSTAGRAM_ACCOUNT_ID','VETSA_INSTAGRAM_OPERATIONS',
      'OWNER_COGNIRA_DEVICE_ID','REQUESTED_MOTIVATION_RESTORE_REV','PERSONAL_ROUTINES_SETUP_REV','OWNER_CONTACT_POLICY_BOOTSTRAP_TOPICS'])scoped[key]='';
    for(const key of Object.keys(scoped))if(key.startsWith('REQUESTED_')&&key.endsWith('_REV'))scoped[key]='';
    scoped.OWNER_EMAIL_FORWARD_TO=tenant.email;
    scoped.GOOGLE_CALENDAR_OWNER_EMAIL='';
  }
  return melodiEnvironment(scoped);
}
export async function queuedTenantEnvironment(env,number,services){
  const normalized=phone(number),primary=phone(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER);
  const target=normalized||primary;if(!validPhone(target))return null;
  const tenant=await linkedTenant(env,target,services);return tenant?tenantEnvironment(env,tenant):null;
}
export async function activeTenants(env,services){
  await ensureTenantSchema(env);
  const exists=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vetsa_app_agent_links'").first();if(!exists)return[];
  const {results=[]}=await env.VETSA_CLOUD.prepare('SELECT phone FROM vetsa_app_agent_links WHERE phone IS NOT NULL AND linked_at IS NOT NULL ORDER BY user_id').all();
  const tenants=[];for(const row of results){const tenant=await linkedTenant(env,row.phone,services);if(tenant)tenants.push(tenant);}return tenants;
}
/** Resolve a consent owner's scope from a one-use nonce, never a user-supplied phone. */
export async function oauthTenantEnvironment(request,env,url,services){
  if(!url.pathname.startsWith('/oauth/'))return env;
  let token=url.searchParams.get('state')||url.searchParams.get('link');
  if(!token&&request.method==='POST'){
    const reader=request.clone().body?.getReader();if(!reader)return env;
    let size=0,text='';const decoder=new TextDecoder();
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048)throw Error('oauth_body_too_large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    finally{reader.releaseLock();}
    token=new URLSearchParams(text).get('link');
  }
  const service=/^drive\./.test(token||'')||url.pathname.startsWith('/oauth/drive/')?'drive':
    /^gmail\./.test(token||'')||url.pathname.startsWith('/oauth/gmail/')?'gmail':'google_calendar';
  token=String(token||'').replace(/^(?:drive|gmail)\./,'');
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))return env;
  const table={drive:'drive_oauth',gmail:'gmail_oauth',google_calendar:'google_calendar_oauth'}[service];
  const exists=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();if(!exists)return env;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
  const row=await env.VETSA_CLOUD.prepare(`SELECT owner FROM ${table} WHERE token_hash=? AND expires_at>? AND consumed_at IS NULL`).bind(hash,Date.now()).first();
  if(!row)return env;
  return queuedTenantEnvironment(env,row.owner,services);
}
