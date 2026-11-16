import { publicInstagramResearchUrl } from './owner-research-request.js';

const clean = (value, limit) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
const identity = value => {
  const source = publicInstagramResearchUrl(value);
  return source ? `${source.scope}:${source.postId || new URL(source.sourceUrl).pathname.toLowerCase()}` : null;
};

/** Retrieve the requested public URL itself; snippets for similar posts are not evidence. */
export async function readPublicInstagramSource(env, { url }, fetcher = fetch) {
  const source = publicInstagramResearchUrl(url);
  if (!source) return { configured: Boolean(env.EXA_API_KEY), results: [], reason: 'La URL no identifica una publicación o perfil público de Instagram válido.' };
  if (!env.EXA_API_KEY) return { configured: false, results: [], reason: 'La lectura pública no está conectada.' };
  let response, data;
  try {
    response = await fetcher('https://api.exa.ai/contents', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.EXA_API_KEY },
      body: JSON.stringify({ urls: [source.sourceUrl], text: { maxCharacters: 12000 }, maxAgeHours: 24, livecrawlTimeout: 12000 }),
      signal: AbortSignal.timeout(18000),
    });
    data = await response.json();
  } catch {
    return { configured: true, results: [], reason: 'La lectura de la publicación no respondió; no pude verificar su contenido.' };
  }
  if (!response.ok) return { configured: true, results: [], reason: `La lectura pública respondió ${response.status}; el contenido no fue verificado.` };
  const statuses = Array.isArray(data?.statuses) ? data.statuses : [];
  const status = statuses.find(item => identity(item.id || item.url) === identity(source.sourceUrl));
  if (!status || status.status !== 'success') return { configured: true, results: [], reason: 'La publicación solicitada no pudo recuperarse; puede requerir acceso o no estar disponible públicamente.' };
  const result = (Array.isArray(data.results) ? data.results : []).find(item => identity(item.url) === identity(source.sourceUrl));
  const text = clean(result?.text, 12000);
  if (!result || !text || /^(?:log in|sign up|inicia sesion|registrate|instagram)\s*[.!]?$/i.test(text)
    || /\b(?:log in to (?:continue|see)|sign in to (?:continue|see)|inicia sesi[oó]n para (?:continuar|ver))\b/i.test(text)
    || /\b(?:login|log in|iniciar sesi[oó]n)\b/i.test(String(result.title || ''))) {
    return { configured: true, results: [], reason: 'La lectura devolvió una página sin contenido suficiente de la publicación.' };
  }
  return { configured: true, results: [{ url: clean(result.url, 2048), title: clean(result.title, 250), text,
    publishedDate: clean(result.publishedDate, 80), author: clean(result.author, 180), retrieval: 'contents',
    contentAccess: 'text', mediaVerified: false, complete: false, truncated: String(result.text).length >= 12000,
    cached: status.source === 'cached',
  }], reason: 'Se recuperó texto público de la URL solicitada. Las diapositivas, imágenes, audio y vídeo no se verificaron completos.' };
}
