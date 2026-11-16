import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ROUTINE_SCHEMA, createRoutineStore, nextWeeklyRoutineAt, nextRoutineAt, routineMatchesLocal } from '../melodi-routines.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(query) {
    const database = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      async run() { return database.execute(query, values); },
      async all() { return database.execute(query, values); },
      async first() { return database.execute(query, values).results[0] ?? null; } });
    return make([]);
  }
  execute(query, values) {
    const statement = this.sql.prepare(query);
    if (statement.columns().length) return { results: statement.all(...values).map(row => ({ ...row })),
      meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) } };
    return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const results = statements.map(item => this.execute(item.query, item.values)); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function harness(options = {}) {
  const database = new SqliteD1();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64')));
    },
  };
  let current = Date.parse('2026-10-08T13:00:00Z');
  let ids = 0;
  const store = createRoutineStore(database, { ...hooks, now: () => current, uuid: () => `routine-id-${++ids}`, ...options });
  await store.ensureSchema();
  return { store, database, hooks, get now() { return current; }, setNow(value) { current = Date.parse(value); }, advance(ms) { current += ms; } };
}

const input = { owner: 'owner-a', agent: 'melodi', eventKey: 'weekly-profile-request',
  title: 'Investigación semanal', brief: 'Observa publicaciones públicas y anota fechas, URLs y métricas visibles. No afirmes viralidad sin pruebas.',
  profile: 'https://instagram.com/example', channel: 'email' };
const finish = (store, claim, success, now) => store.complete({ owner: claim.owner, id: claim.id, leaseToken: claim.leaseToken, success, now });

test('SQL migration matches the runtime schema', async () => {
  const sql = readFileSync(new URL('../melodi-routines.sql', import.meta.url), 'utf8');
  assert.equal(sql.split('\n').slice(1).join('\n').trim(), `${ROUTINE_SCHEMA.join(';\n\n')};`);
  const { store } = await harness();
  await store.ensureSchema();
});

test('weekly scheduling uses Dominican date and never shifts to host or UTC date', () => {
  assert.equal(nextWeeklyRoutineAt('2026-10-09T03:50:00Z'), '2026-10-09T13:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-09T12:59:59Z'), '2026-10-09T13:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-09T13:00:00Z'), '2026-10-16T13:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-09T13:01:00Z', 0, '00:00'), '2026-10-11T04:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-09T13:01:00Z', 1, '22:30'), '2026-10-13T02:30:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-03-06T14:00:00Z'), '2026-03-13T13:00:00.000Z');
});

test('weekly weekday sets skip weekends and preserve the original single-day default',()=>{
  assert.equal(nextWeeklyRoutineAt('2026-10-23T13:00:00Z',[1,2,3,4,5],'09:00'),'2026-10-26T13:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-23T15:00:00Z',[1,2,3,4,5,6],'11:00'),'2026-10-24T15:00:00.000Z');
  assert.equal(nextWeeklyRoutineAt('2026-10-24T19:40:00Z',[1,2,3,4,5,6],'15:40'),'2026-10-26T19:40:00.000Z');
  assert.equal(nextRoutineAt({weekday:5,hour:'09:00'},{frequency:'weekly'},'2026-10-23T13:00:00Z'),'2026-10-30T13:00:00.000Z');
  assert.equal(routineMatchesLocal({weekday:1,hour:'09:00'},{frequency:'weekly',weekdays:[1,2,3,4,5]},'2026-10-23T09:00'),true);
  assert.equal(routineMatchesLocal({weekday:1,hour:'09:00'},{frequency:'weekly',weekdays:[1,2,3,4,5]},'2026-10-24T09:00'),false);
});

test('a weekday routine persists one encrypted series and advances to its next selected day after completion',async()=>{
  const h=await harness();h.setNow('2026-10-23T12:59:00Z');
  const request={...input,kind:'recurring_reminder',frequency:'weekly',weekdays:[5,1,4,2,3],weekday:1,hour:'09:00',title:'Entrenar boxeo'};
  const created=await h.store.create(request);assert.deepEqual(created.weekdays,[1,2,3,4,5]);assert.equal(created.nextAt,'2026-10-23T13:00:00.000Z');
  assert.equal((await h.store.create(request)).id,created.id);assert.equal((await h.store.list(input.owner)).length,1);
  h.setNow(created.nextAt);const [claim]=await h.store.claimDue({owner:input.owner});assert.deepEqual(claim.weekdays,[1,2,3,4,5]);
  assert.equal(await finish(h.store,claim,true,h.now),true);assert.equal((await h.store.list(input.owner))[0].nextAt,'2026-10-26T13:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(h.database.sql.prepare('SELECT * FROM wa_melodi_routines').get()),/Entrenar boxeo|weekdays/);
  await h.store.cancel({owner:input.owner,id:created.id});assert.equal((await h.store.create(request)).status,'stopped');
});

test('invalid weekday sets never write routines or silently convert monthly and daily schedules',async()=>{
  const h=await harness();
  for(const weekdays of [[],[1,1],[7],[-1],['1'],[1.5],null,'MO,TU']) await assert.rejects(h.store.create({...input,weekdays}));
  await assert.rejects(h.store.create({...input,weekday:0,weekdays:[1,2]}));
  await assert.rejects(h.store.create({...input,frequency:'monthly',kind:'recurring_reminder',dayOfMonth:7,weekdays:[1]}));
  await assert.rejects(h.store.create({...input,frequency:'daily',kind:'motivational_message',weekdays:[1]}));
  assert.equal((await h.store.list(input.owner)).length,0);
});

test('defaults Friday09RD and explicit weekday and time are retained', async () => {
  const { store } = await harness();
  const first = await store.create(input);
  assert.equal(first.weekday, 5); assert.equal(first.hour, '09:00');
  assert.equal(first.nextAt, '2026-10-09T13:00:00.000Z');
  assert.equal(first.timeZone, 'America/Santo_Domingo');
  const second = await store.create({ ...input, eventKey: 'explicit-schedule', weekday: 2, hour: '17:25', channel: 'whatsapp' });
  assert.equal(second.nextAt, '2026-10-13T21:25:00.000Z');
  assert.equal(second.channel, 'whatsapp');
});

test('routine profile, brief, title and original idempotency key remain encrypted', async () => {
  const { store, database } = await harness();
  const routine = await store.create(input);
  const raw = JSON.stringify(database.sql.prepare('SELECT * FROM wa_melodi_routines').all());
  for (const value of [input.title, input.brief, input.profile, input.eventKey]) assert.equal(raw.includes(value), false);
  assert.equal(routine.brief, input.brief);
  assert.equal(routine.profile, input.profile);
  assert.equal(routine.eventKey, input.eventKey);
});

test('private profile and brief are returned only for the assigned agent', async () => {
  const { store } = await harness();
  await store.create(input);
  assert.equal((await store.list('owner-a'))[0].brief, undefined);
  assert.equal((await store.list('owner-a'))[0].profile, undefined);
  assert.equal((await store.list('owner-a', 'melodi'))[0].brief, input.brief);
  assert.deepEqual(await store.list('owner-a', 'melodi'), []);
  assert.deepEqual(await store.list('other-owner', 'melodi'), []);
});

test('idempotent creates preserve the first assignment and stop status', async () => {
  const { store } = await harness();
  const first = await store.create(input);
  const repeated = await store.create({ ...input, brief: 'No overwriting', weekday: 3 });
  assert.equal(first.id, repeated.id);
  assert.equal(repeated.brief, input.brief);
  assert.equal(repeated.weekday, 5);
  await assert.rejects(store.create({ ...input, agent: 'melodi' }), /another agent/);
  await store.cancel({ owner: 'owner-a', id: first.id });
  assert.equal((await store.create(input)).status, 'stopped');
});

test('owner and agent scopes cannot claim or cancel another owner routine', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  assert.deepEqual(await context.store.claimDue({ owner: 'other-owner' }), []);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a', agent: 'melodi' }), []);
  assert.equal(await context.store.cancel({ owner: 'other-owner', id: routine.id }), 0);
  assert.equal(await context.store.cancel({ owner: 'owner-a', agent: 'melodi' }), 0);
  const [claimed] = await context.store.claimDue({ owner: 'owner-a', agent: 'melodi' });
  assert.equal(claimed.agent, 'melodi'); assert.equal(claimed.brief, input.brief);
});

test('a due routine is leased once across concurrent claims', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  context.setNow(routine.nextAt);
  const results = await Promise.all([context.store.claimDue({ owner: 'owner-a' }), context.store.claimDue({ owner: 'owner-a' })]);
  assert.equal(results.flat().length, 1);
  assert.equal(results.flat()[0].occurrenceAt, routine.nextAt);
  assert.equal(results.flat()[0].attempts, 1);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
});

test('successful completion follows wall-clock schedule rather than elapsed processing time', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  const [claimed] = await context.store.claimDue({ owner: 'owner-a' });
  context.advance(5 * 60000);
  assert.equal(await finish(context.store, claimed, true), true);
  const next = (await context.store.list('owner-a', 'melodi'))[0];
  assert.equal(next.nextAt, '2026-10-16T13:00:00.000Z');
  assert.equal(next.attempts, 0); assert.equal(next.lastOutcome, 'success');
  assert.equal(await finish(context.store, claimed, true), false);
});

test('bounded failure retries keep the occurrence runKey stable and then schedule next week', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  const [first] = await context.store.claimDue({ owner: 'owner-a' });
  assert.equal(await finish(context.store, first, false), true);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  context.advance(60000);
  const [second] = await context.store.claimDue({ owner: 'owner-a' });
  assert.equal(second.runKey, first.runKey); assert.equal(second.attempts, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
  await finish(context.store, second, false);
  context.advance(119999);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  context.advance(1);
  const [third] = await context.store.claimDue({ owner: 'owner-a' });
  assert.equal(third.runKey, first.runKey); assert.equal(third.attempts, 3);
  await finish(context.store, third, false);
  const next = (await context.store.list('owner-a', 'melodi'))[0];
  assert.equal(next.nextAt, '2026-10-16T13:00:00.000Z');
  assert.equal(next.lastOutcome, 'failed'); assert.equal(next.attempts, 0);
});

test('expired worker leases are reclaimed and stale completions are rejected', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  const [first] = await context.store.claimDue({ owner: 'owner-a' });
  context.advance(10 * 60000);
  assert.equal(await finish(context.store, first, true), false);
  const [second] = await context.store.claimDue({ owner: 'owner-a' });
  assert.equal(second.runKey, first.runKey); assert.equal(second.attempts, 2);
  assert.equal(await finish(context.store, first, true), false);
  assert.equal(await finish(context.store, second, true), true);
});

test('a crash on the third attempt cannot create unbounded retries', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  for (let i = 0; i < 3; i++) {
    const [claim] = await context.store.claimDue({ owner: 'owner-a' });
    assert.equal(claim.attempts, i + 1);
    context.advance(10 * 60000);
  }
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  assert.equal((await context.store.list('owner-a'))[0].nextAt, '2026-10-16T13:00:00.000Z');
});

test('stop immediately invalidates a lease and completion never reactivates it', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  const [claimed] = await context.store.claimDue({ owner: 'owner-a' });
  assert.equal(await context.store.cancel({ owner: 'owner-a', eventKey: input.eventKey }), 1);
  assert.equal(await finish(context.store, claimed, true), false);
  assert.equal(await finish(context.store, claimed, false), false);
  context.advance(4 * 7 * 86400000);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  assert.equal((await context.store.list('owner-a'))[0].status, 'stopped');
});

test('stop during payload decoding prevents a claim from reaching the runtime', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.setNow(routine.nextAt);
  const store = createRoutineStore(context.database, { ...context.hooks,
    now: () => context.now,
    async decrypt(...args) { await context.store.cancel({ owner: 'owner-a', id: routine.id }); return context.hooks.decrypt(...args); },
  });
  assert.deepEqual(await store.claimDue({ owner: 'owner-a' }), []);
});

test('cancellation supports one routine, assigned agent and the owner entire schedule', async () => {
  const { store } = await harness();
  await store.create(input);
  await store.create({ ...input, eventKey: 'melodi-task', agent: 'melodi' });
  await store.create({ ...input, eventKey: 'other-task' });
  await store.create({ ...input, owner: 'owner-b' });
  assert.equal(await store.cancel({ owner: 'owner-a', eventKey: input.eventKey }), 1);
  assert.equal(await store.cancel({ owner: 'owner-a', agent: 'melodi' }), 1);
  assert.equal(await store.cancel({ owner: 'owner-a' }), 1);
  assert.equal(await store.cancel({ owner: 'owner-a' }), 0);
  assert.equal((await store.list('owner-b'))[0].status, 'active');
});

test('limits preserve the earliest due routines and agent separation', async () => {
  const context = await harness();
  await context.store.create(input);
  await context.store.create({ ...input, eventKey: 'second', hour: '10:00' });
  context.setNow('2026-10-09T15:00:00Z');
  const first = await context.store.claimDue({ owner: 'owner-a', limit: 1 });
  assert.equal(first.length, 1); assert.equal(first[0].hour, '09:00');
  const second = await context.store.claimDue({ owner: 'owner-a', limit: 1 });
  assert.equal(second.length, 1); assert.equal(second[0].hour, '10:00');
});

test('corrupt ciphertext fails closed with bounded retries', async () => {
  const context = await harness();
  const routine = await context.store.create(input);
  context.database.sql.prepare('UPDATE wa_melodi_routines SET payload_encrypted=? WHERE id=?').run('broken', routine.id);
  context.setNow(routine.nextAt);
  assert.deepEqual(await context.store.claimDue({ owner: 'owner-a' }), []);
  const raw = context.database.sql.prepare('SELECT * FROM wa_melodi_routines').get();
  assert.equal(raw.attempts, 1); assert.equal(raw.last_outcome, 'retry');
  assert.equal(raw.lease_token, null);
});

test('invalid schedules, channels, owners and encryption hooks fail before storing content', async () => {
  const context = await harness();
  for (const changes of [{ owner: '' }, { agent: 'melodi' }, { weekday: 7 }, { weekday: '5' },
    { hour: '9:00' }, { hour: '24:00' }, { channel: 'sms' }, { eventKey: '' }, { title: '' }]) {
    await assert.rejects(context.store.create({ ...input, ...changes }));
  }
  assert.equal((await context.store.list('owner-a')).length, 0);
  assert.throws(() => createRoutineStore(context.database), /encryption hooks/);
  const failed = createRoutineStore(context.database, { ...context.hooks, encrypt: async () => ({}) });
  await assert.rejects(failed.create(input), /encryption failed/);
  assert.equal((await context.store.list('owner-a')).length, 0);
  await assert.rejects(context.store.claimDue({ owner: 'owner-a', limit: 0 }));
  await assert.rejects(context.store.cancel({}));
  assert.throws(() => nextWeeklyRoutineAt('invalid'), /timestamp/);
});

test('daily messages persist encrypted, claim once per local day and remain cancelled after retrying creation',async()=>{
  const h=await harness(),request={...input,agent:'melodi',kind:'motivational_message',frequency:'daily',eventKey:'daily-request',hour:'10:00',profile:''};
  const routine=await h.store.create(request);assert.equal(routine.nextAt,'2026-10-08T14:00:00.000Z');assert.equal(routine.frequency,'daily');
  assert.equal(JSON.stringify(h.database.sql.prepare('SELECT * FROM wa_melodi_routines').get()).includes(request.brief),false);
  h.setNow(routine.nextAt);const [claim]=await h.store.claimDue({owner:input.owner});assert.equal(claim.agent,'melodi');assert.deepEqual(await h.store.claimDue({owner:input.owner}),[]);
  assert.equal(await finish(h.store,claim,true,h.now),true);assert.equal((await h.store.list(input.owner))[0].nextAt,'2026-10-09T14:00:00.000Z');
  await h.store.cancel({owner:input.owner,id:routine.id});assert.equal((await h.store.create(request)).status,'stopped');
  h.setNow('2026-10-09T14:00:00Z');assert.deepEqual(await h.store.claimDue({owner:input.owner}),[]);
});
