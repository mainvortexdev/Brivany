import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerAutonomyServices } from '../owner-features.js';

const owner = '18495205246';
function fixture({ type = 'generate_story', bytes = 4, emailStatus = null } = {}) {
  const statements = [], queued = [];
  const mediaBytes = new Uint8Array(bytes);
  const row = { id: 'private-job', job_type: type, status: 'complete' };
  const document = { id: row.id, object_key: 'owner/document.pdf', mime_type: 'application/pdf', file_name: 'informe.pdf' };
  const story = { id: row.id, object_key: 'owner/story.png', mime_type: 'image/png' };
  const env = {
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'),
    WHATSAPP_PHONE_NUMBER_ID: 'test-number', WHATSAPP_TOKEN: 'private-token',
    BREVO_API_KEY: 'private-brevo', OWNER_EMAIL_FORWARD_TO: 'owner@example.com',
    MELODI_JOBS: { async send(value) { queued.push(value); } },
    VETSA_MEDIA: { async get() { return { size: mediaBytes.byteLength, arrayBuffer: async () => mediaBytes.buffer }; } },
    VETSA_CLOUD: { prepare(sql) { return { bind(...values) {
      const entry = { sql, values }; statements.push(entry);
      return {
        async first() {
          if (sql.includes('FROM wa_owner_jobs')) return row;
          if (sql.includes('FROM wa_owner_documents')) return type === 'generate_document' ? document : null;
          if (sql.includes('FROM wa_story_single_drafts')) return type === 'generate_story' ? story : null;
          if (sql.includes('FROM wa_owner_email_messages')) return emailStatus ? { status: emailStatus } : null;
          return null;
        },
        async run() { return { meta: { changes: 1 } }; },
      };
    } }; } },
  };
  return { env, services: ownerAutonomyServices(env), row, statements, queued };
}

test('coordinated WhatsApp sends stories as native images to the owner', async (t) => {
  const { services, statements } = fixture();
  const sends = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/media')) return Response.json({ id: 'media-1' });
    sends.push(JSON.parse(init.body));
    return Response.json({ messages: [{ id: 'message-1' }] });
  });
  assert.deepEqual(await services.deliverArtifact(owner, 'private-job', 'Melodi: Vista previa.'), { status: 'sent', messageId:'message-1', artifact: true });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].type, 'image');
  assert.equal(sends[0].to, owner);
  assert.equal(sends[0].image.caption, 'Melodi: Vista previa.');
  assert.equal(statements.some(({ sql }) => sql.includes('UPDATE wa_story_single_drafts SET preview_sent_at=')), true);
});

test('WhatsApp documents may exceed the separate email attachment limit', async (t) => {
  const { services } = fixture({ type: 'generate_document', bytes: 4_500_001 });
  let message;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/media')) return Response.json({ id: 'media-1' });
    message = JSON.parse(init.body);
    return Response.json({ messages: [{ id: 'message-1' }] });
  });
  await services.deliverArtifact(owner, 'private-job', 'Melodi: Tu informe.');
  assert.equal(message.type, 'document');
  assert.equal(message.document.filename, 'informe.pdf');
});

test('emailed story previews become publish-eligible only after a confirmed owner delivery', async (t) => {
  const { services, statements } = fixture();
  let email;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    email = JSON.parse(init.body);
    return Response.json({ messageId: 'email-1' });
  });
  assert.equal((await services.emailOwner(owner, 'outbox-1', 'melodi', 'Melodi: Revisa esta historia.', 'private-job')).status, 'sent');
  assert.deepEqual(email.to, [{ email: 'owner@example.com' }]);
  assert.equal(email.attachment[0].name, 'historia-vetsa.png');
  const preview = statements.find(({ sql }) => sql.includes('UPDATE wa_story_single_drafts SET preview_sent_at='));
  assert.ok(preview);
  assert.match(preview.sql, /preview_sent_at IS NULL/);
  assert.deepEqual(preview.values.slice(2), ['private-job', owner]);
});

test('an unconfirmed email reservation never authorizes a story preview', async (t) => {
  const { services, statements } = fixture({ emailStatus: 'reserved' });
  t.mock.method(globalThis, 'fetch', async () => assert.fail('A reserved email must not be sent again'));
  assert.equal((await services.emailOwner(owner, 'outbox-1', 'melodi', 'Revisa la historia.', 'private-job')).status, 'reserved');
  assert.equal(statements.some(({ sql }) => sql.includes('UPDATE wa_story_single_drafts SET preview_sent_at=')), false);
});

test('a failed WhatsApp delivery leaves the prepared story invisible to publication cron', async (t) => {
  const { services, statements } = fixture();
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/media')
    ? Response.json({ id: 'media-1' }) : Response.json({ error: { code: 131047 } }, { status: 400 }));
  await assert.rejects(services.deliverArtifact(owner, 'private-job', 'Vista previa.'), /131047/);
  assert.equal(statements.some(({ sql }) => sql.includes('UPDATE wa_story_single_drafts SET preview_sent_at=')), false);
});

test('proactive retries cannot replay ordinary user deliveries or third-party email jobs', async () => {
  for (const type of ['generate_document', 'generate_story', 'send_email', 'edit_image']) {
    const { services, row, queued } = fixture({ type });
    row.status = 'failed'; row.error_code = 'provider_http_502';
    const sealed = await services.encrypt({ deliveryMode: 'immediate', emailDelivery: { to: 'third-party@example.com' } });
    row.encrypted_payload = sealed.encrypted; row.payload_iv = sealed.iv;
    assert.equal((await services.retryOwnerJob({ ownerPhone: owner, jobId: row.id })).available, false);
    assert.deepEqual(queued, []);
  }
});

test('a private transient failure can be retried once through the existing owner queue', async () => {
  const { services, row, queued } = fixture({ type: 'generate_document' });
  row.status = 'failed'; row.error_code = 'provider_http_502';
  const sealed = await services.encrypt({ deliveryMode: 'private', autonomyAgent: 'melodi', autonomyRetries: 0 });
  row.encrypted_payload = sealed.encrypted; row.payload_iv = sealed.iv;
  assert.deepEqual(await services.retryOwnerJob({ ownerPhone: owner, jobId: row.id }), { status: 'queued', jobId: row.id });
  assert.deepEqual(queued, [{ jobId: row.id }]);
});
