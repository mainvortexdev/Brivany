import { createFinanceStore, financeReport, financeFold, resolveFinanceRecord, moneyText, savingsPlan, financeKey } from './personal-finance.js';
import { createRoutineStore } from './melodi-routines.js';
import { createTaskReferences } from './owner-task-references.js';

const agentName=agent=>({melodi:'Melodi'})[agent];
export async function executeFinanceRequest(env,{owner,agent,request,requestId,services,now=Date.now()}) {
  if(owner!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'') || !agentName(agent) || typeof requestId!=='string' || !requestId) throw new Error('finance_owner_required');
  const hooks={...services,now:()=>now},store=createFinanceStore(env.VETSA_CLOUD,hooks),routines=createRoutineStore(env.VETSA_CLOUD,hooks);
  await store.ensureSchema();await routines.ensureSchema();
  const records=await store.list(owner),prefix=`${agentName(agent)}: `;
  if(request.clarification) return prefix+request.clarification;
  if(request.action==='report') return prefix+financeReport(records,{...request,now,routines:await routines.list(owner)});
  if(request.action==='report_document') {
    if(typeof services.prepareDocument!=='function') throw new Error('finance_document_unavailable');
    const document={ownerPhone:owner,agent,assignmentAgent:agent,origin:'owner_request',kind:'report',
      title:`Finanzas personales · ${request.month}`,content:financeReport(records,{...request,now,routines:await routines.list(owner)}),format:request.format,
      channel:request.channel,idempotencyKey:`finance-report:${requestId}`};
    // Apply the existing document level before queuing any artifact. The sealed
    // approval retains this factual snapshot and the agent chosen by the owner.
    if(env.TEAM_AUTONOMY_ENABLED==='true' && typeof services.authorizeFinanceDocument!=='function') throw new Error('finance_document_authority_unavailable');
    if(typeof services.authorizeFinanceDocument==='function') {
      const authority=await services.authorizeFinanceDocument(document);
      if(authority?.allowed!==true) {
        if(authority?.allowed!==false || typeof authority.response!=='string' || !authority.response) throw new Error('finance_document_authority_unconfirmed');
        return authority.response;
      }
    }
    const result=await services.prepareDocument(document);
    if(result?.status!=='queued' || !result.jobId) throw new Error('finance_document_unconfirmed');
    return prefix+`El informe de tus registros está en preparación. Te lo entregaré por ${request.channel==='email' ? 'correo':'WhatsApp, con correo de respaldo'} y te avisaré cuando se envíe.`;
  }
  if(request.action==='status' || request.action==='correct') {
    const found=request.action==='correct' || !request.kind ? records.find(r=>financeFold(r.reference)===financeFold(request.reference))
      : resolveFinanceRecord(records,request.kind,request.reference).record;
    if(!found) return prefix+(request.action==='correct' || !request.kind ? 'No encontré esa referencia financiera.' : resolveFinanceRecord(records,request.kind,request.reference).clarification);
    const data={...found.data};
    if(request.action==='correct') {
      if(request.explicitCurrency && request.currency!==data.currency) return prefix+'Para conservar la contabilidad, anula el registro y crea uno en la moneda correcta.';
      data.amount=request.amount;
    }
    const updated=await store.update({owner,agent,id:found.id,revision:found.revision,data,status:request.status,requestKey:`${requestId}:update`});
    if(found.kind==='subscription' && data.routineId) {
      const prior=(await routines.list(owner)).find(r=>r.id===data.routineId);
      if(request.status==='active' && prior?.status==='stopped' && data.frequency==='monthly') {
        const restored=await routines.create({owner,agent,eventKey:`finance-reactivate:${requestId}`,title:`Renovar ${data.name}`,kind:'recurring_reminder',
          frequency:'monthly',dayOfMonth:prior.dayOfMonth || data.dayOfMonth,hour:prior.hour || data.hour || '09:00',channel:'auto'});
        await store.update({owner,agent,id:updated.id,revision:updated.revision,data:{...data,routineId:restored.id},requestKey:`${requestId}:reactivate-link`});
      } else await refreshSubscriptionReminder(env,{owner,store,routines,services,now,routineId:data.routineId});
    }
    return prefix+`${updated.reference} · ${data.name}: ${request.action==='correct' ? `importe corregido a ${moneyText(data.amount,data.currency)}` : updated.status==='active' ? 'registro activo':updated.status==='inactive' ? 'registro inactivo':'registro anulado'}.${found.kind==='subscription' ? ' Este cambio administra tu registro y sus avisos de renovación; la cuenta con el proveedor se gestiona por separado.':''}`;
  }
  if(request.action==='contribute') {
    const kind=request.kind==='payment' ? 'debt':'saving',found=resolveFinanceRecord(records,kind,request.reference);
    if(!found.record) return prefix+found.clarification;
    if(found.record.status!=='active') return prefix+'Ese registro está inactivo. Actívalo antes de añadir un movimiento.';
    const target=found.record;
    if(target.data.currency!==request.currency) return prefix+`Ese ${kind==='saving' ? 'ahorro':'saldo'} está en ${target.data.currency}. Indica el importe en esa moneda.`;
    if(kind==='debt') {
      const paid=records.filter(r=>r.kind==='payment' && r.status==='active' && r.data.targetId===target.id).reduce((sum,r)=>sum+r.data.amount,0);
      if(request.amount>target.data.amount-paid) return prefix+'El pago supera la deuda pendiente registrada. Corrige primero la deuda o indica un importe menor.';
    }
    const row=await store.create({owner,agent,kind:request.kind,requestKey:`${requestId}:contribution`,data:{name:target.data.name,targetId:target.id,amount:request.amount,currency:request.currency,date:request.date}});
    return prefix+`Registré ${row.reference}: ${moneyText(row.data.amount,row.data.currency)} ${kind==='saving' ? 'aportados al ahorro':'pagados a la deuda'} ${target.data.name}.\n`+financeReport(await store.list(owner),{section:kind==='saving' ? 'savings':'debts',now});
  }
  if(request.action!=='create' || !Array.isArray(request.entries) || !request.entries.length || request.entries.length>10) throw new Error('finance_action_invalid');
  // Validate every linked account and duplicate before writing any member of this request.
  for(const {kind,data} of request.entries) {
    if(kind==='transaction') for(const label of [data.account,data.toAccount].filter(Boolean)) {
      const account=resolveFinanceRecord(records,'account',label);
      if(!account.record) return prefix+account.clarification;
      if(account.record.status!=='active' || account.record.data.currency!==data.currency) return prefix+`La cuenta ${label} debe estar activa y en ${data.currency}.`;
    }
    if(kind==='subscription' || kind==='account') {
      const prior=records.filter(r=>r.kind===kind && r.status!=='void' && financeFold(r.data.name)===financeFold(data.name));
      if(prior.length>1) return prefix+`Hay varias coincidencias para ${data.name}; indica una referencia para corregirla.`;
      if(prior.length===1 && (prior[0].data.amount!==data.amount || prior[0].data.currency!==data.currency)) return prefix+`${data.name} ya está registrado como ${prior[0].reference} por ${moneyText(prior[0].data.amount,prior[0].data.currency)}. Para cambiarlo, dime «corrige ${prior[0].reference} a ${moneyText(data.amount,data.currency)}».`;
      if(prior.length===1 && prior[0].status!=='active') return prefix+`${data.name} está inactivo (${prior[0].reference}). Puedes decirme «activa suscripción ${prior[0].reference}».`;
    }
  }
  let created=[];
  for(let i=0;i<request.entries.length;i++) {
    const entry=request.entries[i];
    const existing=['subscription','account'].includes(entry.kind) && records.find(r=>r.kind===entry.kind && r.status==='active' && financeFold(r.data.name)===financeFold(entry.data.name));
    created.push(existing || await store.create({owner,agent,...entry,requestKey:`${requestId}:record:${i}`}));
  }
  const subscriptions=created.filter(r=>r.kind==='subscription'),renewal=request.routine
    || (subscriptions.some(r=>r.data.dayOfMonth && r.data.frequency==='monthly') ? {kind:'recurring_reminder',frequency:'monthly',dayOfMonth:subscriptions[0].data.dayOfMonth,hour:subscriptions[0].data.hour || '09:00',weekday:0,defaultHour:true}:null);
  let confirmation='';
  if(subscriptions.length && renewal) {
    if(subscriptions.some(r=>r.data.frequency!=='monthly') || renewal.frequency!=='monthly') return prefix+`Guardé las cuotas. Para el aviso de renovación, indica un día de cada mes; los avisos anuales aún requieren una fecha concreta.`;
    const ids=subscriptions.map(r=>r.id).sort(),eventKey=`finance-renewal:${agent}:${await financeKey(ids.join(':'))}:${renewal.dayOfMonth}:${renewal.hour}`;
    const priorRoutine=(await routines.list(owner)).find(r=>r.eventKey===eventKey);
    if(priorRoutine?.status==='stopped') return prefix+'Las cuotas están registradas, pero el aviso fue detenido. Para crear otro, pídeme explícitamente un nuevo recordatorio mensual.';
    const routine=await routines.create({...renewal,owner,agent,eventKey,title:`Renovar ${subscriptions.map(r=>r.data.name).join(' y ')}`,brief:'Renovación de suscripciones registradas por el propietario.',channel:'auto'});
    const refs=createTaskReferences(env.VETSA_CLOUD,{now:()=>now});await refs.ensureSchema();
    const ref=await refs.register({owner,type:'routine',id:routine.id,agent: routine.agent,status:routine.status});
    const replacedRoutines=new Set();
    for(let i=0;i<created.length;i++) if(created[i].kind==='subscription' && created[i].data.routineId!==routine.id) {
      const row=created[i];created[i]=await store.update({owner,agent,id:row.id,revision:row.revision,
        data:{...row.data,routineId:routine.id,dayOfMonth:renewal.dayOfMonth,hour:renewal.hour},requestKey:`${requestId}:link:${row.id}`});
      if(row.data.routineId) replacedRoutines.add(row.data.routineId);
    }
    for(const routineId of replacedRoutines) await refreshSubscriptionReminder(env,{owner,store,routines,services,now,routineId});
    confirmation=`\nRecordatorio mensual ${ref.shortRef}: día ${renewal.dayOfMonth} a las ${renewal.hour}, hora de República Dominicana. Próxima renovación: ${new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'long'}).format(new Date(routine.nextAt))}. ${renewal.defaultHour ? 'Elegí las 9:00 a. m. porque no indicaste hora. ':''}Se sincronizará con «Vetsa · Equipo» en Google Calendar. Puedes detenerlo con «detén rutina ${ref.shortRef}».`;
  }
  const lines=created.map(r=>`${r.reference} · ${r.data.name}: ${moneyText(r.data.amount,r.data.currency)}${r.kind==='subscription' ? ' · cuota registrada, sin registrar un pago':''}.`);
  for(const r of created.filter(r=>r.kind==='saving')) {
    const p=savingsPlan(r,await store.list(owner),now);
    lines.push(p.weekly!==null ? `Plan de ahorro: ${moneyText(p.weekly,r.data.currency)} por semana hasta ${r.data.deadline}.` : 'Puedes añadir una fecha objetivo y registrar aportes con su referencia.');
  }
  const assumption=request.entries.some(e=>e.assumedCurrency) ? '\nPara los importes sin moneda usé pesos dominicanos (DOP).':'';
  return prefix+'Guardé tus registros:\n'+lines.join('\n')+assumption+confirmation;
}

/** Status changes update the shared notice but never silently restart a stopped Calendar series. */
export async function refreshSubscriptionReminder(env,{owner,store,routines,services,now,routineId}) {
  const records=await store.list(owner),active=records.filter(r=>r.kind==='subscription' && r.status==='active' && r.data.routineId===routineId);
  if(!active.length) {await routines.cancel({owner,id:routineId});return;}
  const row=await env.VETSA_CLOUD.prepare("SELECT * FROM wa_melodi_routines WHERE owner=? AND id=? AND status='active'").bind(owner,routineId).first();
  if(!row) return;
  let payload=await services.decrypt(row.payload_encrypted,row.payload_iv);if(typeof payload==='string') payload=JSON.parse(payload);
  const sealed=await services.encrypt(JSON.stringify({...payload,title:`Renovar ${active.map(r=>r.data.name).join(' y ')}`}));
  await env.VETSA_CLOUD.prepare('UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=?,updated_at=? WHERE owner=? AND id=? AND payload_encrypted=? AND status=\'active\'')
    .bind(sealed.encrypted,sealed.iv,now,owner,routineId,row.payload_encrypted).run();
}
