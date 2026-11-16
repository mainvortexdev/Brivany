import { stripAgentAddress } from './melodi-address.js';
import { clockContext, DOMINICAN_TIME_ZONE } from './event-time.js';
import { financeFold, moneyMinor } from './personal-finance.js';

const NUMBER='(?:[+\\-−]\\s*)?(?:\\d{1,3}(?:[,.]\\d{3})+(?:[,.]\\d{1,2})?|\\d+(?:[,.]\\d{1,2})?)';
const MONEY=new RegExp(`(?:(US\\$|RD\\$|USD|DOP|EUR|\\$|€)\\s*)?(${NUMBER})(?:\\s*(d[oó]lares?|pesos?(?:\\s+dominicanos?)?|euros?|USD|DOP|EUR))?`,'i');
function amountIn(text) {
  const match=MONEY.exec(text);
  if(!match) return null;
  if(/[+\-−]\s*$|[\w.,]$/.test(text.slice(0,match.index)) || /^(?:\d|[.,]\d|[eE][+\-]?\d)/.test(text.slice(match.index+match[0].length))) return {invalid:true};
  const marker=financeFold(`${match[1] || ''} ${match[3] || ''}`);
  if([/us\$|usd|dolar/,/rd\$|dop|peso/,/eur|€/].filter(currency=>currency.test(marker)).length>1) return {invalid:true};
  const currency=/us\$|usd|dolar/.test(marker) ? 'USD' : /eur|€/.test(marker) ? 'EUR':'DOP';
  try {return {amount:moneyMinor(match[2]),currency,assumedCurrency:!marker.trim() || marker.trim()==='$',start:match.index,end:match.index+match[0].length};}
  catch {return {invalid:true};}
}
const today=now=>clockContext(now,DOMINICAN_TIME_ZONE).today_local;
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function dateFromParts(year,month,day) {
  const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,at=Date.parse(`${date}T12:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0,10)===date ? date:null;
}
function explicitDate(raw,now) {
  const t=financeFold(raw), iso=t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if(iso) {
    const value=iso[1],at=Date.parse(`${value}T12:00:00Z`);
    return Number.isFinite(at) && new Date(at).toISOString().slice(0,10)===value ? value:null;
  }
  if(/\bayer\b/.test(t)) return new Date(Date.parse(`${today(now)}T12:00Z`)-86400000).toISOString().slice(0,10);
  const numeric=t.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if(numeric) return dateFromParts(Number(numeric[3]),Number(numeric[2]),Number(numeric[1]));
  const named=t.match(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de(?:l)?\\s+(20\\d{2}))?\\b`));
  if(named) return dateFromParts(Number(named[3] || today(now).slice(0,4)),MONTHS.indexOf(named[2])+1,Number(named[1]));
  const thisMonth=t.match(/\b(?:el|dia|del)\s+(\d{1,2})\s+de este mes\b/);
  if(thisMonth) return dateFromParts(Number(today(now).slice(0,4)),Number(today(now).slice(5,7)),Number(thisMonth[1]));
  const ago=t.match(/\bhace (\d+) dias?\b/);
  if(ago) return Number(ago[1])<=3650 ? new Date(Date.parse(`${today(now)}T12:00Z`)-Number(ago[1])*86400000).toISOString().slice(0,10):null;
  const namedMonth=t.match(new RegExp(`\\b(?:en|para|de)\\s+(${MONTHS.join('|')})(?:\\s+de(?:l)?\\s+(20\\d{2}))?\\b`));
  if(namedMonth) return dateFromParts(Number(namedMonth[2] || today(now).slice(0,4)),MONTHS.indexOf(namedMonth[1])+1,1);
  if(/\bmes (?:pasado|proximo)|\bproximo mes\b/.test(t)) {
    const current=today(now),delta=/pasado/.test(t) ? -1:1;
    return new Date(Date.UTC(Number(current.slice(0,4)),Number(current.slice(5,7))-1+delta,1,12)).toISOString().slice(0,10);
  }
  if(/\b(?:antes del?|para el|hasta el|fecha|el dia)\s+\d/.test(t)) return null;
  return today(now);
}
function cleanName(raw) {return raw.trim().replace(/^[,:\s]+|[.?!,:\s]+$/g,'').replace(/\s+(?:hoy|ayer|el \d{4}-\d{2}-\d{2})\s*$/i,'').trim();}
const reportSection=t=>/suscripcion/.test(t) ? 'subscriptions':/ahorro/.test(t) ? 'savings':/presupuesto/.test(t) ? 'budgets':/deuda/.test(t) ? 'debts':/cuenta/.test(t) ? 'accounts':/movimiento|gastos|salidas|entradas|ingresos/.test(t) ? 'transactions':'all';

/** Only a direct owner text is parsed. Pasted sources, examples and URLs cannot register money. */
export function parseFinanceRequest(raw,now=Date.now()) {
  if(typeof raw!=='string' || raw.length>2500 || /[\r\n]|https?:\/\/|^(?:ejemplo|imagina|supongamos|"|“|«)/i.test(raw.trim())) return null;
  const text=stripAgentAddress(raw).trim().replace(/^[¿?]+/,''), t=financeFold(text);
  const report=t.match(/^(?:(?:muestrame|dime|lista|ver|consulta|revisa|como van|como estan|cuales son|cuanto (?:gaste|gasto|ingreso|ingrese|tengo)|que)\s+)?(?:mis?\s+)?(finanzas|cuentas|ingresos|entradas|salidas|gastos|movimientos|suscripciones|ahorros|planes de ahorro|presupuestos|deudas|balance|resumen financiero)\b/)
    || t.match(/^\??(?:cuanto (?:gaste|ingrese|ingreso|tengo|gasto en suscripciones)|como van mis finanzas|cuales son mis suscripciones)\b/);
  if(report) {
    const section=reportSection(t);
    const month=t.match(/\b(20\d{2}-(?:0[1-9]|1[012]))\b/)?.[1] || explicitDate(t,now)?.slice(0,7);
    if(!month) return {clarification:'Indica el mes que quieres consultar, por ejemplo: octubre de 2026.'};
    return {action:'report',section,month};
  }
  if(/^(?:prepara|crea|envia(?:me)?|manda(?:me)?|exporta)\b/.test(t) && /\b(?:informe|resumen|reporte|documento)\b/.test(t) && /finanzas|gastos|ingresos|suscripciones|ahorros|presupuestos|cuentas|deudas/.test(t)) {
    const month=t.match(/\b(20\d{2}-(?:0[1-9]|1[012]))\b/)?.[1] || explicitDate(t,now)?.slice(0,7);
    if(!month) return {clarification:'Indica el mes del informe, por ejemplo: octubre de 2026.'};
    return {action:'report_document',section:reportSection(t),month,format:/docx|word/.test(t) ? 'docx':/\btxt\b/.test(t) ? 'txt':'pdf',channel:/correo|email/.test(t) ? 'email':'auto'};
  }
  const status=t.match(/^(desactiva|reactiva|activa|cancela|anula|elimina|borra)\s+(?:mi |la |el |una )?(suscripcion|movimiento|gasto|ingreso|ahorro|presupuesto|cuenta|deuda)\s+(?:de\s+)?(.+)$/);
  if(status) return {action:'status',kind:{suscripcion:'subscription',movimiento:'transaction',gasto:'transaction',ingreso:'transaction',ahorro:'saving',presupuesto:'budget',cuenta:'account',deuda:'debt'}[status[2]],reference:cleanName(status[3]),status:/reactiva|^activa$/.test(status[1]) ? 'active':status[2]==='suscripcion' ? 'inactive':'void'};
  const voidReference=t.match(/^(?:anula|elimina|borra)\s+(?:el\s+)?(f\d+)$/);
  if(voidReference) return {action:'status',reference:voidReference[1],status:'void'};
  const correct=text.match(/^(?:corrige|actualiza|cambia) +(?:el +)?(F\d+)\s+(?:a|por|con)\s+(.+)$/i);
  if(correct) {
    const money=amountIn(correct[2]);
    return money && !money.invalid ? {action:'correct',reference:correct[1],...money,explicitCurrency:!money.assumedCurrency} : {clarification:'Indica el nuevo importe, por ejemplo: «corrige F001 a 25 dólares».'};
  }
  // Multiple fees are extracted from the literal owner text, never renamed by a model.
  if(/^(?:tengo|registra|anota|agrega|añade|anade|mi|la)\b/.test(t) && /\bsuscripcion(?:es)?\b/.test(t)) {
    let cycle='monthly';
    const entries=[],pattern=new RegExp(`(?:suscripci[oó]n(?:\\s+(?:mensual|anual))?\\s+(?:de\\s+)?|y\\s+la\\s+(?:(?:mensual|anual)\\s+)?de\\s+)(.+?)\\s+de\\s+((?:(?:US\\$|RD\\$|USD|DOP|EUR|\\$|€)\\s*)?${NUMBER}(?:\\s*(?:d[oó]lares?|pesos?(?:\\s+dominicanos?)?|euros?|USD|DOP|EUR))?)`,'gi');
    for(const match of text.matchAll(pattern)) {
      const money=amountIn(text.slice(match.index+match[0].lastIndexOf(match[2])));
      if(!money || money.invalid) return {clarification:'Indica un importe válido para cada suscripción, con hasta dos decimales.'};
      const declaredCycle=financeFold(match[0]).match(/^(?:suscripcion|y la)\s+(mensual|anual)\b/);
      if(declaredCycle) cycle=declaredCycle[1]==='anual' ? 'yearly':'monthly';
      entries.push({kind:'subscription',data:{name:cleanName(match[1]),amount:money.amount,currency:money.currency,frequency:cycle},assumedCurrency:money.assumedCurrency});
    }
    if(!entries.length) return {clarification:'Indica el nombre y la cuota, por ejemplo: «registra una suscripción mensual de Netflix de 10 dólares».'};
    const routine=parseRecurringReminder(text,now);
    const day=t.match(/\b(?:dia|el)\s+(\d{1,2})(?:\s+de)?\s+(?:cada mes|mensual)/)?.[1] || t.match(/\b(?:renueva|renovacion|vence|pago)\s+(?:el\s+)?(?:dia\s+)?(\d{1,2})\b/)?.[1];
    if(routine?.clarification) return routine;
    if(day && (Number(day)<1 || Number(day)>31)) return {clarification:'Indica un día del mes entre 1 y 31.'};
    if(day) for(const entry of entries) {entry.data.dayOfMonth=Number(day);entry.data.hour=routine?.hour || '09:00';}
    return {action:'create',entries,routine};
  }
  const verb=t.match(/^(?:registra|anota|agrega|anade)\s+(?:(?:un|una|el|la)\s+)?(ingreso|entrada|salida|gasto|deuda|cuenta|presupuesto)(?:\s+de)?\b/);
  const casual=t.match(/^(gaste|pague|recibi|ingrese|cobre)\b/);
  const saving=/^(?:quiero ahorrar|crea (?:un )?plan de ahorro|crea (?:un )?ahorro|registra (?:un )?ahorro)\b/.test(t);
  const contribution=/^(?:agrega|anade|aporta|abona)\b/.test(t) && /\b(?:ahorro|meta|deuda)\b/.test(t);
  const transfer=/^(?:transfiere|registra (?:una )?transferencia)\b/.test(t);
  if(!verb && !casual && !saving && !contribution && !transfer) return null;
  const money=amountIn(text);
  if(!money || money.invalid) return {clarification:'Indica el importe, por ejemplo: «registra un gasto de 500 pesos en supermercado».'};
  const date=explicitDate(text,now);
  if(!date) return {clarification:'Indica la fecha en formato año-mes-día para guardar ese registro con precisión.'};
  let tail=text.slice(money.end).trim().replace(/^[,:;]\s*/,''), label='', kind='transaction', direction=casual && ['gaste','pague'].includes(casual[1]) || verb && ['gasto','salida'].includes(verb[1]) ? 'expense':'income';
  if(saving) {kind='saving';label=tail.match(/^(?:para|por)\s+(.+?)(?:\s+(?:antes del?|para el|hasta el)\s+|$)/i)?.[1] || '';}
  else if(contribution) {
    const target=tail.match(/^(?:a|en)\s+(?:mi |el |la )?(?:ahorro|meta|deuda)\s+(.+?)(?:\s+(?:hoy|ayer|el \d{4})|$)/i)?.[1];
    return target ? {action:'contribute',kind:/\bdeuda\b/.test(t) ? 'payment':'contribution',reference:cleanName(target),...money,date} : {clarification:'Indica la referencia del ahorro o deuda, por ejemplo: «añade 500 pesos a mi ahorro F003».'};
  } else if(transfer) {
    const pair=tail.match(/^de\s+(.+?)\s+a\s+(.+?)(?:\s+(?:hoy|ayer|el \d{4})|$)/i);
    return pair ? {action:'create',entries:[{kind:'transaction',data:{name:'Transferencia entre cuentas',amount:money.amount,currency:money.currency,date,direction:'transfer',account:cleanName(pair[1]),toAccount:cleanName(pair[2])},assumedCurrency:money.assumedCurrency}]} : {clarification:'Indica las cuentas: «transfiere 500 pesos de efectivo a banco».'};
  } else if(verb && ['cuenta','presupuesto','deuda'].includes(verb[1])) {
    kind={cuenta:'account',presupuesto:'budget',deuda:'debt'}[verb[1]];
    label=text.slice(verb[0].length,money.start).replace(/\s+(?:con(?: saldo)?|por|de)\s*$/i,'').trim() || tail.replace(/^(?:para|en|por|de)\s+/i,'');
  } else label=tail.replace(/^(?:en|por|de|para)\s+/i,'');
  const account=label.match(/\s+(?:desde|con cargo a|en la cuenta)\s+(.+)$/i);
  if(account) label=label.slice(0,account.index);
  label=cleanName(label);
  if(!label) return {clarification:`Indica el concepto ${kind==='saving' ? 'del ahorro':'del registro'}, por ejemplo: «gasté 500 pesos en supermercado».`};
  const data={name:label,amount:money.amount,currency:money.currency};
  if(kind==='transaction') Object.assign(data,{date,direction,category:label,...(account ? {account:cleanName(account[1])}:{})});
  if(kind==='budget') data.date=date.slice(0,7);
  if(['saving','debt'].includes(kind) && /\b(?:antes del?|para el|hasta el)\b/.test(t)) {data.deadline=date;data.name=cleanName(data.name.replace(/\s+(?:antes del?|para el|hasta el)\s+.*$/i,''));}
  return {action:'create',entries:[{kind,data,assumedCurrency:money.assumedCurrency}]};
}

export function parseRecurringReminder(raw,now=Date.now()) {
  if(typeof raw!=='string' || raw.length>2500 || /[\r\n]|https?:\/\/|^(?:ejemplo|imagina|supongamos|"|“|«)/i.test(raw.trim())) return null;
  const text=stripAgentAddress(raw).trim(),t=financeFold(text);
  if(!/\b(?:recuerdame|recordarme|que me recuerdes|recordatorio|avisame)\b/.test(t)
    || !/\b(?:cada mes|todos los meses|mensualmente|cada dia|todos los dias|diariamente|cada (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/.test(t)) return null;
  if(/\bcada\s+\d+\s+(?:meses|dias|semanas)\b/.test(t)) return {clarification:'Indica una frecuencia diaria, semanal o mensual y el día que quieres usar.'};
  let frequency='daily',dayOfMonth,weekday=0;
  if(/cada mes|todos los meses|mensualmente/.test(t)) {
    frequency='monthly';dayOfMonth=Number(t.match(/(?:dia\s+|el\s+)(\d{1,2})\s*(?:de\s+)?(?:cada mes|todos los meses)/)?.[1] || t.match(/cada mes(?:\s+el)?\s+(?:dia\s+)?(\d{1,2})/)?.[1]);
    if(!dayOfMonth || dayOfMonth>31) return {clarification:'¿Qué día del mes quieres el recordatorio? Por ejemplo, el día 7 de cada mes.'};
  } else {
    const day=t.match(/cada (domingo|lunes|martes|miercoles|jueves|viernes|sabado)/)?.[1];
    if(day) {frequency='weekly';weekday=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'].indexOf(day);}
  }
  const time=t.match(/\ba las?\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)?/);
  let hour='09:00';
  if(time) {
    let h=Number(time[1]),m=Number(time[2] || 0);
    if(h>23 || m>59 || time[3] && (h<1 || h>12)) return {clarification:'Indica una hora válida para el recordatorio.'};
    if(time[3]) h=h%12+(/^(p|de la tarde|de la noche)/.test(time[3]) ? 12:0);
    else if(h>0 && h<12 && frequency==='daily') {
      const local=clockContext(now,DOMINICAN_TIME_ZONE).now_local.slice(11,16);
      if(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`<=local && `${h+12}:${String(m).padStart(2,'0')}`>local) h+=12;
    }
    hour=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  let title=text.replace(/^.*?\b(?:recu[eé]rdame|recordarme|que me recuerdes|recordatorio|av[ií]same)\b/i,'')
    .replace(/\b(?:el\s+)?(?:d[ií]a\s+)?\d{1,2}\s+(?:de\s+)?cada mes\b|\bcada mes(?:\s+el)?\s+(?:d[ií]a\s+)?\d{1,2}\b|\btodos los meses\b|\bmensualmente\b|\bcada d[ií]a\b|\btodos los d[ií]as\b|\bdiariamente\b|\bcada (?:domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/gi,'')
    .replace(/\ba las?\s+\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|de la ma[nñ]ana|de la tarde|de la noche)?/gi,'')
    .replace(/^\s*(?:que\s+(?:debo\s+)?|para\s+|de\s+)/i,'').replace(/\s+/g,' ').trim();
  if(!title) return {clarification:'Indica qué quieres que te recuerde.'};
  return {kind:'recurring_reminder',frequency,dayOfMonth,weekday,hour,title,brief:text,channel:'auto',defaultHour:!time};
}
