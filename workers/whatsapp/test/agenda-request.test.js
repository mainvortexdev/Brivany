import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAgendaRequest, parseAgendaRequest, interpretAgendaRequest, validateAgendaRequest, buildAgendaPlan, resolveAgendaContinuation } from '../agenda-request.js';
import { agendaDayMoves, flexibleAgendaTask } from '../agenda-scheduling.js';
import { agendaPlanConfirmation } from '../agenda-plan-reply.js';

const EXAMPLE = 'Oye Melodi, agenda lo siguiente, ponlo en días separados para trabajar en ello: Terminar toda la app de Vetsa Intelligence, Terminar Cognira Edits, Mejorar la integración y entorno de Vetsa. Desplaza lo que tengo para hoy a mañana, quiero tener el día un poco más suave, iré al boxeo a las 9, a las 11 iré a trabajar al apartamento de Alfredo, recuérdame a las 2:40 p.m buscar a mi hermana a la escuela y que tengo que volver a las 3:40 pm al trabajo .';
const OPTIONS = { now: '2026-10-21T11:00:00.000Z', timeZone: 'America/La_Paz' }; // 07:00 local

test('the complete compound owner example is parsed without a model and retains each distinct requested action', async () => {
  let calls = 0;
  const directive = await interpretAgendaRequest({}, EXAMPLE, { ...OPTIONS, generate() { calls++; throw Error('not needed'); } });
  assert.ok(detectAgendaRequest(EXAMPLE)); assert.equal(calls, 0);
  assert.deepEqual(directive.actions.distribute, ['Terminar toda la app de Vetsa Intelligence', 'Terminar Cognira Edits', 'Mejorar la integración y entorno de Vetsa']);
  assert.deepEqual(directive.actions.moveDay, { from: 'today', to: 'tomorrow' });
  assert.deepEqual(directive.actions.fixed.map(item => [item.title, item.localTime]), [
    ['Boxeo', '09:00'], ['Trabajar en apartamento de Alfredo', '11:00'], ['Buscar a mi hermana a la escuela', '14:40'], ['Volver al trabajo', '15:40'],
  ]);
  assert.equal(directive.relaxToday, true); assert.equal(directive.referenceAt, OPTIONS.now);
  assert.doesNotMatch(JSON.stringify(directive), /desktop_action|completed|execute|duration/);
});

test('the pure plan keeps new fixed commitments today, moves existing today to tomorrow, and spreads projects after tomorrow', () => {
  const directive = parseAgendaRequest(EXAMPLE, OPTIONS), before = structuredClone(directive);
  const snapshot = [{ id: 'old-today', title: 'Pendiente anterior', eventAt: '2026-10-21T14:00:00.000Z' }];
  const snapshotBefore = structuredClone(snapshot);
  const plan = buildAgendaPlan(directive, { snapshot });
  assert.equal(plan.executable, true); assert.equal(plan.clarification, '');
  assert.deepEqual(plan.moveDay, { fromDate: '2026-10-21', toDate: '2026-10-22', onlyCalendarEvents: true, resolveWorkConflicts: true });
  assert.deepEqual(plan.createEvents.filter(item => item.kind === 'fixed').map(item => item.localDateTime),
    ['2026-10-21T09:00', '2026-10-21T11:00', '2026-10-21T14:40', '2026-10-21T15:40']);
  assert.equal(plan.createEvents[0].eventAt, '2026-10-21T13:00:00.000Z');
  assert.deepEqual(plan.createEvents.filter(item => item.kind === 'project_work').map(item => item.localDateTime),
    ['2026-10-23T09:00', '2026-10-24T09:00', '2026-10-25T09:00']);
  assert.match(plan.assumptions.join(' '), /mañana.*9:00 a\. m\.|9:00 a\. m\./);
  assert.deepEqual(directive, before); assert.deepEqual(snapshot, snapshotBefore);
});

test('passed morning commitments ask once and produce no partial writes or silent evening substitutions', () => {
  for (const now of ['2026-10-21T13:00:00.000Z', '2026-10-21T20:00:00.000Z']) {
    const plan = buildAgendaPlan(parseAgendaRequest(EXAMPLE, { ...OPTIONS, now }));
    assert.equal(plan.executable, false); assert.deepEqual(plan.createEvents, []); assert.equal(plan.moveDay, null);
    assert.match(plan.clarification, /Boxeo.*ya pasó hoy/); assert.equal((plan.clarification.match(/¿/g) || []).length, 1);
    assert.doesNotMatch(JSON.stringify(plan), /21:00|23:00/);
  }
});

test('local receipt day, rather than processing time or the machine zone, anchors move and all dates', () => {
  const original = { now: '2026-10-22T00:30:00.000Z', timeZone: 'Asia/Tokyo' }; // 09:30 there: fixed 09 already passed
  const directive = parseAgendaRequest(EXAMPLE, original);
  const plan = buildAgendaPlan(directive, { now: '2026-10-30T11:00:00.000Z' });
  assert.equal(plan.referenceAt, original.now); assert.equal(plan.executable, false);
  const early = parseAgendaRequest(EXAMPLE, { now: '2026-10-21T21:30:00.000Z', timeZone: 'Asia/Tokyo' });
  const tokyo = buildAgendaPlan(early);
  assert.deepEqual(tokyo.moveDay, { fromDate: '2026-10-22', toDate: '2026-10-23', onlyCalendarEvents: true, resolveWorkConflicts: true });
  assert.equal(tokyo.createEvents[0].eventAt, '2026-10-22T00:00:00.000Z');
});

test('work sessions choose available proposed instants and keep different days without inventing durations', () => {
  const snapshot = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'].map(hour =>
    ({ title: 'Ocupado', eventAt: `2026-10-23T${String(Number(hour.slice(0, 2)) + 4).padStart(2, '0')}:00:00.000Z` }));
  snapshot.push({ title: 'Otro compromiso', eventAt: '2026-10-24T13:00:00.000Z' });
  const plan = buildAgendaPlan(parseAgendaRequest(EXAMPLE, OPTIONS), { snapshot });
  const projects = plan.createEvents.filter(item => item.kind === 'project_work');
  assert.deepEqual(projects.map(item => item.localDateTime), ['2026-10-24T10:00', '2026-10-25T09:00', '2026-10-26T09:00']);
  assert.ok(projects.every(item => !('duration' in item) && !('endAt' in item)));
});

test('fixed-time collisions are clarified before any move or insertion', () => {
  const plan = buildAgendaPlan(parseAgendaRequest(EXAMPLE, OPTIONS), { snapshot: [
    { title: 'Médico', eventAt: '2026-10-21T13:00:00.000Z' }, // moved away first: should not collide
    { title: 'Mañana', eventAt: '2026-10-22T13:00:00.000Z' },
  ] });
  assert.equal(plan.executable, true);
  const directive = parseAgendaRequest(EXAMPLE, OPTIONS);
  directive.actions.moveDay = null;
  const conflict = buildAgendaPlan(directive, { snapshot: [{ title: 'Médico', eventAt: '2026-10-21T13:00:00.000Z' }] });
  assert.equal(conflict.executable, false); assert.deepEqual(conflict.createEvents, []); assert.match(conflict.clarification, /coinciden/);
});

test('only the exact same routine title and instant can satisfy an existing fixed appointment',()=>{
  const directive=parseAgendaRequest(EXAMPLE,OPTIONS);
  directive.actions.moveDay.onlyCalendarEvents=true;
  const snapshot=[{id:'boxing-occurrence',kind:'agent_routine',title:'Ir al boxeo',eventAt:'2026-10-21T13:00:00.000Z'}];
  const reused=buildAgendaPlan(directive,{snapshot});
  assert.equal(reused.executable,true);assert.equal(reused.createEvents.length,6);
  assert.deepEqual(reused.retainedFixed,[{id:'boxing-occurrence',kind:'agent_routine',title:'Boxeo',eventAt:'2026-10-21T13:00:00.000Z'}]);
  for(const changed of [{title:'Boxeo con Alfredo'},{kind:'melodi_calendar_events',movable:true},{eventAt:'2026-10-21T13:01:00.000Z'}]){
    const other=buildAgendaPlan(directive,{snapshot:[{...snapshot[0],...changed}]});
    assert.equal(other.retainedFixed?.length || 0,0,JSON.stringify(changed));
    if(changed.eventAt || changed.kind)assert.equal(other.createEvents.length,7);
    else assert.equal(other.executable,false);
  }
});

test('quoted, hypothetical, negated and capability examples never reach the semantic model or a writable plan', async () => {
  const messages = [
    `Por ejemplo, "${EXAMPLE}"`, `Si te digo ${EXAMPLE}`, `Imagina que te pido: ${EXAMPLE}`, `Supongamos: ${EXAMPLE}`,
    `Solo explica cómo responderías: ${EXAMPLE}`, `No ejecutes nada. ${EXAMPLE}`, `No agendes lo siguiente. ${EXAMPLE}`,
    `> ${EXAMPLE}`, `El mensaje dice: «${EXAMPLE}»`, `¿Cómo harías esto? Por ejemplo: ${EXAMPLE}`,
  ];
  let calls = 0;
  for (const message of messages) {
    assert.equal(detectAgendaRequest(message), false, message);
    assert.equal(await interpretAgendaRequest({}, message, { ...OPTIONS, generate() { calls++; } }), null);
  }
  assert.equal(calls, 0);
});

const SEMANTIC = 'Melodi, reparte en días distintos Revisar Vetsa y Revisar Cognira. Mueve mis pendientes de hoy a mañana. Quiero hoy más tranquilo. Agenda revisar el contrato mañana a las 10 a.m. y entregar el informe mañana a las 4 p.m.';
const candidate = () => ({ intent: 'compound_agenda', distribute: [
  { title: 'Revisar Vetsa', source: 'Revisar Vetsa' }, { title: 'Revisar Cognira', source: 'Revisar Cognira' },
], moveDay: { from: 'today', to: 'tomorrow', source: 'Mueve mis pendientes de hoy a mañana' },
fixed: [
  { title: 'Revisar el contrato', day: 'tomorrow', localTime: '10:00', assumedPeriod: false, source: 'revisar el contrato mañana a las 10 a.m.' },
  { title: 'Entregar el informe', day: 'tomorrow', localTime: '16:00', assumedPeriod: false, source: 'entregar el informe mañana a las 4 p.m.' },
], relaxToday: true, relaxSource: 'Quiero hoy más tranquilo' });

test('unsupported compound wording uses one semantic extraction with schema and original time, then the same validator', async () => {
  const calls = [];
  const directive = await interpretAgendaRequest({ TIME_ZONE: OPTIONS.timeZone }, SEMANTIC, { now: OPTIONS.now,
    generate(body) { calls.push(body); return { text: JSON.stringify(candidate()) }; } });
  assert.ok(directive); assert.equal(calls.length, 1); assert.equal(calls[0].model, 'spaik-flash');
  assert.equal(JSON.parse(calls[0].contents).clock.now_utc, OPTIONS.now);
  assert.equal(calls[0].options.jsonMode, true); assert.equal(calls[0].options.max_tokens, 2200);
  assert.match(calls[0].options.systemPrompt, /no permiso para desarrollar software/);
  const plan = buildAgendaPlan(directive);
  assert.equal(plan.executable, true); assert.equal(plan.createEvents.length, 4);
  assert.equal(plan.createEvents[0].localDateTime, '2026-10-22T10:00');
  assert.equal(plan.createEvents[2].localDay, '2026-10-23');
});

test('untrusted extraction cannot invent a title, clock, date, move target or additional executable operation', () => {
  for (const mutate of [
    value => value.distribute.push({ title: 'Borrar todas las apps', source: 'Revisar Vetsa' }),
    value => value.fixed[0].localTime = '22:00',
    value => value.fixed[0].day = '2028-01-01',
    value => value.fixed[0].day = 'tomorrow; DROP TABLE melodi_calendar_events',
    value => value.moveDay.to = 'day_after_tomorrow',
    value => value.moveDay.source = 'Mueve todo en todas las cuentas',
    value => value.tools = ['desktop_action'],
    value => value.fixed[0].duration = 3600,
    value => value.distribute[0].title = 'Revisar Vetsa y publicar el resultado',
  ]) {
    const value = candidate(); mutate(value);
    assert.equal(validateAgendaRequest(value, SEMANTIC, OPTIONS), null);
  }
});

test('one semantic failure returns no partial instructions and never writes to database or calendar services', async () => {
  for (const response of [{ text: 'not json' }, { text: JSON.stringify({ ...candidate(), tools: ['desktop_action'] }) }]) {
    const directive = await interpretAgendaRequest({}, SEMANTIC, { ...OPTIONS, generate: async () => response });
    assert.equal(directive, null);
  }
  const failed = await interpretAgendaRequest({ VETSA_INTELLIGENCE: { fetch: async () => new Response('down', { status: 503 }) } }, SEMANTIC, OPTIONS);
  assert.equal(failed, null);
});

test('ambiguous clocks without an ordered afternoon anchor need one clarification', () => {
  const directive = parseAgendaRequest(EXAMPLE, OPTIONS);
  directive.actions.fixed = directive.actions.fixed.slice(0, 2);
  const plan = buildAgendaPlan(directive);
  assert.equal(plan.executable, false); assert.match(plan.clarification, /mañana o por la tarde/);
  assert.deepEqual(plan.createEvents, []); assert.equal(plan.moveDay, null);
});

test('semantic extraction must cover every requested category, project and fixed clock before a plan is accepted', () => {
  for (const mutate of [
    value => value.distribute.pop(),
    value => value.distribute = [],
    value => value.moveDay = null,
    value => value.fixed.pop(),
    value => value.relaxToday = false,
    value => value.fixed.push({ ...value.fixed[0] }),
    value => value.fixed[0].source = 'Agenda revisar el contrato mañana a las 10 a.m. y entregar el informe mañana a las 4 p.m.',
  ]) {
    const value = candidate(); mutate(value);
    assert.equal(validateAgendaRequest(value, SEMANTIC, OPTIONS), null);
  }
});

test('the planner never picks an uninspected day outside the snapshot window', () => {
  const plan = buildAgendaPlan(parseAgendaRequest(EXAMPLE, OPTIONS), { snapshot: { events: [], end: '2026-10-24T04:00:00.000Z' } });
  assert.equal(plan.executable, false); assert.deepEqual(plan.createEvents, []); assert.equal(plan.moveDay, null);
  assert.match(plan.clarification, /espacio disponible/);
  const semantic = candidate(); semantic.fixed[0].day = '2026-11-20'; semantic.fixed[0].source = 'revisar el contrato 2026-11-20 a las 10 a.m.';
  const raw = SEMANTIC.replace('revisar el contrato mañana a las 10 a.m.', semantic.fixed[0].source);
  const far = validateAgendaRequest(semantic, raw, OPTIONS);
  assert.ok(far);
  const outside = buildAgendaPlan(far, { snapshot: { events: [], end: '2026-11-01T04:00:00.000Z' } });
  assert.equal(outside.executable, false); assert.match(outside.clarification, /fuera de la agenda/);
});

test('a contextual tomorrow answer retains all seven creations and the original move/distribution instead of losing the compound request', () => {
  const options = { ...OPTIONS, now: '2026-10-21T20:00:00.000Z' };
  const directive = parseAgendaRequest(EXAMPLE, options);
  assert.equal(buildAgendaPlan(directive).clarificationCode, 'past_fixed');
  for (const answer of ['mañana', 'sí, para mañana']) {
    const resolved = resolveAgendaContinuation(directive, answer, options);
    const plan = buildAgendaPlan(resolved);
    assert.equal(plan.executable, true); assert.equal(plan.createEvents.length, 7);
    assert.ok(plan.createEvents.filter(item => item.kind === 'fixed').every(item => item.localDay === '2026-10-22'));
    assert.deepEqual(plan.moveDay, { fromDate: '2026-10-21', toDate: '2026-10-22', onlyCalendarEvents: true, resolveWorkConflicts: true });
    assert.deepEqual(plan.createEvents.filter(item => item.kind === 'project_work').map(item => item.localDay), ['2026-10-23', '2026-10-24', '2026-10-25']);
    assert.equal(resolved.referenceAt, directive.referenceAt);
  }
  assert.equal(directive.actions.fixed[0].day, 'today', 'continuation never mutates the stored original');
  assert.match(resolveAgendaContinuation(directive, 'sí', options).clarification, /Para qué día/);
  assert.equal(resolveAgendaContinuation(directive, 'Gracias, haz un documento nuevo', options), null);
});

test('a later tomorrow clarification anchors to the new owner reply while preserving the old day-move request', () => {
  const directive = parseAgendaRequest(EXAMPLE, { ...OPTIONS, now: '2026-10-21T20:00:00.000Z' });
  const resolved = resolveAgendaContinuation(directive, 'mañana', { now: '2026-10-22T16:00:00.000Z' });
  const plan = buildAgendaPlan(resolved);
  assert.equal(plan.executable, true);
  assert.equal(plan.createEvents[0].localDay, '2026-10-23');
  assert.deepEqual(plan.moveDay, { fromDate: '2026-10-21', toDate: '2026-10-22', onlyCalendarEvents: true, resolveWorkConflicts: true });
});

test('model extraction cannot restrict scope but the owner plan can preserve fixed routines while keeping their conflicts visible', () => {
  const value = candidate(); value.moveDay.onlyCalendarEvents = true;
  assert.equal(validateAgendaRequest(value, SEMANTIC, OPTIONS), null, 'the model cannot grant a narrower execution instead of asking');
  const directive = parseAgendaRequest(EXAMPLE, OPTIONS);
  directive.actions.moveDay.onlyCalendarEvents = true;
  const plan = buildAgendaPlan(directive, { snapshot: [
    { kind: 'melodi_calendar_events', title: 'Recordatorio', eventAt: '2026-10-21T14:00:00.000Z' },
  ] });
  assert.equal(plan.executable, true); assert.equal(plan.moveDay.onlyCalendarEvents, true);
  const blocked = buildAgendaPlan(directive, { snapshot: [{ kind: 'agent_routine', title: 'Rutina', eventAt: '2026-10-21T13:00:00.000Z' }] });
  assert.equal(blocked.executable, false); assert.match(blocked.clarification, /coinciden/);
});

test('automatic flexible-work moves stay within the requested day and never push work after 18:00',()=>{
  const work={kind:'melodi_calendar_events',id:'work',title:'Implementar la conexión de Vetsa',eventAt:'2026-10-21T22:00:00.000Z',eventType:'REMINDER',movable:true};
  const anchored={kind:'agent_routine',id:'anchor',title:'Compromiso fijo',eventAt:'2026-10-22T22:00:00.000Z',movable:false};
  const moveDay={fromDate:'2026-10-21',toDate:'2026-10-22',onlyCalendarEvents:true,resolveWorkConflicts:true};
  const available=agendaDayMoves([work,anchored],moveDay,OPTIONS);
  assert.equal(available.conflicts.length,0);assert.equal(available.moved[0].eventAt,'2026-10-22T21:30:00.000Z');
  const fullDay=[];
  for(let minute=9*60;minute<=18*60;minute+=30)fullDay.push({...anchored,id:`occupied-${minute}`,
    eventAt:`2026-10-22T${String(Math.floor(minute/60)+4).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00.000Z`});
  const full=agendaDayMoves([work,...fullDay],moveDay,OPTIONS);
  assert.equal(full.moved.length,0);assert.equal(full.conflicts.length,1);assert.equal(full.adjustments.length,0);
  assert.equal(full.conflicts[0].reason,'time_conflict');
});

test('a fixed medical or named meeting appointment is never automatically shifted to another start',()=>{
  const moveDay={fromDate:'2026-10-21',toDate:'2026-10-22',onlyCalendarEvents:true,resolveWorkConflicts:true};
  for(const title of ['Cita médica','Preparar reunión con Alfredo','Buscar a mi hermana a la escuela']){
    const appointment={kind:'melodi_calendar_events',id:'appointment',title,eventAt:'2026-10-21T13:00:00.000Z',eventType:'REMINDER',movable:true};
    assert.equal(flexibleAgendaTask(appointment),false,title);
    const result=agendaDayMoves([appointment,{kind:'agent_routine',id:'boxing',title:'Ir al boxeo',eventAt:'2026-10-22T13:00:00.000Z'}],moveDay,OPTIONS);
    assert.equal(result.moved.length,0);assert.equal(result.conflicts.length,1);assert.equal(result.adjustments.length,0);
    assert.equal(result.conflicts[0].event.title,title);
  }
});

test('confirmations disclose the actual adjusted task time instead of claiming all original hours were kept',()=>{
  const directive=parseAgendaRequest(EXAMPLE,OPTIONS),plan=buildAgendaPlan(directive);
  const result={status:'applied',created:plan.createEvents,moved:[{id:'work',title:'Implementar la conexión',eventAt:'2026-10-22T13:30:00.000Z'}],movedCount:1,
    adjustments:[{id:'work',title:'Implementar la conexión',from:'2026-10-22T13:00:00.000Z',to:'2026-10-22T13:30:00.000Z',conflicting:[{title:'Ir al boxeo'}]}]};
  const text=agendaPlanConfirmation(result,plan,OPTIONS.timeZone,OPTIONS.now);
  assert.match(text,/Implementar la conexión/);assert.match(text,/9:30|09:30/);assert.match(text,/Ir al boxeo/);
  assert.doesNotMatch(text,/conservando sus horas/);
});
