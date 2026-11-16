import {createDesktopCommand,findBrivanyDesktop,desktopControl,desktopId,desktopHash} from './melodi-desktop.js';
import {linkedTenant} from './melodi-tenants.js';
const stmt=(env,sql,...values)=>env.VETSA_CLOUD.prepare(sql).bind(...values);
const requestKey=value=>'phone-call:'+value.callId+':'+value.requestId;
function authorize(env,value){
 const phone=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
 if(value?.phone!==phone||!desktopId(value?.callId)||!desktopId(value?.requestId))throw Error('phone_desktop_scope');
 return phone;
}
async function deviceFor(env,services,phone){
 const tenant=await linkedTenant(env,phone,services),device=await findBrivanyDesktop(env,phone);
 if(!tenant||!device||device.status!=='online')throw Error('phone_desktop_offline');
 const linked=await stmt(env,'SELECT device_id FROM brivany_desktop_devices WHERE device_id=? AND phone=? AND user_id=? AND enabled=1',device.device_id,phone,tenant.userId).first();
 if(!linked)throw Error('phone_desktop_scope');return device;
}
export async function phoneDesktopInfo(env,services,phone){
 if(phone!==String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''))throw Error('phone_desktop_scope');
 try{await deviceFor(env,services,phone);return {online:true};}catch{return {online:false};}
}
export async function phoneDesktopExecute(env,services,value){
 const phone=authorize(env,value);
 if(typeof value.instruction!=='string'||!value.instruction.trim()||value.instruction.length>1200)throw Error('phone_desktop_instruction');
 const device=await deviceFor(env,services,phone);
 const id=await createDesktopCommand(env,device.device_id,phone,'instruction',value.instruction,{requestKey:requestKey(value)},services,{ttl:120000});
 return {id,state:'accepted',summary:'Envié tu instrucción al ordenador. Puedes preguntarme cómo va. Si hace falta una aprobación concreta, la recibirás en WhatsApp.'};
}
export async function phoneDesktopStatus(env,services,value){
 const phone=authorize(env,value);await deviceFor(env,services,phone);
 if(!desktopId(value.id))throw Error('phone_desktop_task');
 const row=await stmt(env,'SELECT * FROM brivany_desktop_commands WHERE id=? AND phone=? AND request_hash=?',value.id,phone,await desktopHash(phone+':'+requestKey(value))).first();
 if(!row)throw Error('phone_desktop_task');
 let result=null;
 if(row.result_encrypted){const decrypted=await services.decrypt(row.result_encrypted,row.result_iv);result=typeof decrypted==='string'?JSON.parse(decrypted):decrypted;if(result.id!==row.id||result.phone!==phone||result.deviceId!==row.device_id)throw Error('phone_desktop_integrity');}
 const prefix={pending:'La instrucción está en cola.',claimed:'El ordenador recibió la instrucción.',running:'La tarea sigue en curso.',awaiting_approval:'Hay una acción pendiente de tu aprobación en WhatsApp.',waiting_for_user:'La tarea necesita tu intervención.',succeeded:'El ordenador confirmó que terminó la tarea.',failed:'La tarea falló.',cancelled:'La tarea está cancelada.',cancel_requested:'El ordenador está deteniendo la tarea.',expired:'La instrucción caducó antes de ejecutarse.',interrupted:'La tarea se interrumpió.'}[row.state]||'No tengo una confirmación nueva.';
 return {id:row.id,state:row.state,summary:prefix+(result?.summary?' '+result.summary.slice(0,700):'')};
}
export async function phoneDesktopCancel(env,services,value){
 await phoneDesktopStatus(env,services,value);let summary='';
 await desktopControl(env,value.phone,'PC cancelar '+value.id,services,text=>{summary=text;});
 return {id:value.id,summary};
}
// This entrypoint is bound only to brivany-calls. It has no public HTTP route.
export function createPhoneDesktopEntrypoint(Base,services){return class MelodiPhoneDesktop extends Base{
 info(phone){return phoneDesktopInfo(this.env,services(this.env),phone);}
 execute(value){return phoneDesktopExecute(this.env,services(this.env),value);}
 status(value){return phoneDesktopStatus(this.env,services(this.env),value);}
 cancel(value){return phoneDesktopCancel(this.env,services(this.env),value);}
};}
