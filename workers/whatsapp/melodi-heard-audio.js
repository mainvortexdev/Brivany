// Melodi escucha las notas de voz que recibe.
//
// Una nota de voz sin texto no era nada para el turno: la transcripción sólo
// ocurría si el titular la pedía expresamente. Aquí el audio recibido se
// transcribe antes de decidir el turno, de modo que lo dicho entra como lo que
// él quiso decir y ella responde al contenido, no al hecho de haber recibido
// un audio. La transcripción es un dato de origen, nunca una instrucción con
// más autoridad que un mensaje escrito suyo.

export const HEARD_AUDIO_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, characters: 4_000 });

const bytesToBase64 = bytes => {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
};

const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** ¿Este mensaje entrante es una nota de voz sin texto escrito? */
export function isHeardAudio(message, incoming = '') {
  return message?.type === 'audio' && Boolean(message.audio?.id) && !String(incoming || '').trim();
}

/**
 * Transcribe el audio ya guardado y devuelve lo que se oyó.
 * Devuelve cadena vacía cuando no hay transcripción fiable: el turno sigue
 * entonces por su camino normal en lugar de inventar un contenido.
 */
export async function hearOwnerAudio(env, reference, { run } = {}) {
  const transcribe = run || (env?.AI && ((model, input) => env.AI.run(model, input)));
  if (typeof transcribe !== 'function' || !reference?.objectKey || !env?.VETSA_MEDIA?.get) return '';
  const object = await env.VETSA_MEDIA.get(reference.objectKey);
  if (!object) return '';
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (!bytes.length || bytes.length > HEARD_AUDIO_LIMITS.bytes) return '';
  const result = await transcribe('@cf/openai/whisper-large-v3-turbo', {
    audio: bytesToBase64(bytes),
    task: 'transcribe',
    language: 'es',
    vad_filter: true,
    initial_prompt: 'Transcribe fielmente en español. Conserva nombres propios, números y estructura.',
  });
  return clean(result?.text || result?.transcription_info?.text).slice(0, HEARD_AUDIO_LIMITS.characters);
}
