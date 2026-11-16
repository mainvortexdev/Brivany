const clip = (value,max) => String(value || '').replace(/\u0000/g,'').trim().slice(0,max);

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !url.hostname.includes('.') || /^(?:\d[\d.]*|\[.*\])$/.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

async function boundedJson(response) {
  if (!response.body) throw Error('public_search_empty_response');
  const reader = response.body.getReader(),chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128_000) throw Error('public_search_response_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0; for (const chunk of chunks) { bytes.set(chunk,at);at += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Existing search integration, with general queries and evidence provenance. */
export async function researchPublicWeb(env,{query},fetcher = fetch) {
  if (!env.EXA_API_KEY) return {configured:false,available:false,results:[],reason:'La búsqueda pública no está conectada.'};
  if (typeof query !== 'string' || !query.trim() || query.length > 700 || /\u0000/.test(query)) throw Error('invalid_public_search_query');
  if (/\b(?:api[_ -]?key|password|contrase(?:ñ|n)a|secret|token)\s*[:=]\s*\S+/i.test(query)) throw Error('private_search_query_rejected');
  const response = await fetcher('https://api.exa.ai/search',{
    method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.EXA_API_KEY},
    body:JSON.stringify({query:query.trim(),numResults:6,type:'auto',contents:{highlights:true}}),
    signal:AbortSignal.timeout(18_000),
  });
  if (!response.ok) return {configured:true,available:false,results:[],reason:`La búsqueda pública respondió ${response.status}.`};
  const data = await boundedJson(response),retrievedAt = new Date().toISOString();
  const results = (Array.isArray(data.results) ? data.results : []).slice(0,6).flatMap(item => {
    const url = publicUrl(item.url);
    return url ? [{title:clip(item.title,180),url,publishedDate:clip(item.publishedDate,40),retrievedAt,
      highlights:(Array.isArray(item.highlights) ? item.highlights : []).slice(0,3).map(text=>clip(text,900))}] : [];
  });
  return {configured:true,status:'observed',retrievedAt,results,
    evidenceScope:'Fragmentos públicos recuperados; no prueban métricas privadas ni acciones realizadas.'};
}
