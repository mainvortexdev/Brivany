import { stripAgentAddress } from './melodi-address.js';

const fold=value=>String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();

/** A bounded read-only question can go straight to conversation, never to tools. */
export function ownerInformationQuery(raw) {
  const text=fold(stripAgentAddress(raw)).replace(/^[¿?\s]+/,'');
  if(!text || text.length>1800 || /[\r\n]/.test(text) || /^["«“>]/.test(text)) return false;
  if(!/\b(?:cognira|vetsa|spaik|remote host)\b/.test(text)) return false;
  if(!/^(?:cual(?:es)?|que|como|por que|cuando|donde|quien(?:es)?|en que|hay|tiene|puede|sabes|me (?:explicas|cuentas)|explica(?:me)?|cuenta(?:me)?|dime)\b/.test(text)) return false;
  // Compound instructions and requests to act keep the tool/authorization path.
  if(/\b(?:envia\w*|manda\w*|publica\w*|borra\w*|elimina\w*|descarga\w*|sube|ejecuta\w*|conecta\w*|desconecta\w*|recuerdame|avisame|agenda|programa\w*|guarda\w*|registra\w*|cambia\w*|actualiza\w*|crea(?:me)?|genera\w*|prepara\w*|haz(?:me)?|investiga\w*|busca(?:me)?|compara\w*|analiza\w*|cancela\w*|activa\w*|desactiva\w*)\b/.test(text)) return false;
  if(/\b(?:puedes|podrias|puede|como)\b.{0,50}\b(?:crear|generar|enviar|mandar|publicar|descargar|subir|ejecutar|conectar|borrar|eliminar|guardar|recordar|programar|cambiar|actualizar|investigar|buscar|comparar|analizar)\b/.test(text)) return false;
  return true;
}

/** Factual degraded-mode answer: quote complete reference blocks, never simulate work. */
export function ecosystemReferenceAnswer(context) {
  if(typeof context!=='string') return '';
  let data;
  try {data=JSON.parse(context.slice(context.indexOf('{')));} catch {return '';}
  if(!data?.referenceOnly || !Array.isArray(data.reports)) return '';
  for(const report of data.reports){
    const excerpt=(report.excerpts || []).find(item=>typeof item.text==='string' && item.text.length>=70 && item.text.length<=2100
      && !/^\s*\|/.test(item.text) && !/^\*\*(?:Fecha|Informe|Productos|Carácter)/.test(item.text)
      && !/^Fuentes|^Para los recuentos|^Las rutas siguientes/.test(item.text));
    if(excerpt && /^\d{4}-\d{2}-\d{2}/.test(report.revision))
      return `El informe técnico del ${report.revision.slice(0,10)} recoge lo siguiente:\n\n${excerpt.text.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/\*\*/g,'').trim()}\n\nEs el estado documentado; no confirma cambios posteriores.`;
  }
  return '';
}
