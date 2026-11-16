import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MELODI_VOICE as CALLS_VOICE } from '../../calls/protocol.js';
import { createOpusEncoder } from '../opus-encoder.js';
import { oggOpusFile, oggOpusSeconds, OPUS_FRAME_SAMPLES, OPUS_SAMPLE_RATE } from '../ogg-opus.js';
import {
  MELODI_WHATSAPP_VOICE, VOICE_NOTE_LIMITS, speakableText, voiceConfigured,
  encodeVoiceNote, synthesizeVoiceNote, sendVoiceNote,
} from '../melodi-voice-note.js';

const env = { BRIVANY_CARTESIA_API_KEY: 'private-voice-key-for-tests' };
const OPUS_MODULE = new WebAssembly.Module(readFileSync(new URL('../vendor/opus.wasm', import.meta.url)));

/** Voz sintética sin proveedor: una onda con envolvente, en PCM de 16 bits. */
function spokenPcm(seconds = 1.5) {
  const pcm = new Int16Array(Math.round(OPUS_SAMPLE_RATE * seconds));
  for (let at = 0; at < pcm.length; at++) {
    const time = at / OPUS_SAMPLE_RATE;
    pcm[at] = Math.round(8000 * Math.sin(2 * Math.PI * 180 * time) * Math.sin((Math.PI * time) / seconds));
  }
  return pcm;
}

/** Lector mínimo de Ogg: separa páginas y comprueba cada suma de control. */
function readOggPages(file) {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    table[index] = value >>> 0;
  }
  const crc = bytes => { let value = 0; for (const byte of bytes) value = ((value << 8) ^ table[((value >>> 24) ^ byte) & 0xff]) >>> 0; return value >>> 0; };

  const pages = [];
  let at = 0;
  while (at < file.length) {
    assert.deepEqual([...file.subarray(at, at + 4)], [0x4f, 0x67, 0x67, 0x53], `página ${pages.length} sin marca OggS`);
    const view = new DataView(file.buffer, file.byteOffset + at, file.length - at);
    const segments = file[at + 26];
    const sizes = [...file.subarray(at + 27, at + 27 + segments)];
    const payload = sizes.reduce((total, size) => total + size, 0);
    const length = 27 + segments + payload;
    const page = file.slice(at, at + length);
    const stated = new DataView(page.buffer).getUint32(22, true);
    new DataView(page.buffer).setUint32(22, 0, true);
    assert.equal(crc(page), stated, `suma de control inválida en la página ${pages.length}`);
    pages.push({ flags: file[at + 5], granule: view.getUint32(6, true), serial: view.getUint32(14, true),
      sequence: view.getUint32(18, true), sizes, body: file.slice(at + 27 + segments, at + length) });
    at += length;
  }
  return pages;
}

function provider({ ok = true, pcm } = {}) {
  const calls = [];
  const body = pcm ?? spokenPcm();
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (!ok) return new Response('no', { status: 402 });
      return new Response(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), { status: 200 });
    },
  };
}

test('la nota de voz usa exactamente la voz elegida de Melodi', () => {
  assert.equal(MELODI_WHATSAPP_VOICE.id, CALLS_VOICE.id);
  assert.equal(MELODI_WHATSAPP_VOICE.model, CALLS_VOICE.model);
  assert.equal(MELODI_WHATSAPP_VOICE.version, CALLS_VOICE.version);
  assert.equal(MELODI_WHATSAPP_VOICE.language, CALLS_VOICE.language);
});

test('el texto se prepara para oírse, no para leerse', () => {
  const spoken = speakableText('**Hola**\n- primero\n- segundo\n\nMira https://ejemplo.com/x ahora.');
  assert.ok(!/[*_`#]/.test(spoken), 'sin marcas de formato');
  assert.ok(!spoken.includes('https://'), 'sin enlaces leídos en voz alta');
  assert.match(spoken, /Hola\. primero\. segundo\. Mira el enlace que te envié ahora\./);
  assert.throws(() => speakableText('   '), /empty_voice_note/);
  assert.throws(() => speakableText('hola\u0007'), /invalid_voice_note/);
  assert.equal(speakableText('a'.repeat(5000)).length, 1200);
});

test('el archivo producido es un Ogg/Opus de un solo canal', () => {
  const { bytes, seconds } = encodeVoiceNote(OPUS_MODULE, spokenPcm(1.5));
  const pages = readOggPages(bytes);
  assert.ok(pages.length >= 3, 'cabecera, etiquetas y al menos una página de audio');

  // Primera página: OpusHead, marcada como comienzo del flujo.
  assert.equal(pages[0].flags & 2, 2);
  const head = pages[0].body;
  assert.equal(new TextDecoder().decode(head.subarray(0, 8)), 'OpusHead');
  assert.equal(head[8], 1, 'versión 1');
  assert.equal(head[9], 1, 'un solo canal');
  const headView = new DataView(head.buffer, head.byteOffset);
  assert.equal(headView.getUint16(10, true), 312, 'pre-salto del codificador');
  assert.equal(headView.getUint32(12, true), OPUS_SAMPLE_RATE);
  assert.equal(head[18], 0, 'familia de mapeo 0');
  assert.equal(pages[0].granule, 0);

  // Segunda página: OpusTags, sin comentarios de usuario.
  assert.equal(new TextDecoder().decode(pages[1].body.subarray(0, 8)), 'OpusTags');
  assert.equal(pages[1].granule, 0);

  // Última página: marcada como fin y con la posición granular completa.
  const last = pages.at(-1);
  assert.equal(last.flags & 4, 4, 'fin de flujo');
  assert.equal(last.granule, Math.round(seconds * OPUS_SAMPLE_RATE) + 312);
  assert.equal(new Set(pages.map(page => page.serial)).size, 1, 'un solo flujo');
  assert.deepEqual(pages.map(page => page.sequence), pages.map((_, index) => index));
  assert.ok(Math.abs(seconds - 1.5) < 0.03, `duración ${seconds}`);
});

test('un paquete que supera un tramo de lacing se parte y se vuelve a unir', () => {
  const long = new Uint8Array(600).fill(7);
  const short = new Uint8Array(10).fill(3);
  const file = oggOpusFile([long, short], { channels: 1, preSkip: 312 });
  const pages = readOggPages(file);
  const audio = pages.at(-1);
  assert.deepEqual(audio.sizes, [255, 255, 90, 10], 'tramos de 255 y resto');
  assert.equal(audio.body.length, 610);
  assert.throws(() => oggOpusFile([]), /ogg_without_packets/);
  assert.throws(() => oggOpusFile([short], { channels: 3 }), /ogg_invalid_channels/);
  assert.throws(() => oggOpusFile([short], { preSkip: -1 }), /ogg_invalid_preskip/);
  assert.throws(() => oggOpusFile(['no son bytes']), /ogg_invalid_packet/);
  assert.equal(oggOpusSeconds(Array(50).fill(short)), 1);
});

test('el codificador rechaza ajustes imposibles y libera su memoria', () => {
  assert.throws(() => createOpusEncoder(OPUS_MODULE, { channels: 3 }), /opus_invalid_channels/);
  assert.throws(() => createOpusEncoder(OPUS_MODULE, { sampleRate: 44_100 }), /opus_invalid_sample_rate/);
  assert.throws(() => createOpusEncoder(OPUS_MODULE, { bitrate: 10 }), /opus_invalid_bitrate/);
  assert.throws(() => createOpusEncoder(OPUS_MODULE, { application: 'musica' }), /opus_invalid_application/);
  assert.throws(() => createOpusEncoder({}), /opus_module_required/);
  const encoder = createOpusEncoder(OPUS_MODULE, { channels: 1 });
  assert.throws(() => encoder.encode(new Float32Array(OPUS_FRAME_SAMPLES)), /opus_invalid_frame/);
  encoder.release();
  encoder.release(); // Liberar dos veces no debe fallar.
  assert.throws(() => encoder.encode(new Int16Array(OPUS_FRAME_SAMPLES)), /opus_encoder_released/);
});

test('se pide sonido sin comprimir a 48 kHz y con su voz', async () => {
  const transport = provider();
  const result = await synthesizeVoiceNote(env, 'Buenas, ya revisé el informe.', { fetcher: transport.fetcher, opusModule: OPUS_MODULE });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].url, 'https://api.cartesia.ai/tts/bytes');
  assert.equal(transport.calls[0].options.redirect, 'manual');
  assert.equal(transport.calls[0].body.voice, MELODI_WHATSAPP_VOICE.id);
  assert.equal(transport.calls[0].body.language, 'es');
  assert.deepEqual(transport.calls[0].body.output_format, { container: 'raw', encoding: 'pcm_s16le', sample_rate: 48_000 });
  assert.equal(result.mimeType, 'audio/ogg');
  assert.equal(result.filename, 'melodi.ogg');
  assert.equal(result.voice, true);
  assert.equal(new TextDecoder().decode(result.bytes.subarray(0, 4)), 'OggS');
  assert.ok(result.bytes.length < VOICE_NOTE_LIMITS.fileBytes);
});

test('sin voz configurada o con ritmo fuera de rango no se sintetiza nada', async () => {
  await assert.rejects(() => synthesizeVoiceNote({}, 'hola', { fetcher: provider().fetcher, opusModule: OPUS_MODULE }), /voice_not_configured/);
  assert.equal(voiceConfigured({}), false);
  assert.equal(voiceConfigured(env), true);
  await assert.rejects(() => synthesizeVoiceNote(env, 'hola', { fetcher: provider().fetcher, opusModule: OPUS_MODULE, speed: 2 }), /invalid_voice_speed/);
});

test('un rechazo del proveedor o un audio vacío no se da por enviado', async () => {
  await assert.rejects(() => synthesizeVoiceNote(env, 'hola', { fetcher: provider({ ok: false }).fetcher, opusModule: OPUS_MODULE }), /voice_synthesis_rejected/);
  await assert.rejects(() => synthesizeVoiceNote(env, 'hola', { fetcher: provider({ pcm: new Int16Array(0) }).fetcher, opusModule: OPUS_MODULE }), /voice_synthesis_empty/);
  assert.throws(() => encodeVoiceNote(OPUS_MODULE, new Int16Array(0)), /empty_voice_audio/);
});

test('una nota demasiado larga se corta antes de ocupar memoria', async () => {
  const huge = new Int16Array(OPUS_SAMPLE_RATE * 130);
  await assert.rejects(() => synthesizeVoiceNote(env, 'hola', { fetcher: provider({ pcm: huge }).fetcher, opusModule: OPUS_MODULE }), /voice_note_too_long/);
});

test('se envía como nota de voz nativa y sólo se confirma con el recibo real', async () => {
  const transport = provider();
  const sends = [];
  const sent = await sendVoiceNote(env, '18095550101', 'Listo.', (_env, phone, kind, bytes, mimeType, filename, caption, options) => {
    sends.push({ phone, kind, mimeType, filename, caption, options, marca: new TextDecoder().decode(bytes.subarray(0, 4)) });
    return { status: 'sent', messageId: 'wamid.1' };
  }, { fetcher: transport.fetcher, opusModule: OPUS_MODULE });
  assert.deepEqual(sends, [{ phone: '18095550101', kind: 'audio', mimeType: 'audio/ogg', filename: 'melodi.ogg',
    caption: '', options: { voice: true }, marca: 'OggS' }]);
  assert.equal(sent.messageId, 'wamid.1');
  assert.ok(sent.seconds > 0);

  await assert.rejects(() => sendVoiceNote(env, '18095550101', 'Listo.', () => ({ status: 'accepted' }),
    { fetcher: provider().fetcher, opusModule: OPUS_MODULE }), /voice_note_unconfirmed/);
});
