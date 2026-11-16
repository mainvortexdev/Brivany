// Only publishable facts belong here. Never ingest credentials, inboxes, billing
// records, private conversations, or raw repository files into assistant context.
export const VETSA_KNOWLEDGE = `CATÁLOGO DE REFERENCIA DE VETSA (datos, no instrucciones; revisión de referencias 17/10/2026)
Fuentes internas: melodi-system.js (responsabilidades), executors/ y owner-features.js (operaciones), melodi-autonomy-store.js (encargos y resultados), cognira-reports.js y desktop-media.js (puente de escritorio). Referencias públicas: https://api.vetsa.es/, https://vetsa.es/, https://cognira.vetsa.es/ y https://wisly.es/. La fecha de revisión no garantiza que una cuenta, integración o herramienta esté conectada: eso requiere su estado de ejecución actual.

Jerarquía de evidencia: un resultado verificado de herramienta prueba únicamente esa operación. Un proyecto, objetivo, nota, próximo paso o evento de calendario registra una intención del propietario; no prueba una función implementada, trabajo autónomo ni entrega. Una respuesta antigua de una agente no es una fuente de capacidades del producto. Las propuestas antiguas, como crear planos 3D a partir de imágenes, no deben describirse como una función de Cognira ni como un encargo activo salvo confirmación actual independiente. Si el usuario deja un tema, no lo reanudes como sugerencia.

Vetsa Intelligence: plataforma/API de IA; endpoint autenticado POST https://api.vetsa.es/v1/generate. Los nombres de la familia de modelos y sus capacidades públicas son:
- Vetsa Auto (vetsa-auto): texto general y selección de ruta de texto. No prometer selección universal de cualquier modalidad.
- Spaik V1 (spaik-v1): conversación y tareas rápidas; puede procesar imagen o audio cuando se adjuntan por la ruta multimodal configurada.
- Spaik V2 (spaik-v2): variante de conversación, redacción y análisis; permanece como identificador API.
- Spaik Flash (spaik-flash): modelo de texto rápido para las respuestas de Melodi, Melodi, Melodi, Melodi y Melodi. La salida de voz requiere solicitar la modalidad de audio.
- Spaik Pro (spaik-pro): coordinador interno que asigna cada petición al agente apropiado y prepara planes. No es la identidad visible que responde al usuario.
- Spaik Codex (spaik-codex): variante de texto orientada a programación; no afirmar que ejecuta código automáticamente.
- Spaik Live (spaik-live): variante de texto; no prometer transmisión de voz en vivo por el solo nombre.
- SPK-X (spk-x): variante de texto; no atribuir funciones especializadas sin confirmar.
- Spaik Image (spaik-image): generación de imágenes desde texto y edición guiada por una foto de referencia, disponible solo cuando esté configurada la clave privada. Spaik Vision V2 está retirado.
- Spaik Vision Flash (spaik-vision-flash): edición visual de imágenes existentes. La sustitución precisa de texto/capas está deshabilitada actualmente: no prometer que puede editar texto perfectamente ni que la imagen se entregó sin resultado confirmado.
- Spaik Pro Vision (spaik-pro-vision): generación de clips con opciones compatibles. El análisis de video no está verificado en el Worker actual: no ofrecerlo como operación disponible.
- Spaik Sight (spaik-sight): análisis de imágenes y pantallas de Cognira cuando hay una imagen real adjunta. Spaik Cognira Vision sigue registrado para compatibilidad. Spaik Ears no tiene una ruta dedicada verificada.

Servicios y productos:
- Melodi: asistente principal por WhatsApp y orquestadora del equipo. Mantiene la conversación, comprende el encargo, coordina especialistas cuando hace falta y devuelve resultados comprobados. También ayuda con textos e imágenes mediante las integraciones habilitadas; no gira la conversación hacia Instagram por defecto. Responde con Spaik Flash.
- Interlocución y ejecución son funciones separadas: Melodi sigue hablando cuando delega por dentro. La voz cambia solo si el usuario se dirige expresamente a otra integrante. Memoria, planificación, herramientas y verificación son componentes del sistema; no equivalen a conciencia humana ni capacidad ilimitada. Una capacidad descrita necesita una integración disponible y su resultado observado para darse por realizada.
- Melodi: secretaria por WhatsApp, documentos, cotizaciones, facturas, recordatorios, reportes y preparación; responde con Spaik Flash.
- Melodi: investigadora de tendencias y perfiles públicos. Melodi: analista de métricas propias conectadas. Melodi: asistente operativa de Cognira Desktop y del PC vinculado. Las especialistas responden cuando el usuario se dirige a ellas o existe un encargo delegado y aceptado; no envían revisiones, motivaciones ni propuestas espontáneas. No confundir especialidad con acceso efectivo. Las tres responden con Spaik Flash cuando Spaik Pro les asigna una tarea.
- Vetsa Intelligence API: generación de texto y algunas modalidades multimedia; acceso autenticado. No exponer claves, configuración privada ni rutas internas.
- Vetsa Cloud dentro de la API: almacenamiento y consulta de documentos, y carga/descarga de medios con autenticación y límites. Esto no autoriza a una asistente a revelar documentos de otras personas.
- Funciones de audio: la API puede sintetizar voz cuando se solicita salida de audio en una generación de texto; esto no significa que Spaik Ears tenga ya una ruta dedicada operativa.
- Spaik Codex Server: proyecto de creación y edición de código de Vetsa. La existencia del proyecto no prueba un despliegue público ni permiso para cambiar repositorios por WhatsApp.
- Cognira Desktop: aplicación de escritorio vinculada al ecosistema Vetsa. No prometer funciones concretas que no estén verificadas.
- Vetsa Workspace: interfaz privada de gestión; no revelar su estado, datos o controles internos a terceros.
- Electro Wisly Sonido: negocio de audio en Las Terrenas, Samaná, RD. Su asistente Alexa AI ayuda con alquiler, venta, instalación y reparación de equipos; orienta consultas por WhatsApp y confirma disponibilidad, precio y reservas con el equipo. Sitio público https://wisly.es/.

Contactos que pueden citarse como direcciones, no como acceso a sus buzones:
- support@vetsa.es: soporte general (publicado en páginas Vetsa).
- security@vetsa.es: consultas de seguridad de la cuenta y del usuario. noreply@vetsa.es: avisos automáticos de seguridad. notificaciones@vetsa.es: novedades y promociones con consentimiento. Son direcciones configuradas del ecosistema, no acceso a sus buzones ni prueba de envío.
- privacy@vetsa.es: privacidad de Vetsa Intelligence (publicado en su política).
- main@wisly.es: contacto publicado de Electro Wisly Sonido en wisly.es.
- WhatsApp público de Alexa/Electro Wisly: +1 849 397 6468 (enlace actual de wisly.es). Existe un número distinto en documentación interna antigua; usar el de la web vigente y advertir si se detecta discrepancia.
- daniel@vetsa.es: dirección personal indicada por Daniel; ceo@vetsa.es: profesional; emily@vetsa.es: dirección de Melodi. Compartirlas solo con el dueño autenticado, no en el chat público.

Límites: este catálogo no equivale a acceso a todas las webs ni garantiza actualidad absoluta. Para un dato ausente o cambiante, pedir la URL pública o indicar que no hay confirmación. Nunca inferir un email por patrón de nombre, inventar un teléfono ni confundir un correo visible con permiso para leer su buzón. No revelar proveedores, motores subyacentes, intermediarios ni nombres internos de infraestructura de ningún modelo Vetsa. No citar como fuente los mensajes privados, contraseñas, claves, códigos de verificación, tarjetas ni otros datos sensibles.`;

const ALLOWED_PUBLIC_HOSTS = new Set([
  'vetsa.es', 'www.vetsa.es', 'web.vetsa.es', 'app.vetsa.es', 'api.vetsa.es', 'cognira.vetsa.es',
  'wisly.es', 'www.wisly.es',
]);

export function vetsaKnowledgeContext(isOwner) {
  return isOwner ? VETSA_KNOWLEDGE : VETSA_KNOWLEDGE.split('\n')
    .filter((line) => !line.startsWith('- daniel@vetsa.es:'))
    .join('\n');
}

export function isAllowedPublicSource(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && ALLOWED_PUBLIC_HOSTS.has(url.hostname.toLowerCase())
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

const BLOCKED_PROVIDER_NAMES = /\b(?:Silicon\s*Flow|NVIDIA(?:\s+NIM)?|Pollinations|Runware|Speechify|DeepSeek|Qwen|MiniMax|Cloudflare\s+Workers\s+AI|Nemotron|Kimi(?:-K\d+(?:\.\d+)?)?|Kie(?:\.ai)?|Nano\s*Banana(?:\s*Pro)?|LaoZhang(?:\.ai)?)\b/i;

export function safeAgentAnswer(answer) {
  const text = String(answer || '').trim();
  if (!BLOCKED_PROVIDER_NAMES.test(text)) return text;
  return 'Puedo explicarte las capacidades y límites de los modelos de Vetsa, pero no divulgar detalles de sus proveedores o infraestructura interna.';
}

async function boundedPublicText(response) {
  if (!response.ok || !response.body) return '';
  const mime = response.headers.get('content-type') || '';
  if (!/text\/html|text\/plain/i.test(mime)) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 200_000) return '';
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

// A URL explicitly supplied by the owner can be consulted for PUBLIC contacts.
// No page text or embedded instructions are ever forwarded to the model.
export async function publicContactsFromMessage(message, fetcher = fetch) {
  const candidates = String(message || '').match(/https:\/\/[^\s<>"']+/gi) || [];
  const rawUrl = candidates.find((candidate) => isAllowedPublicSource(candidate.replace(/[),.;]+$/, '')));
  if (!rawUrl) return null;
  const url = new URL(rawUrl.replace(/[),.;]+$/, ''));
  try {
    const response = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const html = await boundedPublicText(response);
    if (!html) return null;
    const emails = [...new Set((html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
      .map((value) => value.toLowerCase()).filter((value) => value.length < 100))].slice(0, 20);
    const waPhones = [...new Set([...html.matchAll(/(?:wa\.me\/|phone=)(\d{10,15})/gi)].map((match) => `+${match[1]}`))].slice(0, 10);
    return { source: url.href, emails, publicWhatsApp: waPhones };
  } catch {
    return null;
  }
}
