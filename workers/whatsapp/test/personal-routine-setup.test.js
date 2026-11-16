import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture, OWNER } from './finance-fixture.js';
import { ensureRequestedPersonalRoutines } from '../personal-routine-setup.js';
import { createRoutineStore } from '../melodi-routines.js';

test('the authorized boxing and work schedules persist once with their distinct weekday sets', async () => {
  const h = await financeFixture();
  h.env.PERSONAL_ROUTINES_SETUP_REV = '2026-10-21.1';
  const options = { services: h.services, now: Date.parse('2026-10-21T10:00:00Z') };
  const saved = await ensureRequestedPersonalRoutines(h.env, options);
  assert.equal(saved.status, 'applied');
  const store = createRoutineStore(h.db, { ...h.services });
  const routines = await store.list(OWNER);
  assert.equal(routines.length, 3);
  assert.deepEqual(routines.find(item => /boxeo/.test(item.title)).weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(routines.find(item => /Alfredo/.test(item.title)).weekdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(routines.find(item => /Volver/.test(item.title)).hour, '15:40');
  assert.ok(routines.every(item => item.agent === 'melodi' && item.channel === 'whatsapp'));
  await store.cancel({ owner: OWNER, id: saved.routineIds[0] });
  assert.equal((await ensureRequestedPersonalRoutines(h.env, options)).status, 'already_applied');
  assert.equal((await store.list(OWNER)).find(item => item.id === saved.routineIds[0]).status, 'stopped');
  assert.equal((await store.list(OWNER)).length, 3);
});

test('unconfigured deployments do not create personal schedules', async () => {
  assert.equal((await ensureRequestedPersonalRoutines({})).status, 'disabled');
});
