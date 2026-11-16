import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceD1, OWNER, OTHER } from './finance-fixture.js';
import { messageAuthor, recordOwnerMessageReference, resolveOwnerReplyContext, OWNER_AUTHOR } from '../owner-reply-context.js';
import { ownerTurnSystemPrompt, planOwnerConversationTurn } from '../owner-turn-planner.js';
import { ownerActionResponseContext, renderOwnerActionResponse } from '../owner-turn-response.js';

const AT = '2026-11-16T03:50:00Z';
const crypt = {
  encrypt: async value => ({ encrypted: Buffer.from(JSON.stringify(value)).toString('base64'), iv: 'iv' }),
  decrypt: async encrypted => Buffer.from(encrypted, 'base64').toString('utf8'),
};
const envFor = () => ({ VETSA_CLOUD: new FinanceD1(), OWNER_WHATSAPP_NUMBER: OWNER });

test('el titular puede citar su propio mensaje, no sólo los de Melodi', async () => {
  const env = envFor();
  assert.equal(messageAuthor('Lo que sea', OWNER_AUTHOR), OWNER_AUTHOR);

  const mine = await recordOwnerMessageReference(env, { phone: OWNER, messageId: 'wamid.mine',
    body: 'Acuérdate de la cotización de Falcondo para Ramírez.', agent: OWNER_AUTHOR, encrypt: crypt.encrypt });
  assert.equal(mine.status, 'recorded');
  assert.equal(mine.agent, OWNER_AUTHOR);

  const quoted = await resolveOwnerReplyContext(env, OWNER, { context: { id: 'wamid.mine' } }, { decrypt: crypt.decrypt });
  assert.equal(quoted.status, 'resolved');
  assert.equal(quoted.agent, OWNER_AUTHOR);
  assert.match(quoted.body, /cotización de Falcondo/);
});

test('las citas de Melodi siguen funcionando y no se mezclan los autores', async () => {
  const env = envFor();
  await recordOwnerMessageReference(env, { phone: OWNER, messageId: 'wamid.hers',
    body: 'Monseñor Nouel tiene su economía centrada en la minería.', agent: 'melodi', encrypt: crypt.encrypt });
  const hers = await resolveOwnerReplyContext(env, OWNER, { context: { id: 'wamid.hers' } }, { decrypt: crypt.decrypt });
  assert.equal(hers.agent, 'melodi');

  // Un número que no es el titular no guarda ni resuelve referencias suyas.
  const other = await recordOwnerMessageReference(env, { phone: OTHER, messageId: 'wamid.other',
    body: 'hola', agent: OWNER_AUTHOR, encrypt: crypt.encrypt });
  assert.equal(other.status, 'not_owner');
  const missing = await resolveOwnerReplyContext(env, OWNER, { context: { id: 'wamid.desconocido' } }, { decrypt: crypt.decrypt });
  assert.equal(missing.status, 'unavailable');
});

test('la cita llega al planificador con su autor para no confundir quién lo dijo', async () => {
  const captured = [];
  const infer = request => { captured.push(JSON.parse(request.contents)); return JSON.stringify({ version: 1, route: 'reply', agent: 'melodi',
    contextRelation: 'quoted_reply', answer: 'Un sector es un barrio.', actions: [] }); };

  for (const [agent, author] of [[OWNER_AUTHOR, 'titular'], ['melodi', 'Melodi']]) {
    await planOwnerConversationTurn({ OWNER_TURN_MODEL: 'spaik-flash' }, {
      phone: OWNER, message: { id: 'm1', text: '¿Puedes decirme esto con tu voz?' }, referenceAt: AT, recent: [],
      quotedMessage: { status: 'resolved', agent, body: 'Un sector es un barrio dentro de un municipio.', messageId: 'wamid.q', sentAt: AT },
    }, { infer, catalog: [] });
  }
  assert.equal(captured[0].quotedMessage.author, 'titular');
  assert.equal(captured[0].quoteStatus, 'resolved');
  assert.equal(captured[1].quotedMessage.author, 'Melodi');
  assert.match(ownerTurnSystemPrompt('melodi', {}), /quotedMessage\.author dice si lo dijo Melodi o el titular/);
});

test('tras una nota de voz no se envía además un texto', async () => {
  const input = { message: { id: 'm1', text: 'Dímelo con tu voz' },
    plan: { agent: 'melodi', actions: [{ id: 'a1', tool: 'message.voice_note', input: { text: 'Un sector es un barrio.' }, dependsOn: [] }] },
    outcome: { status: 'committed', results: [{ id: 'a1', tool: 'message.voice_note', state: 'committed',
      data: { spoken: true, characters: 24 }, receipt: { tool: 'message.voice_note', status: 'sent', operationId: 'wamid.1', verified: true } }] },
    recent: [], referenceAt: AT, timeZone: 'America/Santo_Domingo' };
  const answer = await renderOwnerActionResponse({}, input, { infer: async () => { throw new Error('no hace falta'); } });
  assert.equal(answer, '', 'la voz ya entregó la respuesta');
  assert.equal(ownerActionResponseContext(input).results[0].state, 'committed', 'y sigue contando como entregada');
});

test('si además de la voz hay algo que decir, ese texto sí sale', async () => {
  const input = { message: { id: 'm1', text: 'Dímelo con tu voz y guárdalo' },
    plan: { agent: 'melodi', actions: [
      { id: 'a1', tool: 'message.voice_note', input: { text: 'Listo.' }, dependsOn: [] },
      { id: 'a2', tool: 'memory.save', input: { text: 'nota' }, dependsOn: [] }] },
    outcome: { status: 'committed', results: [
      { id: 'a1', tool: 'message.voice_note', state: 'committed', data: { spoken: true }, receipt: { tool: 'message.voice_note', status: 'sent', operationId: 'w1', verified: true } },
      { id: 'a2', tool: 'memory.save', state: 'committed', data: {}, receipt: { tool: 'memory.save', status: 'persisted', operationId: 'w2', verified: true } }] },
    recent: [], referenceAt: AT, timeZone: 'America/Santo_Domingo' };
  assert.equal(await renderOwnerActionResponse({}, input), 'Guardé la nota.');
});

test('un fallo junto a la voz no se queda en silencio', async () => {
  const input = { message: { id: 'm1', text: 'Dímelo con tu voz y manda el correo' },
    plan: { agent: 'melodi', actions: [
      { id: 'a1', tool: 'message.voice_note', input: { text: 'Listo.' }, dependsOn: [] },
      { id: 'a2', tool: 'gmail.send', input: { to: 'a@b.com', subject: 's', body: 'b' }, dependsOn: [] }] },
    outcome: { status: 'partial', results: [
      { id: 'a1', tool: 'message.voice_note', state: 'committed', data: { spoken: true }, receipt: { tool: 'message.voice_note', status: 'sent', operationId: 'w1', verified: true } },
      { id: 'a2', tool: 'gmail.send', state: 'failed', error: 'provider_rejected' }] },
    recent: [], referenceAt: AT, timeZone: 'America/Santo_Domingo' };
  assert.match(await renderOwnerActionResponse({}, input), /No pude enviar el correo/);
});
