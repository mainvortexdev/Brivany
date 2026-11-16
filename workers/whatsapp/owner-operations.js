import { createFinanceStore, financeReport, financeKey, validateFinanceData } from './personal-finance.js';
import { executeFinanceRequest } from './finance-workflow.js';
import { createRoutineStore } from './melodi-routines.js';
import { usageReport } from './cognira-reports.js';
import { clockContext, localEventTime } from './event-time.js';

// These are typed capabilities selected by the conversation planner. No owner
// text is reparsed to decide whether a financial or usage action was requested.
const text=maxLength=>({type:'string',minLength:1,maxLength});
const enumeration=values=>({type:'string',enum:values});
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const currencies=['DOP','USD','EUR'];
const kinds=['transaction','subscription','saving','budget','account','debt'];
const sections=['all','subscriptions','savings','budgets','debts','accounts','transactions'];
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const money=integer(1,1000000000000);
const dataSchema=schema({name:text(180),currency:enumeration(currencies),amount:integer(0,1000000000000),date:text(10),
  direction:enumeration(['income','expense','transfer']),category:text(180),account:text(180),toAccount:text(180),
  deadline:text(10),dayOfMonth:integer(1,31),hour:text(5),frequency:enumeration(['monthly','yearly']),note:text(180)},['name','currency','amount']);
export const ownerOperationTools=Object.freeze({
  'finance.read':{intent:'project_query',permissionTool:'inspect_finances',effect:'read',resource:'finance',
    description:'Consultar registros financieros personales reales, importes por moneda y referencias. month YYYY-MM; no confundir un gasto registrado con un pago bancario. Un informe puede ser fuente para document.generate.',
    inputSchema:schema({section:enumeration(sections),month:text(7)})},
  'finance.record':{intent:'save_memory',permissionTool:'inspect_finances',effect:'write',resource:'finance',
    description:'Guardar o corregir registros financieros personales por solicitud del dueño. action create usa entries; status/correct/contribute usan reference observada o nombre dado. amount SIEMPRE entero en centavos (500 pesos=50000); moneda explícita DOP/USD/EUR. contribution/payment registran aportes o pagos ya declarados; no ejecuta transferencias bancarias. routine solo para aviso mensual solicitado.',
    inputSchema:schema({action:enumeration(['create','status','correct','contribute']),
      entries:{type:'array',minItems:1,maxItems:10,items:schema({kind:enumeration(kinds),data:dataSchema,assumedCurrency:{type:'boolean'}},['kind','data'])},
      reference:text(180),kind:enumeration([...kinds,'contribution','payment']),status:enumeration(['active','inactive','void']),amount:money,currency:enumeration(currencies),date:text(10),explicitCurrency:{type:'boolean'},
      routine:schema({kind:enumeration(['recurring_reminder']),frequency:enumeration(['monthly']),dayOfMonth:integer(1,31),hour:text(5)},['frequency','dayOfMonth','hour'])},['action'])},
  'usage.read':{intent:'project_query',permissionTool:'inspect_workspace',effect:'read',resource:'usage',
    description:'Leer las estadísticas reales agregadas de Cognira Desktop: usuarios activos diarios/semanales/mensuales y solicitudes de modelos. No consulta Instagram, identidades de clientes ni tiempo frente al PC.',inputSchema:schema({})},
  'usage.schedule':{intent:'create_reminder',permissionTool:'manage_calendar',effect:'write',resource:'usage',
    description:'Programar reportes reales de uso de Cognira Desktop por WhatsApp o correo en el servicio existente. Fechas startAt UTC futuras; recurring true repite cada día a la hora local indicada por startAt/timeZone. Por correo requiere email explícito, sin destinos inventados.',
    inputSchema:schema({channel:enumeration(['whatsapp','email']),email:text(254),timeZone:text(80),
      schedules:{type:'array',minItems:1,maxItems:8,items:schema({startAt:text(40),recurring:{type:'boolean'}},['startAt','recurring'])}},['channel','timeZone','schedules'])},
  'usage.cancel':{intent:'create_reminder',permissionTool:'manage_calendar',effect:'write',resource:'usage',
    description:'Cancelar los reportes programados de Cognira Desktop del propietario, todos o solamente los IDs observados. No cancela recordatorios personales ni rutinas de otras clases.',
    inputSchema:schema({ids:{type:'array',minItems:1,maxItems:20,items:text(200)}})},
});
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
function check(value,rule){
  if(rule.type==='object'){
    if(!object(value) || Object.keys(value).some(key=>!Object.hasOwn(rule.properties,key)) || rule.required.some(key=>!Object.hasOwn(value,key)))throw Error('invalid_owner_operation_input');
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,check(item,rule.properties[key])]));
  }
  if(rule.type==='array'){
    if(!Array.isArray(value) || value.length<rule.minItems || value.length>rule.maxItems)throw Error('invalid_owner_operation_input');
    return value.map(item=>check(item,rule.items));
  }
  if(rule.type==='string' && (typeof value!=='string' || !value.trim() || rule.maxLength && value.length>rule.maxLength || /[\u0000-\u001f]/.test(value)))throw Error('invalid_owner_operation_input');
  if(rule.type==='integer' && (!Number.isSafeInteger(value) || value<rule.minimum || value>rule.maximum))throw Error('invalid_owner_operation_input');
  if(rule.type==='boolean' && typeof value!=='boolean')throw Error('invalid_owner_operation_input');
  if(rule.enum && !rule.enum.includes(value))throw Error('invalid_owner_operation_input');
  return value;
}
function date(value,month=false){
  const raw=month?`${value}-01`:value;
  if(typeof value!=='string' || !(month?/^\d{4}-(?:0[1-9]|1[0-2])$/:/^\d{4}-\d{2}-\d{2}$/).test(value)
    || !Number.isFinite(Date.parse(`${raw}T12:00:00Z`)) || new Date(`${raw}T12:00:00Z`).toISOString().slice(0,10)!==raw)throw Error('invalid_owner_operation_date');
}
const hour=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');
export function validateOwnerOperationInput(name,input){
  if(!Object.hasOwn(ownerOperationTools,name))throw Error('unknown_owner_operation');
  const value=check(input,ownerOperationTools[name].inputSchema);
  if(name==='finance.read' && value.month)date(value.month,true);
  if(name==='finance.record'){
    const allowed={create:['action','entries','routine'],status:['action','reference','kind','status'],correct:['action','reference','amount','currency','explicitCurrency'],contribute:['action','reference','kind','amount','currency','date']}[value.action];
    if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('invalid_owner_finance_action');
    if(value.action==='create'){
      if(!value.entries?.length)throw Error('invalid_owner_finance_action');
      value.entries=value.entries.map(entry=>({...entry,data:validateFinanceData(entry.kind,entry.data)}));
      if(value.routine){
        if(!hour(value.routine.hour) || !value.entries.some(entry=>entry.kind==='subscription') || value.entries.some(entry=>entry.kind==='subscription' && entry.data.frequency!=='monthly'))throw Error('invalid_owner_finance_routine');
        value.routine={...value.routine,kind:'recurring_reminder'};
      }
    }else{
      if(!value.reference)throw Error('invalid_owner_finance_reference');
      if(value.action==='status' && !value.status || value.action==='correct' && !value.amount
        || value.action==='contribute' && (!['contribution','payment'].includes(value.kind) || !value.amount || !value.currency || !value.date))throw Error('invalid_owner_finance_action');
      if(value.action==='contribute')date(value.date);
    }
  }
  if(name==='usage.schedule'){
    try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});}catch{throw Error('invalid_owner_operation_zone');}
    if(value.channel==='email' && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.email || '') || value.channel==='whatsapp' && value.email!==undefined)throw Error('invalid_owner_operation_target');
    value.schedules=value.schedules.map(item=>{
      if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(item.startAt) || !Number.isFinite(Date.parse(item.startAt)))throw Error('invalid_owner_operation_date');
      return{...item,startAt:new Date(item.startAt).toISOString()};
    });
    if(new Set(value.schedules.map(item=>item.startAt)).size!==value.schedules.length)throw Error('duplicate_owner_operation_schedule');
  }
  if(name==='usage.cancel' && value.ids && new Set(value.ids).size!==value.ids.length)throw Error('duplicate_owner_operation_schedule');
  return value;
}
const natural=value=>String(value).replace(/^(?:Melodi|Melodi|Melodi|Melodi|Melodi):\s*/,'');
const responseData=(data,messages)=>({...data,response:messages.length?messages.join('\n'):data.report || ''});
const observed=(tool,data,messages=[])=>({state:'observed',receipt:{tool,status:'observed',verified:true},data:responseData(data,messages),messages});
const committed=(tool,operationId,data,messages=[])=>({state:'committed',receipt:{tool,status:'persisted',operationId,verified:true},data:responseData(data,messages),messages});
const equal=(a,b)=>JSON.stringify(a,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([x],[y])=>x.localeCompare(y))):item)
  ===JSON.stringify(b,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).sort(([x],[y])=>x.localeCompare(y))):item);

/** Authenticated application entry point. Permission decisions and effect
 * checkpoints belong to the parent action executor, never to model arguments. */
export async function executeOwnerOperation(name,input,context,{services={},requestKey,now=Date.now()}={}){
  const {env,phone}=context || {},agent=context?.agent || 'melodi';
  if(!env?.VETSA_CLOUD || !/^\d{8,15}$/.test(phone || '') || phone!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'')
    || !['melodi'].includes(agent) || typeof requestKey!=='string' || !requestKey || requestKey.length>1500)throw Error('owner_operation_authenticated_context_required');
  const value=validateOwnerOperationInput(name,input),db=env.VETSA_CLOUD;
  if(name.startsWith('usage.')&&env.MELODI_BUSINESS_ADMIN===false)throw Error('business_metrics_not_authorized');
  if(name.startsWith('finance.')){
    const hooks={...services,now:()=>now},store=createFinanceStore(db,hooks),routines=createRoutineStore(db,hooks);
    await store.ensureSchema();await routines.ensureSchema();const before=await store.list(phone);
    if(name==='finance.read')return observed(name,{report:natural(financeReport(before,{...value,now,routines:await routines.list(phone)})),recordCount:before.length});
    // The outer turn store freezes inputs. This additional store-level check
    // also protects direct callers from reusing a financial key for new data.
    if(value.action==='create')for(let index=0;index<value.entries.length;index++){
      const entry=value.entries[index],id=await financeKey(`${phone}:${requestKey}:record:${index}`),prior=before.find(row=>row.id===id);
      if(prior && (prior.kind!==entry.kind || !Object.entries(entry.data).every(([key,item])=>equal(prior.data[key],item))))throw Error('owner_finance_request_key_reused');
    }
    const body=natural(await executeFinanceRequest(env,{owner:phone,agent,request:value,requestId:requestKey,services:hooks,now}));
    const after=await store.list(phone);
    let verified=false;
    if(value.action==='create')verified=(await Promise.all(value.entries.map(async(entry,index)=>{
      const expectedId=await financeKey(`${phone}:${requestKey}:record:${index}`);
      const candidate=after.find(row=>row.id===expectedId)
        || (['account','subscription'].includes(entry.kind)?after.find(row=>row.kind===entry.kind && row.status==='active' && Object.entries(entry.data).every(([key,item])=>equal(row.data[key],item))):null);
      return Boolean(candidate && candidate.kind===entry.kind && candidate.status==='active'
        && Object.entries(entry.data).every(([key,item])=>equal(candidate.data[key],item)));
    }))).every(Boolean);
    else if(value.action==='contribute'){
      const id=await financeKey(`${phone}:${requestKey}:contribution`);
      verified=after.some(row=>row.id===id && row.kind===value.kind && row.data.amount===value.amount && row.data.currency===value.currency);
    }else{
      const change=await db.prepare('SELECT record_id FROM wa_finance_changes WHERE owner=? AND id=?').bind(phone,await financeKey(`${phone}:${requestKey}:update`)).first();
      const row=change && after.find(item=>item.id===change.record_id);
      verified=Boolean(row && (value.action==='status'?row.status===value.status:row.data.amount===value.amount));
    }
    if(verified && value.action==='create' && value.routine){
      const savedRoutines=await routines.list(phone);
      verified=after.filter(row=>row.kind==='subscription' && value.entries.some(entry=>entry.kind==='subscription' && entry.data.name===row.data.name)).every(row=>
        savedRoutines.some(routine=>routine.id===row.data.routineId && routine.frequency==='monthly'
          && routine.dayOfMonth===value.routine.dayOfMonth && routine.hour===value.routine.hour));
    }
    if(!verified){
      if(!equal(before,after))throw Error('owner_finance_write_readback_mismatch');
      return observed(name,{status:'waiting',question:body},[body]);
    }
    if(typeof services.syncAgenda==='function')await services.syncAgenda(env,phone);
    return committed(name,await financeKey(`${phone}:${requestKey}`),{status:'persisted',confirmation:body},[body]);
  }
  if(name==='usage.read')return observed(name,{report:natural(await usageReport(env,new Date(now))).replace(/^Melodi · /,'')});
  if(name==='usage.schedule'){
    if(value.schedules.some(item=>Date.parse(item.startAt)<=now))return observed(name,{status:'waiting',question:'Una de esas horas ya pasó. ¿Para qué día quieres ese reporte?'},['Una de esas horas ya pasó. ¿Para qué día quieres ese reporte?']);
    const schedules=await Promise.all(value.schedules.map(async(item,index)=>({id:await financeKey(`${phone}:${requestKey}:usage:${index}`),owner_phone:phone,channel:value.channel,
      target:value.channel==='email'?value.email:phone,next_at:item.startAt,recurring:item.recurring?1:0,time_zone:value.timeZone,
      local_hour:clockContext(item.startAt,value.timeZone).now_local.slice(11,16)})));
    await db.batch(schedules.map(row=>db.prepare('INSERT OR IGNORE INTO cognira_report_schedules(id,owner_phone,channel,target,next_at,recurring,time_zone,local_hour) VALUES(?,?,?,?,?,?,?,?)')
      .bind(row.id,row.owner_phone,row.channel,row.target,row.next_at,row.recurring,row.time_zone,row.local_hour)));
    for(const expected of schedules){
      const row=await db.prepare('SELECT id,owner_phone,channel,target,next_at,recurring,time_zone,local_hour FROM cognira_report_schedules WHERE owner_phone=? AND id=?').bind(phone,expected.id).first();
      if(!row || !equal(row,expected))throw Error('owner_usage_schedule_readback_mismatch');
    }
    if(typeof services.syncAgenda==='function')await services.syncAgenda(env,phone);
    const confirmation=`Programé ${schedules.length===1?'el reporte':'los reportes'} de Cognira ${value.channel==='email'?`por correo a ${value.email}`:'por WhatsApp'}: ${schedules.map(row=>`${localEventTime(row.next_at,row.time_zone)}${row.recurring?' · cada día':''}`).join('; ')}.`;
    return committed(name,await financeKey(`${phone}:${requestKey}`),{status:'persisted',schedules,confirmation},[confirmation]);
  }
  if(name==='usage.cancel'){
    const suffix=value.ids?` AND id IN (${value.ids.map(()=>'?').join(',')})`:'',args=[phone,...(value.ids || [])];
    const write=await db.prepare(`DELETE FROM cognira_report_schedules WHERE owner_phone=?${suffix}`).bind(...args).run();
    const remains=await db.prepare(`SELECT id FROM cognira_report_schedules WHERE owner_phone=?${suffix} LIMIT 1`).bind(...args).first();
    if(remains)throw Error('owner_usage_cancel_readback_mismatch');
    if(typeof services.syncAgenda==='function')await services.syncAgenda(env,phone);
    const confirmation='Cancelé los reportes programados de Cognira que pediste.';
    return committed(name,await financeKey(`${phone}:${requestKey}`),{status:'persisted',removed:write.meta?.changes || 0,confirmation},[confirmation]);
  }
  throw Error('unknown_owner_operation');
}
