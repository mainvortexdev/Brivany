import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceD1, OWNER, OTHER } from './finance-fixture.js';
import { readVoiceMode, setVoiceMode, needsWrittenCopy, voiceAwareReply, VOICE_MODES } from '../melodi-voice-mode.js';

const fixture = () => ({ VETSA_CLOUD: new FinanceD1() });

test('sin preferencia guardada responde por escrito', async () => {
  const env = fixture();
  assert.equal(await readVoiceMode(env, OWNER), 'text');
  assert.equal(await readVoiceMode({}, OWNER), 'text');
  assert.equal(await readVoiceMode(env, ''), 'text');
  assert.deepEqual([...VOICE_MODES], ['voice', 'text']);
});

test('la preferencia dura hasta que se cambia y es de cada titular', async () => {
  const env = fixture();
  assert.equal(await setVoiceMode(env, OWNER, 'voice'), 'voice');
  assert.equal(await readVoiceMode(env, OWNER), 'voice');
  // No caduca por sí sola: una segunda lectura devuelve lo mismo.
  assert.equal(await readVoiceMode(env, OWNER), 'voice');
  assert.equal(await readVoiceMode(env, OTHER), 'text', 'otro número no hereda la preferencia');
  assert.equal(await setVoiceMode(env, OWNER, 'text'), 'text');
  assert.equal(await readVoiceMode(env, OWNER), 'text');
  await assert.rejects(() => setVoiceMode(env, OWNER, 'cantando'), /invalid_voice_mode/);
  await assert.rejects(() => setVoiceMode(env, '', 'voice'), /invalid_voice_mode_owner/);
  await assert.rejects(() => setVoiceMode({}, OWNER, 'voice'), /voice_mode_storage_required/);
});

test('con el modo en voz la respuesta se dice en vez de escribirse', async () => {
  const env = fixture();
  await setVoiceMode(env, OWNER, 'voice');
  const written = [], spoken = [];
  const reply = voiceAwareReply({ env, phone: OWNER,
    sendText: body => { written.push(body); return { status: 'sent' }; },
    sendVoice: body => { spoken.push(body); return { status: 'sent', messageId: 'wamid.1' }; } });
  await reply('En Monseñor Nouel un sector es un barrio.');
  assert.deepEqual(spoken, ['En Monseñor Nouel un sector es un barrio.']);
  assert.deepEqual(written, []);
});

test('una respuesta con enlace o muy larga llega también escrita', async () => {
  const env = fixture();
  await setVoiceMode(env, OWNER, 'voice');
  const written = [], spoken = [];
  const reply = voiceAwareReply({ env, phone: OWNER,
    sendText: body => { written.push(body); return { status: 'sent' }; },
    sendVoice: body => { spoken.push(body); return { status: 'sent' }; } });
  await reply('Conecta tu cuenta aquí: https://ia.vetsa.es/oauth/gmail/start?link=abc');
  assert.equal(spoken.length, 1);
  assert.equal(written.length, 1, 'un enlace dicho en voz alta no se puede abrir');
  await reply('x'.repeat(1500));
  assert.equal(written.length, 2, 'un bloque largo se acompaña del texto');
  assert.equal(needsWrittenCopy('hola'), false);
  assert.equal(needsWrittenCopy('mira https://ejemplo.com'), true);
  assert.equal(needsWrittenCopy('y'.repeat(1300)), true);
});

test('si la voz falla la respuesta no se pierde: sale escrita', async () => {
  const env = fixture();
  await setVoiceMode(env, OWNER, 'voice');
  const written = [], fallbacks = [];
  const reply = voiceAwareReply({ env, phone: OWNER,
    sendText: body => { written.push(body); return { status: 'sent' }; },
    sendVoice: () => { throw Object.assign(Error('voice_synthesis_rejected'), { code: 'voice_synthesis_rejected' }); },
    onFallback: error => { fallbacks.push(error.code); } });
  await reply('Ya revisé el informe.');
  assert.deepEqual(written, ['Ya revisé el informe.']);
  assert.deepEqual(fallbacks, ['voice_synthesis_rejected']);

  // Un envío que no se confirma cuenta igual que un fallo.
  const second = [];
  const careful = voiceAwareReply({ env, phone: OWNER,
    sendText: body => { second.push(body); return { status: 'sent' }; },
    sendVoice: () => ({ status: 'accepted' }) });
  await careful('Listo.');
  assert.deepEqual(second, ['Listo.']);
});

test('una entrega marcada como escrita conserva su formato aunque el modo sea voz', async () => {
  const env = fixture();
  await setVoiceMode(env, OWNER, 'voice');
  const written = [], spoken = [];
  const reply = voiceAwareReply({ env, phone: OWNER,
    sendText: body => { written.push(body); return { status: 'sent' }; },
    sendVoice: body => { spoken.push(body); return { status: 'sent' }; } });
  await reply('Texto obligatorio', { written: true });
  assert.deepEqual(written, ['Texto obligatorio']);
  assert.deepEqual(spoken, []);
  await reply('   ');
  assert.equal(spoken.length, 0, 'una respuesta vacía no se sintetiza');
});

test('sin transporte de voz todo sigue saliendo por escrito', async () => {
  const env = fixture();
  await setVoiceMode(env, OWNER, 'voice');
  const written = [];
  const reply = voiceAwareReply({ env, phone: OWNER, sendText: body => { written.push(body); return { status: 'sent' }; } });
  await reply('Hola.');
  assert.deepEqual(written, ['Hola.']);
  assert.throws(() => voiceAwareReply({ env, phone: OWNER }), /voice_mode_transport_required/);
});
