import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePendingStory, classifyStoryTextRequest, declinePendingStory, prepareSingleStory, runApprovedSingleStories, setStoryAutoPublish, storyImageDimensions, storyIncludesOwner, weeklyStorySlots } from '../story-campaign.js';
import { interpretOwnerIntent, resolveOwnerPriorityIntent, resolvePendingStoryApproval, resolveStagedStoryIntent, resumeWaitingImageJobs, safeStoryGenerationFailureReply } from '../owner-features.js';

test('weekly campaign spreads four ordered stories across three dayparts for seven days', () => {
  const slots = weeklyStorySlots(new Date('2026-09-22T16:00:00Z'), 'America/Santo_Domingo');
  assert.equal(slots.length, 28);
  assert.deepEqual(slots.slice(0, 4).map(({ stage }) => stage), ['filtro', 'contexto', 'valor', 'cierre']);
  assert.deepEqual(slots.slice(0, 4).map(({ scheduledAt }) => scheduledAt), [
    '2026-09-23T12:30:00.000Z', '2026-09-23T15:30:00.000Z',
    '2026-09-23T19:30:00.000Z', '2026-09-23T23:30:00.000Z',
  ]);
  assert.equal(slots.at(-1).day, 6);
  assert.equal(new Set(slots.map(({ scheduledAt }) => scheduledAt)).size, 28);
});

test('generated stories must have inspectable dimensions before publication', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(png.buffer).setUint32(16, 1080);
  new DataView(png.buffer).setUint32(20, 1920);
  assert.deepEqual(storyImageDimensions(png, 'image/png'), { width: 1080, height: 1920 });
  assert.equal(storyImageDimensions(new Uint8Array(5), 'image/jpeg'), null);
});

test('a story can combine identity, saved style, and current-activity context without conflating them', async () => {
  let generation;
  const referencePng = new Uint8Array(20_024);
  referencePng.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(referencePng.buffer).setUint32(16, 640);
  new DataView(referencePng.buffer).setUint32(20, 640);
  const outputPng = new Uint8Array(24);
  outputPng.set([0x89, 0x50, 0x4e, 0x47], 0);
  new DataView(outputPng.buffer).setUint32(16, 1080);
  new DataView(outputPng.buffer).setUint32(20, 1920);
  const database = {
    prepare(sql) {
      return { bind(...args) { return {
        first: async () => sql.includes('wa_story_single_drafts') ? null
          : sql.includes('wa_story_portraits') ? { object_key: 'identity.png', mime_type: 'image/png' }
            : sql.includes('wa_story_visual_refs') ? { object_key: 'style.png', mime_type: 'image/png', guidance: 'paleta cálida y composición editorial' } : null,
        run: async () => ({ meta: { changes: 1 } }),
        all: async () => ({ results: [] }),
      }; } };
    },
  };
  const env = {
    VETSA_CLOUD: database,
    VETSA_MEDIA: { async get() { return { size: referencePng.length, async arrayBuffer() { return referencePng.buffer; } }; }, async put() {} },
    VETSA_INTELLIGENCE_API_KEY: 'test-key',
    VETSA_INTELLIGENCE: { async fetch(request) {
      const body = await request.json();
      if (body.options?.jsonMode) return Response.json({ text: JSON.stringify({ mode: 'none', text: '' }) });
      generation = body;
      return Response.json({ imageBase64: Buffer.from(outputPng).toString('base64'), mimeType: 'image/png' });
    } },
  };
  let delivered = false;
  await prepareSingleStory(env, 'owner', 'story-job', 'Crea una historia con mi foto de la pantalla', null,
    async () => { delivered = true; }, { kind: 'image', objectKey: 'current.png', mimeType: 'image/png', size: referencePng.length });
  assert.equal(delivered, true);
  assert.equal(generation.options.imageBase64, Buffer.from(referencePng).toString('base64'), 'activity photo is the primary image to transform');
  assert.equal(generation.options.referenceImages.length, 1, 'only visual style remains as a supporting reference when owner is omitted');
  assert.match(generation.contents, /Daniel no debe aparecer en esta imagen bajo ninguna forma/);
  assert.match(generation.contents, /La imagen base ES la foto real de actividad/);
  assert.match(generation.contents, /conserva reconociblemente el mismo escritorio\/escena, monitor y disposición de pantalla/);
  assert.match(generation.contents, /regla de tercios/);
  assert.match(generation.contents, /profundidad de campo/);
  assert.match(generation.contents, /no reveles claves, datos personales/);
  assert.match(generation.contents, /Daniel no debe aparecer en esta imagen bajo ninguna forma/);
  assert.doesNotMatch(generation.contents, /Daniel no lleva aretes/);
  assert.match(generation.contents, /tratamiento sutil de color, luz, grano fino/);
  assert.match(generation.contents, /un anuncio genérico/);
  assert.match(generation.contents, /NO incluyas palabras, frases, títulos/);
  assert.doesNotMatch(generation.contents, /La IA que lee entre líneas/);
  assert.doesNotMatch(generation.contents, /escribe una sola frase breve/);

  await prepareSingleStory(env, 'owner', 'story-job-explicit-self', 'Inclúyeme a mí en esta historia', null,
    async () => {}, { kind: 'image', objectKey: 'current.png', mimeType: 'image/png', size: referencePng.length }, true);
  assert.equal(generation.options.imageBase64, Buffer.from(referencePng).toString('base64'), 'the activity photo remains the editing base even when identity is requested');
  assert.equal(generation.options.referenceImages.length, 2, 'identity and visual style are secondary to activity photo');
  assert.match(generation.contents, /El propietario pidió expresamente aparecer/);
  assert.match(generation.contents, /Daniel no lleva aretes, pendientes, argollas/);
});

test('text is included in a story only when an AI semantic check finds an explicit request', async () => {
  const modes = [
    ['Crea una historia', { mode: 'none', text: '' }],
    ['Hazla con estilo retro', { mode: 'none', text: '' }],
    ['Añade la frase “Confía en el proceso” a la imagen', { mode: 'exact', text: 'Confía en el proceso' }],
    ['Pon una frase inspiradora en la imagen', { mode: 'compose', text: '' }],
  ];
  for (const [requestText, expected] of modes) {
    const env = { VETSA_INTELLIGENCE: { async fetch() {
      return Response.json({ text: JSON.stringify(expected) });
    } } };
    assert.deepEqual(await classifyStoryTextRequest(env, requestText), expected);
  }
  const failing = { VETSA_INTELLIGENCE: { async fetch() { throw new Error('unavailable'); } } };
  assert.deepEqual(await classifyStoryTextRequest(failing, 'Añade una frase'), { mode: 'none', text: '' });
});

test('owner likeness is included only when the semantic classifier confirms an explicit request', async () => {
  let request;
  const env = { VETSA_INTELLIGENCE: { async fetch(input) {
    request = await input.json();
    return Response.json({ text: JSON.stringify({ include_owner: true }) });
  } } };
  assert.equal(await storyIncludesOwner(env, 'Inclúyeme a mí en esta historia, trabajando en mi escritorio'), true);
  assert.match(request.options.systemPrompt, /Ante duda, false/);
  assert.match(request.options.systemPrompt, /mención de su trabajo.*NO lo autorizan/);
});

test('owner can enable automatic story publication via AI intent without changing Spaik Image', async () => {
  let request;
  const env = { VETSA_INTELLIGENCE: { async fetch(input) {
    request = await input.json();
    return Response.json({ provider: 'SiliconFlow', text: JSON.stringify({ intent: 'story_auto_on', agent: 'melodi' }) });
  } } };
  const intent = await interpretOwnerIntent(env, 'Ya no me pidas confirmación para publicar historias en Instagram');
  assert.equal(intent.intent, 'story_auto_on');
  assert.match(request.options.systemPrompt, /story_auto_on/);
  assert.doesNotMatch(request.options.systemPrompt, /nano-banana-pro/);
});

test('an attached current-activity photo plus a story request routes to story generation', async () => {
  let request;
  const env = { VETSA_INTELLIGENCE: { async fetch(input) {
    request = await input.json();
    return Response.json({ provider: 'SiliconFlow', text: JSON.stringify({ intent: 'story_single_create', agent: 'melodi' }) });
  } } };
  const intent = await interpretOwnerIntent(env, 'Esto estoy haciendo ahora. Crea una historia.', { hasMedia: true });
  assert.equal(intent.intent, 'story_single_create');
  assert.match(request.options.systemPrompt, /foto del momento actual junto con una petición de crear historia/);
  assert.match(request.options.systemPrompt, /pasa esa foto como contexto de actividad/);
});

test('staged-photo follow-up uses a semantic AI resolver when the general router returns chat', async () => {
  let request;
  const env = { VETSA_INTELLIGENCE: { async fetch(input) {
    request = await input.json();
    return Response.json({ text: JSON.stringify({ intent: 'story_single_create' }) });
  } } };
  assert.equal(await resolveStagedStoryIntent(env, 'Arma algo para mis stories con la foto que te mandé'), 'story_single_create');
  assert.match(request.options.systemPrompt, /sin exigir una frase exacta/);
  assert.match(request.options.systemPrompt, /solo describe la foto/);
  assert.match(request.options.systemPrompt, /no pidas tema, tono, formato ni ideas/i);
});

test('a clear reply to an existing story preview is treated as approval', async () => {
  const requests = [];
  const env = { VETSA_INTELLIGENCE: { async fetch(input) {
    const request = await input.json();
    requests.push(request);
    const { message } = JSON.parse(request.contents);
    return Response.json({ text: JSON.stringify({ approve: message === 'Publícala' }) });
  } } };
  assert.equal(await resolvePendingStoryApproval(env, 'Publícala'), true);
  assert.equal(await resolvePendingStoryApproval(env, 'Haz otra historia con otro encuadre'), false);
  assert.match(requests[0].options.systemPrompt, /vista previa real/);
  assert.match(requests[0].options.systemPrompt, /archivo ya está guardado/);
});

test('AI distinguishes rejecting a pending preview from unrelated conversation', async () => {
  const replies = [
    { decision: 'story_decline', agent: 'melodi' },
    { decision: 'other', agent: 'melodi' },
  ];
  const env = { VETSA_INTELLIGENCE: { async fetch(request) {
    const body = await request.json();
    assert.match(body.options.systemPrompt, /No uses palabras clave/);
    return Response.json({ text: JSON.stringify(replies.shift()) });
  } } };
  assert.deepEqual(await resolveOwnerPriorityIntent(env, 'No quiero que esa imagen se publique', {
    pendingStoryPreviewed: true, activeAgent: 'melodi', projects: [],
  }), {
    decision: 'story_decline', agent: 'melodi', projectId: '', projectName: '', projectNextStep: '', projectStatus: '',
  });
  assert.equal((await resolveOwnerPriorityIntent(env, 'Melodi, ayúdame con otra cosa', {
    pendingStoryPreviewed: true, activeAgent: 'melodi', projects: [],
  })).agent, 'melodi');
});

test('declining a preview is owner-scoped and makes it ineligible for publication', async () => {
  let statement;
  const env = { VETSA_CLOUD: { prepare(sql) { return { bind(...values) {
    statement = { sql, values };
    return { run: async () => ({ meta: { changes: 1 } }) };
  } }; } } };
  assert.equal(await declinePendingStory(env, 'owner', { id: 'story-1', kind: 'single' }), true);
  assert.match(statement.sql, /status='needs_review'/);
  assert.match(statement.sql, /owner_phone=\?/);
  assert.match(statement.sql, /approved_at IS NULL/);
  assert.deepEqual(statement.values.slice(1), ['story-1', 'owner']);
});

test('stale pending image jobs are recovered by the scheduled worker', async () => {
  const statements = [];
  const env = { VETSA_CLOUD: { prepare(sql) { return { bind(...values) {
    statements.push({ sql, values });
    return { run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [] }) };
  } }; } } };
  await resumeWaitingImageJobs(env, async () => {});
  assert.match(statements[0].sql, /SET status='waiting'.*WHERE status='processing'/s);
  assert.match(statements[1].sql, /status='pending' AND created_at<=\?/);
  assert.match(statements[1].sql, /status='waiting'/);
});

test('image generation credit failures cannot be misreported as Instagram publishing failures', () => {
  const reply = safeStoryGenerationFailureReply(
    'spaik_image_http_502_image_task_rejected_402',
    'Lo siento, no se pudo completar la publicación de la historia. ¿Quieres intentarlo de nuevo?',
  );
  assert.match(reply, /créditos suficientes/i);
  assert.match(reply, /La historia no se creó ni se publicó/i);
  assert.doesNotMatch(reply, /no se pudo completar la publicación/i);
  assert.match(safeStoryGenerationFailureReply('image_task_failed_unknown', 'No se pudo completar la publicación de la historia.'), /publicación ni siquiera se intentó/i);
});

test('story publication preference is owner-scoped and approval selects a previewed draft', async () => {
  const calls = [];
  const env = { VETSA_CLOUD: { prepare(sql) { return { bind(...args) { calls.push({ sql, args }); return {
    run: async () => ({ meta: { changes: 1 } }),
    first: async () => sql.includes('wa_story_single_drafts') ? {
      id: 'draft-1', operation_id: 'op-1', object_key: 'melodi-private/stories/single/draft-1',
      mime_type: 'image/png', scheduled_at: '2026-09-23T12:00:00Z', preview_sent_at: '2026-09-23T11:52:00Z',
    } : null,
  }; } }; } } };
  await setStoryAutoPublish(env, '18495205246', true);
  const approved = await approvePendingStory(env, '18495205246');
  assert.equal(approved.id, 'draft-1');
  assert.equal(approved.kind, 'single');
  assert.equal(approved.object_key, 'melodi-private/stories/single/draft-1');
  assert.equal(approved.mime_type, 'image/png');
  assert.deepEqual(calls[0].args.slice(0, 2), ['18495205246', 1]);
  assert.match(calls.at(-1).sql, /approved_at/);
  assert.match(calls.at(-1).sql, /preview_sent_at IS NOT NULL/);
});

test('approval selects the last preview sent, not the latest scheduled time', async () => {
  const env = { VETSA_CLOUD: { prepare(sql) { return { bind() { return { first: async () =>
    sql.includes('wa_story_single_drafts')
      ? { id: 'single', preview_sent_at: '2026-09-23T12:00:00Z', scheduled_at: '2026-09-24T18:00:00Z' }
      : { id: 'campaign', preview_sent_at: '2026-09-23T12:05:00Z', scheduled_at: '2026-09-23T18:00:00Z' },
  }; } }; } } };
  assert.deepEqual(await approvePendingStory(env, 'owner'), {
    id: 'campaign', preview_sent_at: '2026-09-23T12:05:00Z',
    scheduled_at: '2026-09-23T18:00:00Z', kind: 'campaign',
  });
});

test('an approved single-story preview recovers its missing Instagram operation', async () => {
  const actions = [];
  const updates = [];
  const env = {
    INSTAGRAM_INTERNAL_TOKEN: 'test-internal-token',
    VETSA_CLOUD: { prepare(sql) { return { bind(...args) { return {
      first: async () => ({
        id: 'story-1', operation_id: 'story-1', owner_phone: 'owner', status: 'ready',
        object_key: 'melodi-private/stories/single/story-1', mime_type: 'image/png',
      }),
      run: async () => { updates.push({ sql, args }); return { meta: { changes: 1 } }; },
    }; } }; } },
    VETSA_INSTAGRAM_OPERATIONS: { async fetch(request) {
      const payload = await request.json();
      actions.push(payload);
      if (payload.action === 'operation_status') return Response.json({ operation: null });
      if (payload.action === 'prepare_story') return Response.json({ operation: { id: 'story-1', status: 'draft' } });
      return Response.json({ operation: { id: 'story-1', status: 'approved' } });
    } },
  };
  await runApprovedSingleStories(env);
  assert.deepEqual(actions.map(({ action }) => action), ['operation_status', 'prepare_story', 'approve_operation']);
  assert.deepEqual(actions[1].media, { objectKey: 'melodi-private/stories/single/story-1', mimeType: 'image/png' });
  assert.match(updates[0].sql, /status='publishing'/);
});
