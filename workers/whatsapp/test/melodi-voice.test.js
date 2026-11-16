import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalAgentMessage } from '../melodi-voice.js';

test('outgoing messages omit agent labels, including formatted model labels', () => {
  for (const label of ['Melodi:', 'melodi:', '**Melodi:**', '**Melodi**:', '*Melodi:*']) {
    assert.equal(naturalAgentMessage(`  ${label} Vale, te aviso mañana.  `), 'Vale, te aviso mañana.');
  }
});

test('voice cleanup preserves quoted messages, document headings and names in content', () => {
  const messages = [
    '«Melodi: ya lo envié» fue el mensaje anterior.',
    '"Melodi: revisa el documento"',
    '> Melodi: estos son los resultados.',
    'Melodi preparó el texto; Helibert enviará el documento.',
    'Documento de Helibert:\nEmily: contacto del proyecto.',
    'Daniel: recuerda imprimirlo.',
  ];
  for (const message of messages) assert.equal(naturalAgentMessage(message), message);
  assert.equal(naturalAgentMessage('Melodi: El texto dice «Melodi: revisa esto».') , 'El texto dice «Melodi: revisa esto».');
});

test('repeated plain or formatted transport labels are removed before an actual quoted message', () => {
  assert.equal(naturalAgentMessage('Melodi: Melodi: Vale, te aviso mañana.'), 'Vale, te aviso mañana.');
  assert.equal(naturalAgentMessage('**Melodi:** Melodi: **Melodi**: «Melodi: texto citado».') , '«Melodi: texto citado».');
  const message = naturalAgentMessage('Melodi: **Melodi:** Vale.');
  assert.equal(naturalAgentMessage(message), message);
});

test('voice cleanup is idempotent for an ordinary message and handles absent content', () => {
  assert.equal(naturalAgentMessage(naturalAgentMessage('Melodi: Vale, te aviso.')), 'Vale, te aviso.');
  assert.equal(naturalAgentMessage(undefined), '');
});
