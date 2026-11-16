import {stripAgentAddress} from './melodi-address.js';
const fold=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

/** Direct research/analysis assignments; quoted or supplied document text is data. */
export function parseOwnerObjectiveRequest(raw) {
  const original=stripAgentAddress(raw),line=original.split(/\r?\n/,1)[0].trim();
  let text=fold(line);
  if(!text || original.length>4000 || /^[“"«>]/.test(text) || /\b(?:instagram|reels?|historias?|publicaciones? de)\b/.test(text)) return null;
  text=text.replace(/^(?:por favor[, ]+)?(?:(?:quiero|necesito) que (?:me )?|(?:puedes|podrias) (?:por favor )?)/,'');
  if(!/^(?:investiga(?:me)?|averigua|compara|busca(?:me)?|analiza|coordina|encargate de|organiza)\b/.test(text)) return null;
  // File retrieval, reminders and outside recipients retain their dedicated
  // authorization and delivery workflows, rather than becoming a broad goal.
  if(/\b(?:archivo|documento|pdf|factura|cotizacion)\s+(?:guardad[oa]|emitid[oa]|existente)|\b(?:recuerdame|recordatorio|cada (?:dia|semana|mes)|envia\w* (?:un )?(?:correo|email)|publica\w*)\b/.test(text)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line)) return null;
  const finance=/\b(?:mis (?:finanzas|gastos|ingresos|ahorros|presupuestos|cuentas|deudas)|mi (?:presupuesto|saldo))\b/.test(text);
  const research=/^(?:investiga(?:me)?|averigua|compara|busca(?:me)?)\b/.test(text)
    || /^(?:coordina|encargate de)\b.*\b(?:investigar|investigacion|buscar fuentes|comparar)\b/.test(text);
  if(!finance && !research) return null;
  const requiredTools=finance?['inspect_finances']:research?['research_public_web']:[];
  if(/\b(?:prepara|crea|genera|entrega|haz)\b.{0,80}\b(?:informe|reporte|pdf|documento|docx|plan)\b/.test(text)) requiredTools.push('prepare_document');
  return{agent:finance?'melodi':research?'melodi':'melodi',objective:original.trim(),requiredTools};
}
