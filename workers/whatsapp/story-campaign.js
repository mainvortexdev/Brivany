import { localDateTimeToUtc } from './event-time.js';
import { permissionForTool } from './melodi-permissions.js';
import { calendarActivityPaused, calendarScheduleExclusion } from './google-calendar-guards.js';

const STAGES = [
  { name: 'filtro', time: '08:30', goal: 'Pregunta breve y fácil de responder; enganchar sin vender.' },
  { name: 'contexto', time: '11:30', goal: 'Mostrar el proceso real de Daniel y conectar humanamente, sin inventar sucesos.' },
  { name: 'valor', time: '15:30', goal: 'Una enseñanza concreta, precisa y breve sobre el tema del día.' },
  { name: 'cierre', time: '19:30', goal: 'Una llamada a la acción natural por mensaje directo; sin prometer sticker de enlace.' },
];
const THEMES = [
  'planificación de contenido para marcas personales',
  'edición de video y narrativa visual',
  'automatización de tareas con agentes de IA',
  'diseño de sistemas de IA para empresas',
  'errores frecuentes en la creación de contenido',
  'cómo organizar una producción de video',
  'cómo unir contenido, tecnología y atención al cliente',
];

async function currentStorySchedule(env, story, single = false) {
  if (await calendarActivityPaused(env.VETSA_CLOUD,story.owner_phone,single?'story_single':'story_slot',story.id)) return false;
  const table = single ? 'wa_story_single_drafts' : 'wa_story_slots';
  const row = await env.VETSA_CLOUD.prepare(`SELECT * FROM ${table} WHERE id=? AND owner_phone=? AND scheduled_at=?
    AND status IN ('ready','publishing') AND COALESCE(error_code,'')<>'calendar_cancelled'`)
    .bind(story.id,story.owner_phone,story.scheduled_at).first();
  if (!row) return null;
  if (!single) {
    const campaign = await env.VETSA_CLOUD.prepare("SELECT id FROM wa_story_campaigns WHERE id=? AND owner_phone=? AND status='active'").bind(row.campaign_id,row.owner_phone).first();
    if (!campaign) return null;
  }
  return row;
}

function singleStoryEditorial(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const clock = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const minutes = Number(clock.hour) * 60 + Number(clock.minute);
  const stage = minutes < 11 * 60 + 30 ? STAGES[0]
    : minutes < 15 * 60 + 30 ? STAGES[1]
      : minutes < 19 * 60 + 30 ? STAGES[2] : STAGES[3];
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const themeIndex = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[weekday] ?? 0;
  return { stage, theme: THEMES[themeIndex] };
}

function zoneDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function weeklyStorySlots(now = new Date(), timeZone = 'America/Santo_Domingo') {
  const today = zoneDate(now, timeZone);
  const firstDay = new Date(`${today}T12:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() + 1);
  const slots = [];
  for (let day = 0; day < 7; day += 1) {
    const date = new Date(firstDay);
    date.setUTCDate(date.getUTCDate() + day);
    for (const stage of STAGES) {
      const scheduledAt = localDateTimeToUtc(`${date.toISOString().slice(0, 10)}T${stage.time}`, timeZone);
      if (!scheduledAt) throw new Error('No se pudo validar el horario de las historias.');
      slots.push({ day, stage: stage.name, scheduledAt });
    }
  }
  return slots;
}

async function imageReady(env) {
  if (!env.VETSA_INTELLIGENCE || !env.VETSA_INTELLIGENCE_API_KEY) return false;
  const response = await env.VETSA_INTELLIGENCE.fetch('https://vetsa.internal/health');
  const data = await response.json().catch(() => ({}));
  return response.ok && data.imageReady === true;
}

async function instagramReady(env) {
  if (!env.VETSA_INSTAGRAM_OPERATIONS || !env.INSTAGRAM_INTERNAL_TOKEN) return false;
  const response = await env.VETSA_INSTAGRAM_OPERATIONS.fetch('https://instagram.internal/health');
  const data = await response.json().catch(() => ({}));
  return response.ok && data.publishingReady === true && data.mediaDeliveryReady === true;
}

export async function saveStoryPortrait(env, phone, reference) {
  if (reference?.kind !== 'image' || !reference.objectKey || !['image/jpeg', 'image/png'].includes(reference.mimeType)) {
    throw new Error('Envíame una foto JPEG o PNG tuya, nítida y sin otras personas.');
  }
  const object = await env.VETSA_MEDIA.get(reference.objectKey);
  if (!object || object.size < 20_000 || object.size > 5_000_000) throw new Error('La foto debe pesar entre 20 KB y 5 MB. Envíamela de nuevo como JPEG o PNG.');
  const bytes = new Uint8Array(await object.arrayBuffer());
  const dimensions = storyImageDimensions(bytes, reference.mimeType);
  if (!dimensions || dimensions.width < 400 || dimensions.height < 400) throw new Error('No pude validar el tamaño de la foto. Envíame un JPEG o PNG nítido.');
  const now = new Date().toISOString();
  await env.VETSA_CLOUD.prepare(`INSERT INTO wa_story_portraits (owner_phone,object_key,mime_type,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(owner_phone) DO UPDATE SET object_key=excluded.object_key,mime_type=excluded.mime_type,updated_at=excluded.updated_at`)
    .bind(phone, reference.objectKey, reference.mimeType, now).run();
  await env.VETSA_CLOUD.prepare('INSERT INTO wa_story_portrait_refs (id,owner_phone,object_key,mime_type,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), phone, reference.objectKey, reference.mimeType, now).run();
  return { updatedAt: now };
}

export async function saveStoryVisualReference(env, phone, reference, guidance = '') {
  if (reference?.kind !== 'image' || !reference.objectKey || !['image/jpeg', 'image/png'].includes(reference.mimeType)) {
    throw new Error('Envíame una imagen JPEG o PNG como referencia visual.');
  }
  const object = await env.VETSA_MEDIA.get(reference.objectKey);
  if (!object || object.size < 5_000 || object.size > 5_000_000) throw new Error('La referencia visual debe pesar entre 5 KB y 5 MB para poder usarla en la generación.');
  const bytes = new Uint8Array(await object.arrayBuffer());
  const dimensions = storyImageDimensions(bytes, reference.mimeType);
  if (!dimensions || dimensions.width < 200 || dimensions.height < 200) throw new Error('No pude validar las dimensiones de la referencia visual.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.VETSA_CLOUD.prepare(`INSERT INTO wa_story_visual_refs
    (id,owner_phone,object_key,mime_type,guidance,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)`)
    .bind(id, phone, reference.objectKey, reference.mimeType, String(guidance || '').slice(0, 500), now, now).run();
  return { id, createdAt: now };
}

async function imageAsBase64(env, reference) {
  const objectKey = reference?.object_key || reference?.objectKey;
  const mimeType = reference?.mime_type || reference?.mimeType;
  if (!objectKey) return null;
  const object = await env.VETSA_MEDIA.get(objectKey);
  if (!object || object.size > 5_000_000) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { imageBase64: btoa(binary), imageMimeType: mimeType };
}

export async function ownerImageGenerationReferences(env, phone) {
  const [portrait, style] = await Promise.all([
    env.VETSA_CLOUD.prepare('SELECT object_key,mime_type FROM wa_story_portraits WHERE owner_phone=?').bind(phone).first(),
    env.VETSA_CLOUD.prepare('SELECT object_key,mime_type,guidance FROM wa_story_visual_refs WHERE owner_phone=? AND active=1 ORDER BY created_at DESC LIMIT 1').bind(phone).first(),
  ]);
  const [identity, visual] = await Promise.all([imageAsBase64(env, portrait), imageAsBase64(env, style)]);
  return {
    ...(identity ? { imageBase64: identity.imageBase64, imageMimeType: identity.imageMimeType } : {}),
    ...(visual ? { referenceImages: [{ imageBase64: visual.imageBase64, imageMimeType: visual.imageMimeType }] } : {}),
    visualGuidance: style?.guidance || '',
  };
}

export async function startStoryCampaign(env, phone, brief) {
  if (!await imageReady(env)) return { error: 'image_key_missing' };
  if (!await instagramReady(env)) return { error: 'instagram_not_ready' };
  const current = await env.VETSA_CLOUD.prepare("SELECT id FROM wa_story_campaigns WHERE owner_phone = ? AND status = 'active' LIMIT 1").bind(phone).first();
  if (current) return { error: 'already_active', id: current.id };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slots = weeklyStorySlots(new Date(), env.TIME_ZONE || 'America/Santo_Domingo');
  const statements = [
    env.VETSA_CLOUD.prepare("INSERT INTO wa_story_campaigns (id,owner_phone,status,brief,created_at,updated_at) VALUES (?,?,'active',?,?,?)")
      .bind(id, phone, String(brief || '').slice(0, 2_000), now, now),
    ...slots.map((slot) => env.VETSA_CLOUD.prepare(`INSERT INTO wa_story_slots
      (id,campaign_id,owner_phone,day_index,stage,scheduled_at,status,updated_at) VALUES (?,?,?,?,?,?,'pending',?)`)
      .bind(crypto.randomUUID(), id, phone, slot.day, slot.stage, slot.scheduledAt, now)),
  ];
  await env.VETSA_CLOUD.batch(statements);
  return { id, count: slots.length, firstAt: slots[0].scheduledAt, lastAt: slots.at(-1).scheduledAt };
}

export async function pauseStoryCampaign(env, phone) {
  const now = new Date().toISOString();
  const result = await env.VETSA_CLOUD.prepare("UPDATE wa_story_campaigns SET status='paused',updated_at=? WHERE owner_phone=? AND status='active'").bind(now, phone).run();
  return result.meta.changes > 0;
}

export async function storyCampaignStatus(env, phone) {
  const campaign = await env.VETSA_CLOUD.prepare('SELECT id,status,created_at FROM wa_story_campaigns WHERE owner_phone=? ORDER BY created_at DESC LIMIT 1').bind(phone).first();
  if (!campaign) return null;
  const progress = await env.VETSA_CLOUD.prepare('SELECT status,COUNT(*) AS count FROM wa_story_slots WHERE campaign_id=? GROUP BY status').bind(campaign.id).all();
  return { ...campaign, progress: Object.fromEntries((progress.results || []).map((row) => [row.status, row.count])) };
}

export async function setStoryAutoPublish(env, phone, enabled) {
  await env.VETSA_CLOUD.prepare(`INSERT INTO wa_story_publish_settings (owner_phone,auto_publish,updated_at)
    VALUES (?,?,?) ON CONFLICT(owner_phone) DO UPDATE SET auto_publish=excluded.auto_publish,updated_at=excluded.updated_at`)
    .bind(phone, enabled ? 1 : 0, new Date().toISOString()).run();
}

export async function autoPublish(env, phone) {
  const row = await env.VETSA_CLOUD.prepare('SELECT auto_publish FROM wa_story_publish_settings WHERE owner_phone=?').bind(phone).first();
  return row?.auto_publish === 1;
}

export async function trackPreparedStory(env, phone, operationId, media, scheduledAt) {
  if (!media?.objectKey || !media?.mimeType || !operationId) throw new Error('story_media_missing');
  const now = new Date().toISOString();
  await env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO wa_story_single_drafts
    (id,owner_phone,operation_id,object_key,mime_type,scheduled_at,status,preview_sent_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'ready',?,?,?)`)
    .bind(operationId, phone, operationId, media.objectKey, media.mimeType,
      scheduledAt && Date.parse(scheduledAt) > Date.now() ? scheduledAt : now, now, now, now).run();
}

export async function storyPortraitExists(env, phone) {
  const portrait = await env.VETSA_CLOUD.prepare('SELECT object_key,mime_type FROM wa_story_portraits WHERE owner_phone=?').bind(phone).first();
  if (!portrait) return false;
  const object = await env.VETSA_MEDIA.get(portrait.object_key);
  if (!object || object.size < 20_000 || object.size > 5_000_000) return false;
  const dimensions = storyImageDimensions(new Uint8Array(await object.arrayBuffer()), portrait.mime_type);
  return Boolean(dimensions && dimensions.width >= 400 && dimensions.height >= 400);
}

export async function approvePendingStory(env, phone) {
  const single = await env.VETSA_CLOUD.prepare(`SELECT id,operation_id,object_key,mime_type,scheduled_at,preview_sent_at FROM wa_story_single_drafts
    WHERE owner_phone=? AND status='ready' AND preview_sent_at IS NOT NULL AND approved_at IS NULL
      AND object_key IS NOT NULL AND mime_type IS NOT NULL
      AND preview_sent_at > datetime('now', '-2 hours')
    ORDER BY preview_sent_at DESC LIMIT 1`).bind(phone).first();
  const slot = await env.VETSA_CLOUD.prepare(`SELECT id,operation_id,object_key,mime_type,scheduled_at,preview_sent_at FROM wa_story_slots
    WHERE owner_phone=? AND status='ready' AND preview_sent_at IS NOT NULL AND approved_at IS NULL
      AND object_key IS NOT NULL AND mime_type IS NOT NULL
      AND preview_sent_at > datetime('now', '-2 hours')
    ORDER BY preview_sent_at DESC LIMIT 1`).bind(phone).first();
  const target = single && slot ? (single.preview_sent_at >= slot.preview_sent_at ? single : slot) : single || slot;
  if (!target) return null;
  return { ...target, kind: target === single ? 'single' : 'campaign' };
}

export async function declinePendingStory(env, phone, story) {
  if (!story?.id || !['single', 'campaign'].includes(story.kind)) return false;
  const table = story.kind === 'single' ? 'wa_story_single_drafts' : 'wa_story_slots';
  const result = await env.VETSA_CLOUD.prepare(`UPDATE ${table}
    SET status='needs_review',error_code='owner_declined',updated_at=?
    WHERE id=? AND owner_phone=? AND status='ready' AND preview_sent_at IS NOT NULL AND approved_at IS NULL`)
    .bind(new Date().toISOString(), story.id, phone).run();
  return Boolean(result.meta?.changes);
}

async function vetsaImage(env, prompt, portrait, requestId, visual = null, activity = null) {
  const identity = portrait ? await imageAsBase64(env, portrait) : null;
  const style = await imageAsBase64(env, visual);
  const moment = await imageAsBase64(env, activity);
  // The current activity is the source image to transform, not a weak style
  // reference. Keep identity/style as supporting inputs only when applicable.
  const primary = moment || identity;
  const supporting = [
    ...(moment && identity ? [identity] : []),
    ...(style ? [style] : []),
  ];
  const references = {
    ...(primary ? { imageBase64: primary.imageBase64, imageMimeType: primary.imageMimeType } : {}),
    ...(supporting.length ? { referenceImages: supporting.map((reference) => ({
      imageBase64: reference.imageBase64, imageMimeType: reference.imageMimeType,
    })) } : {}),
  };
  const response = await env.VETSA_INTELLIGENCE.fetch(new Request('https://vetsa.internal/v1/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.VETSA_INTELLIGENCE_API_KEY },
    body: JSON.stringify({ model: 'spaik-image', contents: prompt, options: { ...references, aspect_ratio: '9:16', requestId } }),
    signal: AbortSignal.timeout(360_000),
  }));
  if (response.status === 202) throw new Error('image_processing');
  const data = await response.json();
  if (!response.ok) {
    const code = /^[a-z0-9_-]{1,80}$/i.test(data?.code || '') ? `_${data.code}` : '';
    throw new Error(`spaik_image_http_${response.status}${code}`);
  }
  if (!data.imageBase64 || !['image/jpeg', 'image/png'].includes(data.mimeType)) throw new Error('spaik_image_invalid_result');
  const binaryResult = atob(data.imageBase64);
  if (binaryResult.length > 18_000_000) throw new Error('spaik_image_too_large');
  return { bytes: Uint8Array.from(binaryResult, (char) => char.charCodeAt(0)), mimeType: data.mimeType };
}

export async function classifyStoryTextRequest(env, request) {
  try {
    const response = await env.VETSA_INTELLIGENCE.fetch(new Request('https://vetsa.internal/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.VETSA_INTELLIGENCE_API_KEY },
      body: JSON.stringify({
        model: 'spaik-v1',
        contents: JSON.stringify({ request: String(request || '').slice(0, 1_400) }),
        options: {
          systemPrompt: 'Determina semánticamente si el propietario pide de forma explícita que haya palabras visibles DENTRO de la imagen. Una petición genérica como «crea una historia», hablar del tema, elegir estilo retro/anime, describir la escena o pedir una historia atractiva NO autoriza texto. Solo si pide explícitamente agregar/escribir/poner una frase, cita, título, pregunta, palabras o tipografía en la imagen, devuelve mode="compose" o "exact". Si proporciona las palabras exactas, usa mode="exact" y cópialas literalmente en text; si pide texto pero deja la frase a tu criterio, usa mode="compose" y text vacío. Ante cualquier duda devuelve mode="none". No confundas la respuesta/caption de WhatsApp con texto dentro de la imagen. Devuelve solo JSON: {"mode":"none|compose|exact","text":""}.',
          max_tokens: 140, temperature: 0, jsonMode: true,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    }));
    if (!response.ok) return { mode: 'none', text: '' };
    const data = await response.json().catch(() => ({}));
    const raw = data.text ?? data.response ?? data.result ?? '';
    const parsed = typeof raw === 'object' && raw ? raw : JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (parsed.mode === 'exact' && typeof parsed.text === 'string' && parsed.text.trim()) return { mode: 'exact', text: parsed.text.trim().slice(0, 240) };
    if (parsed.mode === 'compose') return { mode: 'compose', text: '' };
  } catch { /* Fail closed: no requested copy means no text in the generated image. */ }
  return { mode: 'none', text: '' };
}

export async function storyIncludesOwner(env, request) {
  if (!String(request || '').trim()) return false;
  try {
    const response = await env.VETSA_INTELLIGENCE.fetch(new Request('https://vetsa.internal/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.VETSA_INTELLIGENCE_API_KEY },
      body: JSON.stringify({
        model: 'spaik-v1',
        contents: JSON.stringify({ request: String(request).slice(0, 1_400) }),
        options: {
          systemPrompt: 'Clasifica semánticamente si el propietario solicita explícitamente aparecer él mismo en la imagen generada. Responde true solo si pide su propia presencia/rostro/cuerpo/retrato de forma inequívoca; una foto de actividad, escritorio, pantalla, mención de su trabajo o la existencia de un retrato guardado NO lo autorizan ni lo implican. Ante duda, false. Devuelve exclusivamente JSON: {"include_owner":true|false}.',
          max_tokens: 40, temperature: 0, jsonMode: true,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    }));
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    const raw = data.text ?? data.response ?? data.result ?? '';
    const parsed = typeof raw === 'object' && raw ? raw : JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    return parsed.include_owner === true;
  } catch {
    return false;
  }
}

export async function prepareSingleStory(env, phone, jobId, prompt, scheduledAt, sendMedia, activityReference = null, includeOwner = false, { privateDraft = false } = {}) {
  const existing = await env.VETSA_CLOUD.prepare('SELECT * FROM wa_story_single_drafts WHERE id=? AND owner_phone=?').bind(jobId, phone).first();
  if (existing?.preview_sent_at) return existing;
  const portrait = includeOwner
    ? await env.VETSA_CLOUD.prepare('SELECT object_key,mime_type FROM wa_story_portraits WHERE owner_phone=?').bind(phone).first()
    : null;
  if (includeOwner && (!portrait || !await storyPortraitExists(env, phone))) throw new Error('portrait_missing');
  if (activityReference) {
    const object = await env.VETSA_MEDIA.get(activityReference.objectKey);
    if (!object || object.size > 5_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(activityReference.mimeType)) throw new Error('activity_image_invalid');
  }
  const editorial = singleStoryEditorial(new Date(), env.TIME_ZONE || 'America/Santo_Domingo');
  const copyRequest = await classifyStoryTextRequest(env, prompt);
  const visual = await env.VETSA_CLOUD.prepare('SELECT object_key,mime_type,guidance FROM wa_story_visual_refs WHERE owner_phone=? AND active=1 ORDER BY created_at DESC LIMIT 1').bind(phone).first();
  const shot = editorial.stage.name === 'filtro' ? 'plano general o plano de establecimiento, que sitúe el lugar y el momento'
    : editorial.stage.name === 'contexto' ? 'plano medio natural, centrado en la actividad'
      : editorial.stage.name === 'valor' ? 'plano detalle de la herramienta o acción relevante' : 'plano medio con espacio negativo para el cierre';
  const currentActivity = activityReference ? 'La imagen base ES la foto real de actividad que envió Daniel. Transfórmala como una edición fiel, no como una recreación desde cero: conserva reconociblemente el mismo escritorio/escena, monitor y disposición de pantalla, objetos, perspectiva y acción. Puedes mejorar luz, color, textura analógica y encuadre vertical, pero no sustituyas el IDE/pantalla, inventes otro escritorio ni cambies lo que estaba haciendo. Mantén ilegible cualquier texto/código; conserva su estructura y bloques visuales.' : 'No se proporcionó una foto de actividad actual; no afirmes ni simules qué está haciendo Daniel ahora.';
  const personalStyle = 'Dirección visual: crea una imagen visualmente atractiva con una estética coherente que encaje con la escena. Puedes usar un tratamiento sutil de color, luz, grano fino o textura analógica; conserva naturalidad, legibilidad de la escena y buen gusto. Evita convertirla en un anuncio genérico o una pose de stock. No impongas un estilo anime, retro ni otro filtro si no se solicita: elige con moderación según el contexto.';
  const copyDirection = copyRequest.mode === 'exact'
    ? `El propietario pidió texto visible y dio esta frase exacta: «${copyRequest.text}». Incluye únicamente esas palabras, literalmente; no añadas ningún título, etiqueta, eslogan ni otra escritura.`
    : copyRequest.mode === 'compose'
      ? 'El propietario pidió explícitamente una frase visible: escribe una sola frase breve, natural y pertinente para la escena. No añadas título, categoría, explicación ni más texto.'
      : 'NO incluyas palabras, frases, títulos, etiquetas, letras decorativas ni tipografía añadida a la imagen. La petición de crear una historia por sí sola no pide texto. Evita también cualquier rótulo inventado; prioriza una imagen visualmente atractiva y limpia.';
  const identityConstraints = includeOwner
    ? 'El propietario pidió expresamente aparecer. Usa la foto de identidad como autoridad para su rostro y apariencia. Daniel no lleva aretes, pendientes, argollas, piercings ni joyas en las orejas: no añadas ninguno. Conserva únicamente su cadena y, si el oído es visible en la referencia, un solo AirPod blanco pequeño en la posición y forma de auricular; nunca lo conviertas en arete ni agregues accesorios. Si no puedes representar fielmente el oído o el auricular, ocúltalo con el ángulo/cabello en vez de inventar joyería.'
    : 'REGLA PRINCIPAL: Daniel no debe aparecer en esta imagen bajo ninguna forma (ni rostro, cuerpo, silueta, reflejo, pantalla o doble). No uses su retrato como referencia ni infieras que debe salir por recibir una foto suya o de lo que hace. Usa la foto actual solo como referencia de actividad, objetos y entorno; omite a cualquier persona que aparezca en esa foto. Solo cambia esta regla si el propietario pide explícitamente aparecer en la solicitud actual.';
  const image = existing?.object_key ? null : await vetsaImage(env,
    `Crea UNA historia vertical 9:16 con acabado editorial deliberado. ${personalStyle} ${identityConstraints} ${includeOwner ? 'Si aparece, conserva su identidad, suéter blanco, cadena y AirPod sin añadir joyería.' : ''} ${visual ? `Inspiración persistente de estilo/composición: ${String(visual.guidance || '').slice(0, 350)}; úsala solo para estética, no identidad.` : ''} ${currentActivity} Trata el texto/código de pantalla como contenido ilegible: no reveles claves, datos personales ni nombres de clientes. Usa ${shot} solo para decidir un recorte que preserve la escena; regla de tercios, líneas guía, espacio negativo y profundidad de campo natural, sin reemplazar ni reconstruir los objetos principales. En exterior o lugar público conserva el fondo; en interior suaviza solo el fondo si ayuda. No uses una plantilla genérica de marketing ni un escritorio/pantalla de stock. Tema editorial: ${editorial.theme}; fase ${editorial.stage.name}: ${editorial.stage.goal}. Audiencia: creación de contenido, edición de video, agentes y sistemas de IA. ${copyDirection} No inventes clientes, cifras, testimonios ni sucesos. No añadas stickers, encuestas, botones, logos ni marcas de agua. Solicitud del propietario: ${String(prompt).slice(0, 1400)}.`, portrait, jobId, visual, activityReference);
  const size = image ? storyImageDimensions(image.bytes, image.mimeType) : null;
  if (image && (!size || size.width < 500 || size.height < 850 || size.width / size.height < 0.48 || size.width / size.height > 0.68 || image.bytes.length > 8_000_000)) throw new Error('story_image_invalid');
  const objectKey = existing?.object_key || `melodi-private/stories/single/${jobId}`;
  if (image) await env.VETSA_MEDIA.put(objectKey, image.bytes, { httpMetadata: { contentType: image.mimeType } });
  const mimeType = existing?.mime_type || image.mimeType;
  const now = new Date().toISOString();
  await env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO wa_story_single_drafts
    (id,owner_phone,operation_id,object_key,mime_type,scheduled_at,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'ready',?,?)`).bind(jobId, phone, jobId, objectKey, mimeType,
      scheduledAt && Date.parse(scheduledAt) > Date.now() ? scheduledAt : now, now, now).run();
  if (privateDraft) return { id: jobId, status: 'prepared', objectKey, mimeType, autoPublish: false };
  const media = image || await env.VETSA_MEDIA.get(objectKey).then(async (object) => ({ bytes: new Uint8Array(await object.arrayBuffer()), mimeType }));
  await sendMedia(env, phone, 'image', media.bytes, mimeType, 'spaik-image-historia.png',
    'Vista previa de Spaik Image. Dime “publícala” para aprobarla. No se publicará sin tu aprobación, salvo que actives el modo automático.');
  await env.VETSA_CLOUD.prepare('UPDATE wa_story_single_drafts SET preview_sent_at=?,updated_at=? WHERE id=?').bind(new Date().toISOString(), new Date().toISOString(), jobId).run();
  return { id: jobId, scheduledAt: scheduledAt || now, autoPublish: await autoPublish(env, phone) };
}

async function instagramCommand(env, phone, action, operationId, media) {
  const response = await env.VETSA_INSTAGRAM_OPERATIONS.fetch(new Request('https://instagram.internal/internal/owner-command', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vetsa-internal-token': env.INSTAGRAM_INTERNAL_TOKEN },
    body: JSON.stringify({ ownerPhone: phone, action, operationId, media, text: 'Historia de la campaña semanal de Daniel Luna' }),
    signal: AbortSignal.timeout(20_000),
  }));
  if (!response.ok) throw new Error(`instagram_command_http_${response.status}`);
  return response.json();
}

function storyPrompt(slot, brief, visualGuidance = '', includeOwner = false) {
  const stage = STAGES.find((item) => item.name === slot.stage);
  const shot = slot.stage === 'filtro' ? 'plano general de establecimiento' : slot.stage === 'contexto' ? 'plano medio de una actividad' : slot.stage === 'valor' ? 'plano detalle de una herramienta' : 'plano medio equilibrado';
  const subjectRule = includeOwner
    ? 'El propietario pidió expresamente aparecer: conserva su identidad de la referencia privada, con suéter blanco y cadena; no añadas aretes, pendientes, argollas ni piercings y no conviertas el AirPod en joyería.'
    : 'Daniel y cualquier doble/representación de él deben estar ausentes. No uses ni recibes su retrato como referencia; la presencia de un retrato guardado o hablar de su trabajo no implica que quiera aparecer. Usa los objetos/entorno como tema visual y excluye a cualquier persona de las fotos de actividad.';
  return `${subjectRule} ${includeOwner ? 'Usa la foto de identidad solo porque pidió aparecer.' : ''} La referencia visual adicional solo inspira estilo/composición: ${String(visualGuidance).slice(0, 350)}. Estética preferida: instantánea editorial analógica de los 90, espontánea, con flash directo si es noche/interior, grano fino visible, leves imperfecciones ópticas y color cálido o verde-azulado elegido según la escena; no hagas un anuncio corporativo genérico ni una mezcla de filtros. Crea UNA historia vertical 9:16, fotográfica y natural; usa ${shot}, regla de tercios, líneas guía, planos separados y espacio negativo. En exteriores y lugares públicos conserva un fondo reconocible; en espacios interiores/cerrados suaviza el fondo y enfoca solo la acción/objeto clave cuando eso ayude. Daniel trabaja en creación de contenido, edición de video, agentes y sistemas de IA. Tema de hoy: ${THEMES[slot.day_index]}. Fase ${stage.name}: ${stage.goal}. Contexto del dueño: ${brief}. No reproduzcas texto o código legible de pantallas ni claves/datos personales. Para frases/citas, compón como portada de fotolibro editorial minimalista con serif elegante, contraste alto, líneas cortas y mucho espacio negativo; conserva literalmente cualquier cita suministrada. Evita títulos descriptivos, gerundios y jerga corporativa (por ejemplo «Diseñando sistemas de IA para creadores»): usa un gancho breve, humano e intrigante, no una etiqueta temática; si no resulta atractivo, deja el visual sin texto. Mantén cualquier frase completa dentro de márgenes seguros. No inventes cifras, clientes, testimonios ni acontecimientos. No representes a otras personas reales ni dibujes stickers, encuestas o botones falsos. Para el cierre, usa una llamada a escribir por DM.`;
}

export function storyImageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === 'image/jpeg') {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += length + 2;
    }
  }
  return null;
}

export async function runStoryCampaign(env, sendMedia = null) {
  if (!env.VETSA_INSTAGRAM_OPERATIONS || !env.INSTAGRAM_INTERNAL_TOKEN || !env.VETSA_INTELLIGENCE_API_KEY) return;
  const now = new Date().toISOString();
  const generationHorizon = new Date(Date.now() + 60 * 60_000).toISOString();
  const calendarFilter=await calendarScheduleExclusion(env.VETSA_CLOUD,{kind:'story_slot',ownerColumn:'s.owner_phone',idColumn:'s.id'});
  const candidate = await env.VETSA_CLOUD.prepare(`SELECT s.*,c.brief,COALESCE(p.auto_publish,0) AS auto_publish FROM wa_story_slots s JOIN wa_story_campaigns c ON c.id=s.campaign_id
    LEFT JOIN wa_story_publish_settings p ON p.owner_phone=s.owner_phone
    WHERE s.owner_phone=? AND c.status='active'${calendarFilter} AND ((s.status='pending' AND s.scheduled_at<=?) OR
      (s.status='ready' AND (s.preview_sent_at IS NULL OR (s.scheduled_at<=? AND (s.approved_at IS NOT NULL OR COALESCE(p.auto_publish,0)=1)))) OR
      (s.status='publishing' AND s.scheduled_at<=?))
    ORDER BY s.scheduled_at ASC LIMIT 1`).bind(String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),generationHorizon, now, now).first();
  if (!candidate) return;
  if (await calendarActivityPaused(env.VETSA_CLOUD,candidate.owner_phone,'story_slot',candidate.id)) return;
  const slot = { ...candidate };
  if (slot.status === 'pending') {
    const claim = await env.VETSA_CLOUD.prepare(`UPDATE wa_story_slots SET status='generating',updated_at=? WHERE id=? AND owner_phone=?
      AND status='pending' AND scheduled_at=? AND EXISTS(SELECT 1 FROM wa_story_campaigns WHERE id=wa_story_slots.campaign_id AND status='active')`)
      .bind(now,slot.id,slot.owner_phone,slot.scheduled_at).run();
    if (!claim.meta.changes) return;
    try {
      const includeOwner = await storyIncludesOwner(env, slot.brief);
      const portrait = includeOwner
        ? await env.VETSA_CLOUD.prepare('SELECT object_key,mime_type FROM wa_story_portraits WHERE owner_phone=?').bind(slot.owner_phone).first()
        : null;
      if (includeOwner && (!portrait || !await storyPortraitExists(env, slot.owner_phone))) throw new Error('portrait_missing');
      const visual = await env.VETSA_CLOUD.prepare('SELECT object_key,mime_type,guidance FROM wa_story_visual_refs WHERE owner_phone=? AND active=1 ORDER BY created_at DESC LIMIT 1').bind(slot.owner_phone).first();
      const image = await vetsaImage(env, storyPrompt(slot, slot.brief, visual?.guidance, includeOwner), portrait, slot.id, visual);
      const size = storyImageDimensions(image.bytes, image.mimeType);
      if (!size || size.width < 500 || size.height < 850 || size.width / size.height < 0.48 || size.width / size.height > 0.68 || image.bytes.length > 8_000_000) {
        throw new Error('story_image_not_vertical_or_too_large');
      }
      const key = `melodi-private/stories/${slot.campaign_id}/${slot.id}`;
      await env.VETSA_MEDIA.put(key, image.bytes, { httpMetadata: { contentType: image.mimeType } });
      const saved = await env.VETSA_CLOUD.prepare(`UPDATE wa_story_slots SET status='ready',object_key=?,mime_type=?,updated_at=?
        WHERE id=? AND owner_phone=? AND status='generating' AND scheduled_at=? AND updated_at=?
        AND EXISTS(SELECT 1 FROM wa_story_campaigns WHERE id=wa_story_slots.campaign_id AND status='active')`)
        .bind(key,image.mimeType,new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at,now).run();
      if (!saved.meta.changes) return;
      slot.status = 'ready'; slot.object_key = key; slot.mime_type = image.mimeType;
    } catch (error) {
      if (error?.message === 'image_processing') {
        await env.VETSA_CLOUD.prepare("UPDATE wa_story_slots SET status='pending',updated_at=? WHERE id=? AND owner_phone=? AND status='generating' AND scheduled_at=? AND updated_at=?")
          .bind(new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at,now).run();
        return;
      }
      await env.VETSA_CLOUD.prepare("UPDATE wa_story_slots SET status='needs_review',error_code=?,updated_at=? WHERE id=? AND owner_phone=? AND status='generating' AND scheduled_at=? AND updated_at=?")
        .bind(String(error?.message || error).slice(0,120),new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at,now).run();
      return;
    }
  }
  if (slot.status === 'ready' && !slot.preview_sent_at) {
    if (!sendMedia) return;
    const object = await env.VETSA_MEDIA.get(slot.object_key);
    if (!object) throw new Error('story_preview_missing');
    if (!await currentStorySchedule(env,slot)) return;
    await sendMedia(env, slot.owner_phone, 'image', new Uint8Array(await object.arrayBuffer()), slot.mime_type,
      'spaik-image-historia.png', `Vista previa de historia ${slot.stage}. ${slot.auto_publish ? 'La publicaré en el horario programado porque activaste el modo automático.' : 'Dime “publícala” para aprobarla; respetaré su horario programado.'}`);
    await env.VETSA_CLOUD.prepare('UPDATE wa_story_slots SET preview_sent_at=?,updated_at=? WHERE id=?')
      .bind(new Date().toISOString(), new Date().toISOString(), slot.id).run();
    slot.preview_sent_at = new Date().toISOString();
  }
  if (slot.status === 'ready' && !slot.approved_at && !slot.auto_publish) return;
  if (slot.scheduled_at > new Date().toISOString() || !['ready','publishing'].includes(slot.status)) return;
  try {
    if (!await currentStorySchedule(env,slot)) return;
    if (!slot.operation_id) {
      const result = await instagramCommand(env, slot.owner_phone, 'prepare_story', slot.id, { objectKey: slot.object_key, mimeType: slot.mime_type });
      const id = result.operation?.id;
      if (!id) throw new Error('instagram_operation_missing');
      const saved = await env.VETSA_CLOUD.prepare("UPDATE wa_story_slots SET status='publishing',operation_id=?,updated_at=? WHERE id=? AND owner_phone=? AND status='ready' AND scheduled_at=? AND COALESCE(error_code,'')<>'calendar_cancelled'")
        .bind(id,new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at).run();
      if (!saved.meta.changes) return;
      slot.operation_id = id;
    }
    const state = await instagramCommand(env, slot.owner_phone, 'operation_status', slot.operation_id);
    if (!await currentStorySchedule(env,slot)) return;
    if (state.operation?.status === 'completed') {
      await env.VETSA_CLOUD.prepare("UPDATE wa_story_slots SET status='published',updated_at=? WHERE id=? AND owner_phone=? AND status='publishing' AND scheduled_at=?").bind(new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at).run();
    } else if (state.operation?.status === 'draft') {
      await instagramCommand(env, slot.owner_phone, 'approve_operation', slot.operation_id);
    } else if (state.operation?.status === 'failed') {
      throw new Error('instagram_publish_failed');
    }
  } catch (error) {
    await env.VETSA_CLOUD.prepare("UPDATE wa_story_slots SET status='needs_review',error_code=?,updated_at=? WHERE id=? AND owner_phone=? AND status IN ('ready','publishing') AND scheduled_at=? AND COALESCE(error_code,'')<>'calendar_cancelled'")
      .bind(String(error?.message || error).slice(0,120),new Date().toISOString(),slot.id,slot.owner_phone,slot.scheduled_at).run();
  }
}

export async function runApprovedSingleStories(env) {
  const calendarFilter=await calendarScheduleExclusion(env.VETSA_CLOUD,{kind:'story_single',ownerColumn:'d.owner_phone',idColumn:'d.id'});
  const now = new Date().toISOString();
  const baseQuery = `SELECT d.*,COALESCE(p.auto_publish,0) AS auto_publish
    FROM wa_story_single_drafts d LEFT JOIN wa_story_publish_settings p ON p.owner_phone=d.owner_phone
    WHERE d.owner_phone=? AND d.status IN ('ready','publishing')${calendarFilter} AND d.preview_sent_at IS NOT NULL AND d.scheduled_at<=?
      AND (d.approved_at IS NOT NULL OR COALESCE(p.auto_publish,0)=1)
    ORDER BY d.scheduled_at ASC LIMIT 1`;
  let draft;
  if (env.TEAM_AUTONOMY_ENABLED !== 'true') draft = await env.VETSA_CLOUD.prepare(baseQuery).bind(String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),now).first();
  else {
    try {
      // Preparing a private story at level three does not grant the separate
      // level-five publishing authority. The owner may approve this exact
      // preview explicitly; existing manual story workflows stay unchanged.
      draft = await env.VETSA_CLOUD.prepare(`SELECT d.*,COALESCE(p.auto_publish,0) AS auto_publish
        FROM wa_story_single_drafts d
        LEFT JOIN wa_story_publish_settings p ON p.owner_phone=d.owner_phone
        LEFT JOIN wa_melodi_artifact_tracking a ON a.job_id=d.id AND a.owner=d.owner_phone AND a.job_type='generate_story'
        LEFT JOIN wa_melodi_levels l ON l.owner_phone=a.owner AND l.agent=a.agent
        WHERE d.owner_phone=? AND d.status IN ('ready','publishing')${calendarFilter} AND d.preview_sent_at IS NOT NULL AND d.scheduled_at<=?
          AND (d.approved_at IS NOT NULL OR (COALESCE(p.auto_publish,0)=1
            AND ((a.job_id IS NULL AND d.id NOT LIKE 'auto-%') OR l.level>=?)))
        ORDER BY d.scheduled_at ASC LIMIT 1`).bind(String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),now, permissionForTool('publish_social').minimumLevel).first();
    } catch (error) {
      const diagnostic = `${error?.message || error} ${error?.cause?.message || ''}`;
      if (!/no such table/i.test(diagnostic)) throw error;
      // During a partial migration, untracked autonomous IDs still fail
      // closed; ordinary manual drafts and explicit approvals keep working.
      draft = await env.VETSA_CLOUD.prepare(`SELECT d.*,COALESCE(p.auto_publish,0) AS auto_publish
        FROM wa_story_single_drafts d LEFT JOIN wa_story_publish_settings p ON p.owner_phone=d.owner_phone
        WHERE d.owner_phone=? AND d.status IN ('ready','publishing')${calendarFilter} AND d.preview_sent_at IS NOT NULL AND d.scheduled_at<=?
          AND (d.approved_at IS NOT NULL OR (COALESCE(p.auto_publish,0)=1 AND d.id NOT LIKE 'auto-%'))
        ORDER BY d.scheduled_at ASC LIMIT 1`).bind(String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),now).first();
    }
  }
  if (!draft) return;
  try {
    if (!await currentStorySchedule(env,draft,true)) return;
    let state = await instagramCommand(env, draft.owner_phone, 'operation_status', draft.operation_id);
    if (!state.operation) {
      const prepared = await instagramCommand(env, draft.owner_phone, 'prepare_story', draft.operation_id,
        { objectKey: draft.object_key, mimeType: draft.mime_type });
      if (prepared.operation?.id !== draft.operation_id) throw new Error('instagram_operation_missing');
      state = { operation: prepared.operation };
    }
    if (!await currentStorySchedule(env,draft,true)) return;
    if (state.operation?.status === 'draft') {
      if (draft.status === 'ready') {
        const claim = await env.VETSA_CLOUD.prepare("UPDATE wa_story_single_drafts SET status='publishing',updated_at=? WHERE id=? AND owner_phone=? AND status='ready' AND scheduled_at=? AND COALESCE(error_code,'')<>'calendar_cancelled'")
          .bind(new Date().toISOString(),draft.id,draft.owner_phone,draft.scheduled_at).run();
        if (!claim.meta.changes) return;
      }
      await instagramCommand(env, draft.owner_phone, 'approve_operation', draft.operation_id);
    } else if (state.operation?.status === 'completed') {
      await env.VETSA_CLOUD.prepare("UPDATE wa_story_single_drafts SET status='published',updated_at=? WHERE id=? AND owner_phone=? AND status IN ('ready','publishing') AND scheduled_at=? AND COALESCE(error_code,'')<>'calendar_cancelled'")
        .bind(new Date().toISOString(),draft.id,draft.owner_phone,draft.scheduled_at).run();
    } else if (state.operation?.status === 'failed' || !state.operation) throw new Error('instagram_publish_failed');
  } catch (error) {
    await env.VETSA_CLOUD.prepare("UPDATE wa_story_single_drafts SET status='needs_review',error_code=?,updated_at=? WHERE id=? AND owner_phone=? AND status IN ('ready','publishing') AND scheduled_at=? AND COALESCE(error_code,'')<>'calendar_cancelled'")
      .bind(String(error?.message || error).slice(0,120),new Date().toISOString(),draft.id,draft.owner_phone,draft.scheduled_at).run();
  }
}
