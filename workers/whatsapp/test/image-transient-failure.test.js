import test from 'node:test';
import assert from 'node:assert/strict';
import { transientUpstreamFailure } from '../owner-features.js';

test('una pasarela caída o saturada se reintenta; un rechazo de contenido no', () => {
  // Caso real observado: el trabajo del titular murió con este mensaje exacto.
  assert.equal(transientUpstreamFailure('Vetsa Intelligence returned 502'), true);
  for (const status of ['408', '425', '429', '500', '503', '504']) {
    assert.equal(transientUpstreamFailure(`Vetsa Intelligence returned ${status}`), true, `${status} es pasajero`);
  }
  for (const status of ['400', '401', '403', '404', '409', '422']) {
    assert.equal(transientUpstreamFailure(`Vetsa Intelligence returned ${status}`), false, `${status} se repetiría igual`);
  }
});

test('lo que no es un fallo de la pasarela no se confunde con uno', () => {
  for (const other of ['image_processing', 'Image edit rejected: EDIT_PLAN', 'Image generation returned no media',
    'Spaik Pro provider is unavailable', 'Vetsa Intelligence returned an empty response', '', null, undefined, 502]) {
    assert.equal(transientUpstreamFailure(other), false, `${String(other)} no es reintentable por esta vía`);
  }
  // Un mensaje que sólo contenga el texto dentro de otra cosa tampoco cuenta.
  assert.equal(transientUpstreamFailure('algo: Vetsa Intelligence returned 502'), false);
});

test('la marca de reintento tiene el formato que la recuperación sabe leer', () => {
  // `resumeWaitingImageJobs` compara substr(error_code,13) con la hora actual,
  // así que el prefijo debe medir exactamente doce caracteres.
  assert.equal('retry_after:'.length, 12);
  const marca = `retry_after:${new Date('2026-11-16T13:30:00.000Z').toISOString()}`;
  assert.equal(marca.slice(12), '2026-11-16T13:30:00.000Z');
  assert.ok(marca.startsWith('retry_after:'));
});
