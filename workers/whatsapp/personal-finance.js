import { clockContext, DOMINICAN_TIME_ZONE } from './event-time.js';

export const FINANCE_KINDS=Object.freeze(['transaction','subscription','saving','contribution','budget','account','debt','payment']);
export const FINANCE_SCHEMA=Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_finance_records (
    ref INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,agent TEXT NOT NULL,
    kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL DEFAULT 1,
    payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS wa_finance_owner ON wa_finance_records(owner,kind,status,ref)`,
  `CREATE TABLE IF NOT EXISTS wa_finance_changes (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,record_id TEXT NOT NULL,agent TEXT NOT NULL,
    revision INTEGER NOT NULL,payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,created_at INTEGER NOT NULL,
    UNIQUE(owner,record_id,revision))`,
]);
const AGENTS=['melodi'];
const CURRENCIES=['DOP','USD','EUR'];
export const financeFold=value=>String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
export async function financeKey(value) {
  if(typeof value!=='string' || !value || value.length>2000) throw new Error('finance_key_invalid');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

/** Decimal input only. Money never travels through a binary floating-point product. */
export function moneyMinor(value) {
  let text=String(value).trim();
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) text=text.replace(/,/g,'');
  else if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) text=text.replace(/\./g,'').replace(',','.');
  else if(/^\d+(?:,\d{1,2})$/.test(text)) text=text.replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('finance_amount_invalid');
  const [whole,fraction='']=text.split('.'), amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(amount<=0n || amount>1000000000000n) throw new Error('finance_amount_invalid');
  return Number(amount);
}
export function moneyText(minor,currency) {
  if(!Number.isSafeInteger(minor) || !CURRENCIES.includes(currency)) throw new Error('finance_amount_invalid');
  const absolute=Math.abs(minor), whole=Math.trunc(absolute/100), cents=String(absolute%100).padStart(2,'0');
  return `${currency} ${minor<0 ? '-' : ''}${whole.toLocaleString('en-US')}.${cents}`;
}
const name=value=>typeof value==='string' && value.trim().length>0 && value.length<=180 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
function localDay(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)!==value) throw new Error('finance_date_invalid');
  return value;
}
export function validateFinanceData(kind,raw) {
  if(!FINANCE_KINDS.includes(kind) || !raw || Array.isArray(raw) || typeof raw!=='object') throw new Error('finance_record_invalid');
  const allowed=['name','currency','amount','date','direction','category','account','toAccount','targetId','deadline','dayOfMonth','hour','frequency','routineId','note'];
  if(Object.keys(raw).some(k=>!allowed.includes(k))) throw new Error('finance_field_invalid');
  const data={...raw,name:name(raw.name)};
  if(!data.name || !CURRENCIES.includes(data.currency) || !Number.isSafeInteger(data.amount) || data.amount<0 || data.amount>1000000000000) throw new Error('finance_record_invalid');
  if(kind!=='account' && data.amount===0) throw new Error('finance_amount_invalid');
  if(raw.date && kind!=='budget') localDay(raw.date);
  if(raw.deadline) localDay(raw.deadline);
  for(const k of ['category','account','toAccount','note']) if(raw[k]!==undefined && !name(raw[k])) throw new Error('finance_text_invalid');
  if(kind==='transaction') {
    if(!['income','expense','transfer'].includes(data.direction) || !data.date) throw new Error('finance_transaction_invalid');
    if(data.direction==='transfer' && (!data.account || !data.toAccount || financeFold(data.account)===financeFold(data.toAccount))) throw new Error('finance_transfer_invalid');
  }
  if(['contribution','payment'].includes(kind) && (!data.targetId || !/^[a-f0-9]{64}$/.test(data.targetId) || !data.date)) throw new Error('finance_target_invalid');
  if(kind==='subscription') {
    if(!['monthly','yearly'].includes(data.frequency) || data.dayOfMonth!==undefined && (!Number.isInteger(data.dayOfMonth) || data.dayOfMonth<1 || data.dayOfMonth>31)) throw new Error('finance_subscription_invalid');
    if(data.hour!==undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.hour)) throw new Error('finance_hour_invalid');
  }
  if(data.routineId!==undefined && (typeof data.routineId!=='string' || data.routineId.length>200)) throw new Error('finance_routine_invalid');
  if(kind==='budget' && !/^\d{4}-\d{2}$/.test(data.date || '')) throw new Error('finance_budget_invalid');
  return data;
}

export function createFinanceStore(db,{encrypt,decrypt,now=()=>Date.now()}={}) {
  if(!db?.prepare || !db?.batch || typeof encrypt!=='function' || typeof decrypt!=='function') throw new Error('finance_storage_unavailable');
  const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
  const scope=(owner,agent)=>{if(typeof owner!=='string' || !/^\d{8,15}$/.test(owner) || agent!==undefined && !AGENTS.includes(agent)) throw new Error('finance_scope_invalid');};
  const seal=async(owner,id,kind,data)=>{
    const result=await encrypt(JSON.stringify({owner,id,kind,data}));
    if(!result?.encrypted || !result?.iv) throw new Error('finance_encryption_failed');
    return result;
  };
  async function expose(row) {
    if(!row) return null;
    let value=await decrypt(row.payload_encrypted,row.payload_iv);
    if(typeof value==='string') value=JSON.parse(value);
    if(value?.owner!==row.owner || value?.id!==row.id || value?.kind!==row.kind) throw new Error('finance_envelope_mismatch');
    return {id:row.id,reference:`F${String(row.ref).padStart(3,'0')}`,agent:row.agent,kind:row.kind,status:row.status,revision:row.revision,
      data:validateFinanceData(row.kind,value.data)};
  }
  async function ensureSchema() {await db.batch(FINANCE_SCHEMA.map(sql=>db.prepare(sql)));}
  async function list(owner) {
    scope(owner);
    // Pagination traverses all records; totals never silently use a display limit.
    const all=[];let after=0;
    while(true) {
      const batch=(await stmt('SELECT * FROM wa_finance_records WHERE owner=? AND ref>? ORDER BY ref LIMIT 100',owner,after).all()).results || [];
      all.push(...await Promise.all(batch.map(expose)));
      if(batch.length<100) break;
      after=batch.at(-1).ref;
      if(all.length>20000) throw new Error('finance_report_too_large');
    }
    return all;
  }
  async function create({owner,agent,kind,data,requestKey}) {
    scope(owner,agent);data=validateFinanceData(kind,data);
    const id=await financeKey(`${owner}:${requestKey}`),at=now(),sealed=await seal(owner,id,kind,data);
    await stmt(`INSERT OR IGNORE INTO wa_finance_records(id,owner,agent,kind,payload_encrypted,payload_iv,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
      id,owner,agent,kind,sealed.encrypted,sealed.iv,at,at).run();
    const row=await stmt('SELECT * FROM wa_finance_records WHERE owner=? AND id=?',owner,id).first();
    if(!row || row.agent!==agent || row.kind!==kind) throw new Error('finance_idempotency_conflict');
    return expose(row);
  }
  async function update({owner,agent,id,revision,data,status,requestKey}) {
    scope(owner,agent);
    const operation=await financeKey(`${owner}:${requestKey}`);
    const done=await stmt('SELECT record_id FROM wa_finance_changes WHERE owner=? AND id=?',owner,operation).first();
    if(done) return expose(await stmt('SELECT * FROM wa_finance_records WHERE owner=? AND id=?',owner,done.record_id).first());
    const row=await stmt('SELECT * FROM wa_finance_records WHERE owner=? AND id=?',owner,id).first();
    if(!row || row.revision!==revision) throw new Error('finance_revision_conflict');
    if(status!==undefined && !['active','inactive','void'].includes(status)) throw new Error('finance_status_invalid');
    data=validateFinanceData(row.kind,data || (await expose(row)).data);
    const sealed=await seal(owner,id,row.kind,data),at=now();
    const result=await db.batch([
      stmt(`INSERT INTO wa_finance_changes(id,owner,record_id,agent,revision,payload_encrypted,payload_iv,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM wa_finance_records WHERE owner=? AND id=? AND revision=?)`,
        operation,owner,id,agent,revision,row.payload_encrypted,row.payload_iv,at,owner,id,revision),
      stmt(`UPDATE wa_finance_records SET payload_encrypted=?,payload_iv=?,status=?,revision=revision+1,updated_at=?
        WHERE owner=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM wa_finance_changes WHERE id=?)`,
        sealed.encrypted,sealed.iv,status || row.status,at,owner,id,revision,operation),
    ]);
    if(!result[1]?.meta?.changes) throw new Error('finance_revision_conflict');
    return expose(await stmt('SELECT * FROM wa_finance_records WHERE owner=? AND id=?',owner,id).first());
  }
  return Object.freeze({ensureSchema,list,create,update});
}

export function resolveFinanceRecord(records,kind,reference) {
  const query=financeFold(reference).replace(/[.?!]+$/,'');
  const matches=records.filter(r=>r.kind===kind && r.status!=='void'
    && (financeFold(r.reference)===query || financeFold(r.data.name)===query));
  return matches.length===1 ? {record:matches[0]} : {clarification:matches.length
    ? `Hay varias coincidencias: ${matches.map(r=>`${r.reference} (${r.data.name})`).join(', ')}. Indica la referencia.`
    : `No encontré ${reference} en tus registros. Puedes pedirme la lista de ${kind==='subscription' ? 'suscripciones':'finanzas'}.`};
}
const plus=(a,b)=>{const value=a+b;if(!Number.isSafeInteger(value)) throw new Error('finance_total_overflow');return value;};
export function financeSummary(records,{month=clockContext(Date.now(),DOMINICAN_TIME_ZONE).today_local.slice(0,7)}={}) {
  const currencies={};
  const bucket=c=>currencies[c] ||= {income:0,expense:0,net:0,monthlySubscriptions:0,yearlySubscriptions:0};
  for(const record of records.filter(r=>r.status==='active')) {
    const d=record.data,b=bucket(d.currency);
    if(['transaction','payment'].includes(record.kind) && d.date.startsWith(month)) {
      if(d.direction==='income') b.income=plus(b.income,d.amount);
      if(d.direction==='expense' || record.kind==='payment') b.expense=plus(b.expense,d.amount);
    }
    if(record.kind==='subscription') {
      const field=d.frequency==='monthly' ? 'monthlySubscriptions':'yearlySubscriptions';
      b[field]=plus(b[field],d.amount);
    }
  }
  for(const b of Object.values(currencies)) b.net=b.income-b.expense;
  return {month,currencies};
}
export function savingsPlan(record,records,now=Date.now()) {
  const saved=records.filter(r=>r.status==='active' && r.kind==='contribution' && r.data.targetId===record.id && r.data.currency===record.data.currency)
    .reduce((sum,r)=>plus(sum,r.data.amount),0), remaining=Math.max(0,record.data.amount-saved);
  const today=clockContext(now,DOMINICAN_TIME_ZONE).today_local;
  const days=record.data.deadline ? Math.ceil((Date.parse(`${record.data.deadline}T12:00Z`)-Date.parse(`${today}T12:00Z`))/86400000) : null;
  return {saved,remaining,days,weekly:days>0 ? Math.ceil(remaining/Math.max(1,Math.ceil(days/7))) : null};
}
export function financeReport(records,{section='all',month,now=Date.now(),routines=[]}={}) {
  month ||= clockContext(now,DOMINICAN_TIME_ZONE).today_local.slice(0,7);
  const lines=[],active=records.filter(r=>r.status!=='void'),summary=financeSummary(records,{month});
  if(['all','summary','transactions'].includes(section)) {
    lines.push(`Finanzas · ${month}`);
    for(const [c,b] of Object.entries(summary.currencies)) lines.push(`${c}: entradas ${moneyText(b.income,c)}, salidas ${moneyText(b.expense,c)}, diferencia registrada ${moneyText(b.net,c)}.`);
    if(!Object.keys(summary.currencies).length) lines.push('Todavía no hay movimientos registrados.');
  }
  if(['all','subscriptions'].includes(section)) {
    lines.push('Suscripciones (cuotas previstas; no son pagos registrados):');
    for(const r of active.filter(r=>r.kind==='subscription')) {
      const routine=routines.find(v=>v.id===r.data.routineId);
      lines.push(`${r.reference} · ${r.data.name}: ${moneyText(r.data.amount,r.data.currency)} ${r.data.frequency==='monthly' ? 'al mes':'al año'} · ${r.status==='active' ? 'activa':'inactiva'}${r.data.dayOfMonth ? ` · renovación registrada día ${r.data.dayOfMonth}`:''}${routine ? routine.status==='stopped' ? ' · aviso detenido':` · aviso mensual día ${routine.dayOfMonth}, ${routine.hour} RD`:''}.`);
    }
    for(const [c,b] of Object.entries(summary.currencies)) if(b.monthlySubscriptions || b.yearlySubscriptions) lines.push(`Cuotas activas ${c}: ${moneyText(b.monthlySubscriptions,c)}/mes y ${moneyText(b.yearlySubscriptions,c)}/año (ciclos separados).`);
  }
  if(['all','transactions'].includes(section)) {
    const movements=active.filter(r=>['transaction','payment'].includes(r.kind) && r.status==='active' && r.data.date.startsWith(month));
    lines.push(`Movimientos · ${month} (${movements.length}):`);
    for(const r of movements.slice(-20)) lines.push(`${r.reference} · ${r.data.date} · ${r.kind==='payment' ? 'Salida (pago de deuda)':r.data.direction==='income' ? 'Entrada':r.data.direction==='expense' ? 'Salida':'Transferencia'} · ${r.data.name} · ${moneyText(r.data.amount,r.data.currency)}${r.data.account ? ` · ${r.data.account}`:''}.`);
    if(movements.length>20) lines.push('Se muestran los últimos 20; los totales incluyen todos.');
  }
  if(['all','savings'].includes(section)) for(const r of active.filter(r=>r.kind==='saving')) {
    const p=savingsPlan(r,records,now),c=r.data.currency;
    lines.push(`${r.reference} · Ahorro «${r.data.name}»: ${moneyText(p.saved,c)} de ${moneyText(r.data.amount,c)}; faltan ${moneyText(p.remaining,c)}.${r.data.deadline ? ` Fecha: ${r.data.deadline}. ${p.days>0 ? `Plan: ${moneyText(p.weekly,c)} por semana.`:'El plazo llegó; puedes cambiarlo.'}`:''}`);
  }
  if(['all','budgets'].includes(section)) for(const r of active.filter(r=>r.kind==='budget' && r.data.date===month && r.status==='active')) {
    const spent=active.filter(v=>v.status==='active' && v.kind==='transaction' && v.data.direction==='expense' && v.data.currency===r.data.currency && v.data.date.startsWith(month)
      && financeFold(v.data.category || v.data.name)===financeFold(r.data.name)).reduce((sum,v)=>plus(sum,v.data.amount),0);
    lines.push(`${r.reference} · Presupuesto ${r.data.name}: ${moneyText(spent,r.data.currency)} de ${moneyText(r.data.amount,r.data.currency)}; disponible ${moneyText(r.data.amount-spent,r.data.currency)}.`);
  }
  if(['all','accounts'].includes(section)) for(const r of active.filter(r=>r.kind==='account' && r.status==='active')) {
    let balance=r.data.amount;
    for(const t of active.filter(t=>t.status==='active' && t.kind==='transaction' && t.data.currency===r.data.currency)) {
      const d=t.data;
      if(financeFold(d.account)===financeFold(r.data.name)) balance=plus(balance,d.direction==='income' ? d.amount:-d.amount);
      if(d.direction==='transfer' && financeFold(d.toAccount)===financeFold(r.data.name)) balance=plus(balance,d.amount);
    }
    lines.push(`${r.reference} · ${r.data.name}: saldo según tus registros ${moneyText(balance,r.data.currency)}.`);
  }
  if(['all','debts'].includes(section)) for(const r of active.filter(r=>r.kind==='debt' && r.status==='active')) {
    const paid=active.filter(t=>t.kind==='payment' && t.status==='active' && t.data.targetId===r.id && t.data.currency===r.data.currency).reduce((sum,t)=>plus(sum,t.data.amount),0);
    lines.push(`${r.reference} · Deuda ${r.data.name}: pendiente ${moneyText(Math.max(0,r.data.amount-paid),r.data.currency)}${paid>r.data.amount ? ` · excedente de pagos registrado ${moneyText(paid-r.data.amount,r.data.currency)}`:''}${r.data.deadline ? ` · vence ${r.data.deadline}`:''}.`);
  }
  return lines.join('\n') || 'Todavía no tienes registros en esta sección.';
}
