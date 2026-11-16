/**
 * Result rendering boundary. Only the application supplies evidence; model
 * output selects facts by ID or supplies explicitly labelled interpretation.
 * This is deliberately not a semantic truth detector for arbitrary prose.
 */
const TERMINAL = new Set(['observed','prepared','completed','sent']);
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const canonical = value => String(value).normalize('NFC').replace(/\s+/g,' ').trim();
const urlPattern = /https?:\/\/[^\s<>"\\]+/gi;
const numericPattern = /(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)*(?:\s*%?)/gu;
const writtenQuantityPattern = /\b(?:(?:cero|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|one|two|three|four|five|six|seven|eight|nine|ten|hundred)\s+(?:dolares?|euros?|pesos?|por ciento|percent|usd|dop|eur|dollars?))|\b(?:mil(?:es)?|millones?|billones?|thousand|million|billion)\b/i;
const negativePattern = /\b(?:no disponible|not available|unavailable|not supported|unsupported|not included|carece de|sin acceso|sin permiso|no (?:se )?(?:admite|permite|incluye|soporta|dispone|tiene|hay|confirma)|no esta (?:disponible|conectad[oa])|no puede|no verificad[oa]|cannot|can't|does not|doesn't|no audit|sin auditoria)\b|:\s*false\b/i;
const positivePattern = /\b(?:ilimitad\w*|unlimited|disponible|available|admite|permite|incluye|soporta|habilitad\w*|guarantee\w*|garantiza\w*|confirmad\w*|supported)\b/i;
const cautionPattern = /\b(?:no|not|sin|without|verificar|verificacion|comprobar|confirmar|pendiente|limitacion\w*|cautela|incertidumbre|falta|revisar|check|verify|uncertain|limitation\w*)\b/i;
const stop = new Set(('el la los las un una unos unas de del al a en y o con por para que se es son esta estan este esto estos estas hay tiene tienen no sin not available disponible supported soporte admite permite incluye puede does doesn t cannot acceso permiso unavailable unsupported verificar comprobar confirmar pendiente limitacion limitaciones').split(' '));
const cleanText = text => typeof text === 'string' && text.trim() && text.length <= 6000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const verified = receipt => receipt?.verified === true && TERMINAL.has(receipt.status)
  && typeof receipt.tool === 'string' && receipt.tool.length > 0;
const urls = value => [...String(value).matchAll(urlPattern)].map(match=>match[0].replace(/[),.;]+$/,''));
const terms = value => new Set((fold(value).match(/[a-z]{3,}/g) || []).filter(word=>!stop.has(word)));

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) {
  // IDs are references, never an authentication boundary. Authority comes
  // from the application-owned evidence map and correlated tool receipts.
  let code = 2166136261;
  for (const char of value) code = Math.imul(code ^ char.charCodeAt(0),16777619);
  return (code >>> 0).toString(16).padStart(8,'0');
}
const numericUnit = (path,context) => {
  const currency = context?.currency || context?.currencyCode || path.split('.').find(part=>/^(?:USD|DOP|EUR|GBP|BOB)$/.test(part));
  return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null;
};

/** Build blocks from live verified tool data and exact correlated task memory.
 * Truncated/non-JSON memories and model/owner memories are never promoted to
 * tool evidence. Parent tasks can import specialist receipts via source IDs.
 */
export function buildAgentEvidence({ observations = [], task = null, maxBlocks = 80 } = {}) {
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 200) throw new TypeError('invalid_grounding_block_limit');
  const blocks = [], seen = new Set();
  function add(text,provenance,number = null) {
    if (blocks.length >= maxBlocks || !cleanText(text)) return;
    const signature = stable({text,provenance});
    if (seen.has(signature)) return;
    seen.add(signature);
    const base = `E${hash(signature)}`;
    let id = base, suffix = 1;
    while (blocks.some(block=>block.id === id)) id = `${base}-${suffix++}`;
    blocks.push({id,text,provenance,...(number ? {number} : {})});
  }
  function walk(data,provenance,path = '',context = null,depth = 0) {
    if (blocks.length >= maxBlocks || depth > 8 || data === null || data === undefined) return;
    if (typeof data === 'string') {
      if (!cleanText(data) || /^https?:\/\/\S+$/i.test(data)) return;
      // Keep the entire statement, including restrictions and qualifications;
      // cutting a phrase could turn "not available" into a positive claim.
      add(data,{...provenance,path});
      return;
    }
    if (typeof data === 'number' && Number.isFinite(data)) {
      const unit = numericUnit(path,context);
      const field = path.split('.').at(-1);
      const label = field === 'followers' ? `${data} seguidores comprobados`
        : `${{income:'Entradas registradas',expense:'Salidas registradas',net:'Diferencia registrada'}[field] || path || 'valor'}: ${data}${unit ? ` ${unit}` : ''}`;
      add(label,{...provenance,path},
        {value:data,unit,field:path});
      return;
    }
    if (typeof data === 'boolean') {
      add(`${path || 'valor'}: ${data ? 'true' : 'false'}`,{...provenance,path});
      return;
    }
    if (Array.isArray(data)) {
      data.slice(0,100).forEach((item,index)=>walk(item,provenance,`${path}[${index}]`,context,depth+1));
      return;
    }
    if (isObject(data)) {
      const sourceUrl = [data.url,data.sourceUrl].find(value=>typeof value === 'string' && /^https:\/\//.test(value)) || provenance.url;
      const parent = {...context,...data};
      if (data._grounding?.partial === true) add('Cobertura parcial: hay datos omitidos. No hay evidencia suficiente para afirmar que las partes ausentes se comprobaron.',{...provenance,path:path ? `${path}._grounding` : '_grounding'});
      for (const [key,value] of Object.entries(data).slice(0,100)) {
        if (['url','sourceUrl','retrievedAt','verifiedAt','id','jobId','eventId','operationId','objectKey','mimeType','configured','connected','status','_grounding'].includes(key)) continue;
        walk(value,{...provenance,...(sourceUrl ? {url:sourceUrl} : {})},path ? `${path}.${key}` : key,parent,depth+1);
      }
    }
  }
  for (const [index,observation] of observations.entries()) {
    if (!verified(observation?.receipt) || observation.ok === false || !isObject(observation.data)) continue;
    const receipt = observation.receipt;
    walk(observation.data,{tool:receipt.tool,operationId:receipt.operationId || null,
      sourceId:observation.operationKey || receipt.operationId || `observation:${index}`,
      ...(observation.agent ? {agent:observation.agent} : {})});
  }
  for (const memory of task?.memory || []) {
    if (memory?.source?.kind !== 'tool' || typeof memory.fact !== 'string') continue;
    const receipt = (task.receipts || []).find(item=>verified(item)
      && (item.key === memory.source.id || item.operationId === memory.source.id));
    if (!receipt) continue;
    let data;
    try { data = JSON.parse(memory.fact); } catch { continue; }
    if (!isObject(data)) continue;
    walk(data,{tool:receipt.tool,operationId:receipt.operationId || null,sourceId:memory.source.id,
      ...(receipt.via?.agent || memory.via?.agent || task.agent ? {agent:receipt.via?.agent || memory.via?.agent || task.agent} : {})});
  }
  return blocks;
}

function checkedBlocks(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('invalid_grounding_evidence');
  const map = new Map();
  for (const block of evidence) {
    if (!block || typeof block.id !== 'string' || !cleanText(block.text) || !isObject(block.provenance)
      || typeof block.provenance.tool !== 'string' || map.has(block.id)) throw new TypeError('invalid_grounding_block');
    map.set(block.id,block);
  }
  return map;
}
function contradictedRestriction(text,blocks) {
  const candidateTerms = terms(text), normalized = fold(text);
  for (const block of blocks) {
    if (!negativePattern.test(fold(block.text))) continue;
    const subjects = terms(block.text);
    if (![...subjects].some(term=>candidateTerms.has(term))) continue;
    // Inferences may recommend checking a restriction. They cannot reverse it
    // into availability/unlimited support under an "Inference" heading.
    if (positivePattern.test(normalized) || !cautionPattern.test(normalized)) return true;
  }
  return false;
}

/** Render model-selected claims. A fact is either an exact evidence block or
 * application-computed arithmetic. Free text is always labelled "Inferencia"
 * and cannot carry numbers, new URLs, or reverse recorded negative limits.
 * Returns no partial text on validation failure.
 */
export function validateAgentResult(candidate,evidence,{maxChars = 12000} = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 200 || maxChars > 20000) throw new TypeError('invalid_grounding_output_limit');
  const map = checkedBlocks(evidence), errors = [], receipts = [], output = [], cited = new Map();
  const cite = block => {
    if (!cited.has(block.id)) cited.set(block.id,cited.size+1);
    return `[${cited.get(block.id)}]`;
  };
  if (!isObject(candidate) || !Array.isArray(candidate.claims) || !candidate.claims.length || candidate.claims.length > 24) {
    return {ok:false,text:'',errors:['claims_required'],receipts:[]};
  }
  for (const [index,claim] of candidate.claims.entries()) {
    const error = code => errors.push(`${index}:${code}`);
    if (!isObject(claim) || !['fact','inference','derived'].includes(claim.kind)
      || !Array.isArray(claim.evidenceIds) || !claim.evidenceIds.length || claim.evidenceIds.length > 12
      || claim.evidenceIds.some(id=>typeof id !== 'string' || !map.has(id))
      || new Set(claim.evidenceIds).size !== claim.evidenceIds.length) {error('invalid_claim_evidence');continue;}
    const blocks = claim.evidenceIds.map(id=>map.get(id));
    if (claim.kind === 'fact') {
      const exact = blocks.map(block=>block.text).join('\n');
      if (claim.text !== undefined && canonical(claim.text) !== canonical(exact)) {error('fact_must_match_evidence');continue;}
      output.push(blocks.map(block=>`${block.text} ${cite(block)}`).join('\n'));
      receipts.push({kind:'fact',verified:true,evidenceIds:claim.evidenceIds,
        provenance:blocks.map(block=>block.provenance)});
      continue;
    }
    if (claim.kind === 'inference') {
      if (!cleanText(claim.text) || claim.text.length > 1800) {error('invalid_inference');continue;}
      if ([...claim.text.matchAll(numericPattern)].length || writtenQuantityPattern.test(fold(claim.text))) {error('inference_numbers_require_derivation');continue;}
      const allowedUrls = new Set(blocks.flatMap(block=>[...urls(block.text),block.provenance.url].filter(Boolean)));
      if (urls(claim.text).some(url=>!allowedUrls.has(url))) {error('unsupported_inference_url');continue;}
      if (contradictedRestriction(claim.text,evidence)) {error('negative_restriction_conflict');continue;}
      if (!/\b(?:podria|convendria|sugier\w*|recomiend\w*|consider\w*|parece|posible|hipotesis|quiza|probable\w*|puede ser|may|might|could|recommend\w*|suggest\w*)\b/i.test(fold(claim.text))) {
        error('inference_must_be_explicitly_tentative');continue;
      }
      output.push(`Inferencia: ${claim.text} ${blocks.map(cite).join(' ')}`);
      receipts.push({kind:'inference',verified:false,evidenceIds:claim.evidenceIds,
        provenance:blocks.map(block=>block.provenance)});
      continue;
    }
    const numbers = blocks.map(block=>block.number);
    if (!['sum','difference','mean'].includes(claim.operation) || numbers.some(number=>!number || !Number.isFinite(number.value))
      || (claim.operation === 'difference' && numbers.length !== 2)
      || new Set(numbers.map(number=>number.unit)).size !== 1 || !numbers[0].unit) {error('invalid_numeric_derivation');continue;}
    // Same currency does not make income, account balance and transaction
    // count additive. Require a single numeric field (across separate records).
    const fields = numbers.map(number=>number.field.replace(/\[\d+\]/g,'[]').split('.').at(-1));
    if (new Set(fields).size !== 1) {error('incompatible_numeric_fields');continue;}
    const inputs = blocks.map(block=>stable({tool:block.provenance.tool,
      source:block.provenance.operationId || block.provenance.sourceId,path:block.provenance.path}));
    if (new Set(inputs).size !== inputs.length) {error('duplicate_numeric_observation');continue;}
    if (claim.text !== undefined || claim.value !== undefined || claim.unit !== undefined) {error('derived_value_is_application_owned');continue;}
    const sum = numbers.reduce((total,number)=>total+number.value,0);
    const value = claim.operation === 'sum' ? sum : claim.operation === 'mean' ? sum/numbers.length : numbers[0].value-numbers[1].value;
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {error('unsafe_numeric_derivation');continue;}
    const rounded = Math.round((value+Number.EPSILON)*100)/100;
    const label = {sum:'Suma',difference:'Diferencia',mean:'Promedio'}[claim.operation];
    const text = `${label} de ${fields[0]}: ${rounded} ${numbers[0].unit}`;
    output.push(`${text} ${blocks.map(cite).join(' ')}`);
    receipts.push({kind:'derived',verified:true,operation:claim.operation,value:rounded,unit:numbers[0].unit,
      evidenceIds:claim.evidenceIds,provenance:blocks.map(block=>block.provenance)});
  }
  if (errors.length) return {ok:false,text:'',errors,receipts:[]};
  // Selecting a true positive sentence must not conceal a separate known
  // limitation. Preserve every checked negative constraint in this task's
  // evidence, including conflicting sources; callers may not cherry-pick a
  // different source ID to evade it. The output budget below fails closed.
  for (const block of evidence) {
    if (cited.has(block.id) || !negativePattern.test(fold(block.text))) continue;
    output.push(`${block.text} ${cite(block)}`);
    receipts.push({kind:'constraint',verified:true,evidenceIds:[block.id],provenance:[block.provenance]});
  }
  const references = [...cited].map(([id,index])=>{
    const source = map.get(id).provenance;
    return `[${index}] ${source.url || 'Registros verificados'}`;
  });
  const text = [...output,'',...references].join('\n');
  return text.length > maxChars ? {ok:false,text:'',errors:['grounding_output_too_long'],receipts:[]}
    : {ok:true,text,errors:[],receipts};
}

/** Deterministic fallback preserves actual findings, limitations and sources;
 * it never substitutes an ungrounded success sentence for a missing answer.
 */
export function groundedAgentFallback(evidence,{limit = 6,maxChars = 12000} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new TypeError('invalid_grounding_fallback_limit');
  checkedBlocks(evidence);
  if (!evidence.length) return {ok:false,text:'No hay datos de herramientas comprobados para redactar el resultado.',errors:['evidence_missing'],receipts:[]};
  const constraints = evidence.filter(block=>negativePattern.test(fold(block.text)));
  const relevance = block => /(?:^|\.)(?:report|text|highlights)(?:\[|\.|$)/.test(block.provenance.path || '') ? 0
    : block.number ? 1 : /(?:^|\.)(?:title|publishedDate|date|month)$/.test(block.provenance.path || '') ? 3 : 2;
  const ordered = [...constraints,...evidence.filter(block=>!constraints.includes(block)).sort((a,b)=>relevance(a)-relevance(b))];
  const chosen = [];
  for (const block of ordered) {
    if (chosen.filter(item=>!constraints.includes(item)).length >= limit && !constraints.includes(block)) continue;
    const next = validateAgentResult({claims:[...chosen,block].map(item=>({kind:'fact',evidenceIds:[item.id]}))},evidence,{maxChars});
    if (next.ok) chosen.push(block);
    // Do not publish a selective excerpt which silently erases a known limit.
    else if (constraints.includes(block)) return {ok:false,text:'Los datos comprobados incluyen límites que no caben completos en este mensaje; hace falta revisar el informe completo.',errors:['grounding_constraints_too_long'],receipts:[]};
  }
  return chosen.length ? validateAgentResult({claims:chosen.map(block=>({kind:'fact',evidenceIds:[block.id]}))},evidence,{maxChars})
    : {ok:false,text:'Los datos comprobados no caben completos en este mensaje.',errors:['grounding_output_too_long'],receipts:[]};
}

/** Keep complete JSON values rather than slicing serialized tool data. The
 * byte budget is the existing task-memory field budget; omitted fields are
 * explicit and cannot be used as evidence. Restrictions are retained first.
 */
export function serializeAgentToolMemory(data,{maxChars = 1900} = {}) {
  if (!isObject(data) || !Number.isInteger(maxChars) || maxChars < 200 || maxChars > 12000) throw new TypeError('invalid_grounding_memory');
  const encoded = JSON.stringify(data);
  if (encoded.length <= maxChars) return encoded;
  const leaves = [];
  function visit(value,path = [],depth = 0) {
    if (depth > 8 || leaves.length >= 400 || value === undefined) return;
    if (value !== null && typeof value === 'object') {
      for (const [key,child] of Object.entries(value).slice(0,80)) {
        if (['__proto__','constructor','prototype','_grounding'].includes(key)) continue;
        visit(child,[...path,Array.isArray(value) ? Number(key) : key],depth+1);
      }
      return;
    }
    const text = String(value),key = path.at(-1);
    const rank = negativePattern.test(fold(text)) ? 0 : ['url','sourceUrl'].includes(key) ? 1
      : path.some(part=>['highlights','report','text','summary'].includes(part)) ? 2 : typeof value === 'number' ? 3 : 4;
    leaves.push({path,value,rank});
  }
  visit(data);leaves.sort((a,b)=>a.rank-b.rank);
  let bounded = {},retained = 0;
  for (const leaf of leaves) {
    const next = structuredClone(bounded);let current = next;
    for (let index=0;index<leaf.path.length;index++) {
      const key = leaf.path[index];
      if (index === leaf.path.length-1) current[key] = leaf.value;
      else {current[key] ??= typeof leaf.path[index+1] === 'number' ? [] : {};current = current[key];}
    }
    if (JSON.stringify({...next,_grounding:{partial:true,omittedFields:leaves.length-retained}}).length <= maxChars) {bounded=next;retained++;}
  }
  return JSON.stringify({...bounded,_grounding:{partial:true,omittedFields:leaves.length-retained}});
}
