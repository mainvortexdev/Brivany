import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { FinanceD1, OWNER } from './finance-fixture.js';
import {
  REPORT_QUERY, isDeliveryReportMessage, reportSubjectFacts, reportAttachments,
  decodeAttachmentData, decompressReportBytes, parseDeliveryReport, summarizeDeliveryReport, deliveryReportMessage,
} from '../mail-report-digest.js';
import { digestReportMessage, readDeliveryReport, listNewDeliveryReports } from '../mail-report-reader.js';
import { announceDeliveryReports } from '../mail-report-watch.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const SENDER = 'noreply-smtp-tls-reporting@google.com';
const SUBJECT = 'Report Domain: vetsa.es Submitter: google.com Report-ID: <2026-11-12T00:00:00Z+vetsa.es@google.com>';

const clean = {
  'organization-name': 'Google Inc.',
  'date-range': { 'start-datetime': '2026-11-12T00:00:00Z', 'end-datetime': '2026-11-12T23:59:59Z' },
  'contact-info': 'smtp-tls-reporting@google.com',
  'report-id': '2026-11-12T00:00:00Z+vetsa.es@google.com',
  policies: [{
    policy: { 'policy-type': 'sts', 'policy-domain': 'vetsa.es', 'mx-host': ['*.mx.cloudflare.net'] },
    summary: { 'total-successful-session-count': 12, 'total-failure-session-count': 0 },
  }],
};
const broken = {
  ...clean,
  'report-id': '2026-11-13T00:00:00Z+vetsa.es@google.com',
  policies: [{
    policy: { 'policy-type': 'sts', 'policy-domain': 'vetsa.es' },
    summary: { 'total-successful-session-count': 3, 'total-failure-session-count': 7 },
    'failure-details': [
      { 'result-type': 'certificate-expired', 'receiving-mx-hostname': 'mx1.vetsa.es', 'sending-mta-ip': '203.0.113.9', 'failed-session-count': 5 },
      { 'result-type': 'starttls-not-supported', 'receiving-mx-hostname': 'mx2.vetsa.es', 'failed-session-count': 2 },
    ],
  }],
};

const base64url = buffer => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function zipOf(text) {
  const name = Buffer.from('report.json'), body = deflateRawSync(Buffer.from(text));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}

function message(report, { id = 'msg-1', from = SENDER, subject = SUBJECT, filename = 'google.com!vetsa.es!1762905600!1762991999!.json.gz', internalDate = String(NOW - 3600_000), pack = gzipSync } = {}) {
  const bytes = report === null ? null : pack(Buffer.from(JSON.stringify(report)));
  return {
    id, internalDate, threadId: 't-1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Fri, 13 Nov 2026 16:27:00 +0000' }],
      parts: [
        { mimeType: 'text/plain', filename: '', body: { size: 40, data: base64url(Buffer.from('This is an aggregate TLS report.')) } },
        ...(bytes ? [{ mimeType: 'application/gzip', filename, body: { size: bytes.length, attachmentId: 'att-1' } }] : []),
      ],
    },
    attachments: bytes ? { 'att-1': base64url(bytes) } : {},
  };
}

function fakeGmail(messages) {
  const calls = { list: [], get: [], attachment: [] };
  return {
    calls,
    listMessages(options) { calls.list.push(options); return Promise.resolve({ messages: messages.map(item => ({ id: item.id })) }); },
    getMessage(id) { calls.get.push(id); const found = messages.find(item => item.id === id); if (!found) throw Error('not_found'); return Promise.resolve(found); },
    getAttachment(messageId, attachmentId) {
      calls.attachment.push([messageId, attachmentId]);
      const data = messages.find(item => item.id === messageId)?.attachments?.[attachmentId];
      if (!data) throw Error('missing_attachment');
      return Promise.resolve({ size: data.length, data });
    },
  };
}

test('un informe sin fallos se explica como correcto y sin tecnicismos', async () => {
  const text = await decompressReportBytes(new Uint8Array(gzipSync(Buffer.from(JSON.stringify(clean)))));
  const summary = summarizeDeliveryReport(parseDeliveryReport(text));
  assert.equal(summary.severity, 'ok');
  assert.equal(summary.attention, false);
  assert.equal(summary.successful, 12);
  assert.equal(summary.failed, 0);
  assert.match(summary.text, /Informe de entrega de correo · vetsa\.es/);
  assert.match(summary.text, /Todo bien/);
  assert.match(summary.text, /no tienes que hacer nada/i);
  for (const jargon of ['TLS', 'MTA-STS', 'STARTTLS', 'policy', 'session-count', 'RFC']) assert.ok(!summary.text.includes(jargon), `no debe aparecer ${jargon}`);
});

test('los fallos se traducen a causas en palabras corrientes con su recuento', () => {
  const summary = summarizeDeliveryReport(parseDeliveryReport(JSON.stringify(broken)));
  assert.equal(summary.severity, 'review');
  assert.equal(summary.attention, true);
  assert.equal(summary.total, 10);
  assert.match(summary.text, /De 10 intentos de entrega, 3 llegaron protegidos y 7 no\./);
  assert.match(summary.text, /certificado del servidor estaba vencido \(en mx1\.vetsa\.es\): 5 veces/);
  assert.match(summary.text, /no ofreció una conexión protegida \(en mx2\.vetsa\.es\): 2 veces/);
  assert.match(summary.text, /Conviene revisarlo/);
  assert.ok(!summary.text.includes('203.0.113.9'), 'no expone direcciones de servidores emisores');
  assert.deepEqual(summary.causes.map(cause => cause.type), ['certificate-expired', 'starttls-not-supported']);
});

test('fallos aislados no se presentan como una alerta', () => {
  const minor = { ...broken, policies: [{ ...broken.policies[0], summary: { 'total-successful-session-count': 180, 'total-failure-session-count': 2 }, 'failure-details': [{ 'result-type': 'validation-failure', 'failed-session-count': 2 }] }] };
  const summary = summarizeDeliveryReport(parseDeliveryReport(JSON.stringify(minor)));
  assert.equal(summary.severity, 'minor');
  assert.match(summary.text, /Son casos sueltos/);
});

test('el adjunto se abre por su contenido: gzip, zip y JSON directo', async () => {
  const text = JSON.stringify(clean);
  for (const bytes of [gzipSync(Buffer.from(text)), zipOf(text), Buffer.from(text)]) {
    assert.equal(await decompressReportBytes(new Uint8Array(bytes)), text);
  }
});

test('un adjunto manipulado o ilegible se rechaza sin inventar resultado', async () => {
  await assert.rejects(() => decompressReportBytes(new Uint8Array(0)), /invalid_report_bytes/);
  await assert.rejects(() => decompressReportBytes(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x09])), { name: 'TypeError' });
  assert.throws(() => decodeAttachmentData('no base64url!'), /invalid_attachment_data/);
  assert.throws(() => parseDeliveryReport('{]'), /invalid_report_json/);
  assert.throws(() => parseDeliveryReport('{"policies":[]}'), /report_without_policies/);
  assert.throws(() => parseDeliveryReport(JSON.stringify({ policies: 'x' })), /report_without_policies/);
});

test('un adjunto gigante se corta antes de descomprimirse del todo', async () => {
  const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61));
  await assert.rejects(() => decompressReportBytes(new Uint8Array(bomb)), /report_too_large/);
});

test('se reconocen remitente, asunto y adjuntos candidatos del correo', () => {
  const item = message(clean);
  assert.ok(isDeliveryReportMessage({ from: SENDER, subject: 'otro asunto' }));
  assert.ok(isDeliveryReportMessage({ from: 'postmaster@example.net', subject: SUBJECT }));
  assert.ok(!isDeliveryReportMessage({ from: 'amiga@example.com', subject: 'Hola' }));
  assert.deepEqual(reportSubjectFacts(SUBJECT), { domain: 'vetsa.es', submitter: 'google.com', reportId: '2026-11-12T00:00:00Z+vetsa.es@google.com' });
  const found = reportAttachments(item);
  assert.equal(found.length, 1);
  assert.equal(found[0].attachmentId, 'att-1');
  assert.match(REPORT_QUERY, /noreply-smtp-tls-reporting@google\.com/);
});

test('sin messageId se busca el informe más reciente del buzón conectado', async () => {
  const api = fakeGmail([message(clean)]);
  const digest = await readDeliveryReport(api, {});
  assert.equal(digest.status, 'ready');
  assert.equal(digest.domain, 'vetsa.es');
  assert.equal(digest.attachment, 'google.com!vetsa.es!1762905600!1762991999!.json.gz');
  assert.equal(api.calls.list[0].q, REPORT_QUERY);
  assert.deepEqual(api.calls.attachment, [['msg-1', 'att-1']]);
});

test('un correo que no es un informe, o sin adjunto, se declara como tal', async () => {
  const other = await digestReportMessage(fakeGmail([]), message(clean, { from: 'amiga@example.com', subject: 'Hola' }));
  assert.equal(other.status, 'not_a_report');
  const empty = await digestReportMessage(fakeGmail([]), message(null));
  assert.equal(empty.status, 'without_attachment');
});

test('un adjunto que no abre devuelve «unreadable», nunca un resumen vacío', async () => {
  const corrupt = message(clean);
  corrupt.attachments['att-1'] = base64url(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x11, 0x22]));
  const digest = await digestReportMessage(fakeGmail([corrupt]), corrupt);
  assert.equal(digest.status, 'unreadable');
  assert.equal(digest.text, undefined);
});

test('sólo se listan los informes llegados después de la última revisión', async () => {
  const older = message(clean, { id: 'old', internalDate: String(NOW - 10 * 86_400_000) });
  const newer = message(broken, { id: 'new', internalDate: String(NOW - 600_000) });
  const digests = await listNewDeliveryReports(fakeGmail([newer, older]), { sinceSeconds: Math.floor((NOW - 86_400_000) / 1000) });
  assert.deepEqual(digests.map(digest => digest.messageId), ['new']);
});

async function watchFixture(messages) {
  const db = new FinanceD1();
  const sent = [];
  const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER, TIME_ZONE: 'America/Santo_Domingo' };
  const api = fakeGmail(messages);
  const options = { now: NOW, withClient: (_env, _phone, operation) => operation(api) };
  return { db, env, api, options, sent, send: (_env, phone, body) => { sent.push({ phone, body }); return Promise.resolve(); } };
}

test('el aviso automático llega una sola vez por informe', async () => {
  const fixture = await watchFixture([message(clean)]);
  const first = await announceDeliveryReports(fixture.env, fixture.send, fixture.options);
  assert.deepEqual({ status: first.status, announced: first.announced }, { status: 'checked', announced: 1 });
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].phone, OWNER);
  assert.match(fixture.sent[0].body, /Todo bien/);

  const again = await announceDeliveryReports(fixture.env, fixture.send, { ...fixture.options, now: NOW + 600_000 });
  assert.equal(again.announced, 0);
  assert.equal(fixture.sent.length, 1);
});

test('varios informes a la vez llegan en un solo mensaje que señala cuál mirar', async () => {
  const fixture = await watchFixture([message(clean, { id: 'a' }), message(broken, { id: 'b', internalDate: String(NOW - 1800_000) })]);
  const result = await announceDeliveryReports(fixture.env, fixture.send, fixture.options);
  assert.equal(result.announced, 2);
  assert.match(fixture.sent[0].body, /Llegaron 2 informes de entrega de correo; 1 necesita un vistazo\./);
});

test('si el aviso no sale, el informe se reintenta en el siguiente tick', async () => {
  const fixture = await watchFixture([message(clean)]);
  let fail = true;
  const flaky = (env, phone, body) => { if (fail) throw Error('whatsapp_window_closed'); return fixture.send(env, phone, body); };
  const blocked = await announceDeliveryReports(fixture.env, flaky, fixture.options);
  assert.deepEqual({ status: blocked.status, announced: blocked.announced }, { status: 'retrying', announced: 0 });
  assert.equal(fixture.sent.length, 0);
  fail = false;
  const retried = await announceDeliveryReports(fixture.env, flaky, { ...fixture.options, now: NOW + 60_000 });
  assert.equal(retried.announced, 1);
  assert.equal(fixture.sent.length, 1);
});

test('un buzón sin conectar no inventa informes ni mueve la marca de revisión', async () => {
  const fixture = await watchFixture([message(clean)]);
  const error = Object.assign(Error('Gmail: authorization_required'), { code: 'authorization_required' });
  const result = await announceDeliveryReports(fixture.env, fixture.send, { ...fixture.options, withClient: () => { throw error; } });
  assert.deepEqual({ status: result.status, announced: result.announced }, { status: 'disconnected', announced: 0 });
  const recovered = await announceDeliveryReports(fixture.env, fixture.send, fixture.options);
  assert.equal(recovered.announced, 1);
});

test('un informe que llega y no se puede abrir se dice, no se omite', async () => {
  const corrupt = message(clean);
  corrupt.attachments['att-1'] = base64url(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x33]));
  const fixture = await watchFixture([corrupt]);
  const result = await announceDeliveryReports(fixture.env, fixture.send, fixture.options);
  assert.equal(result.announced, 1);
  assert.equal(result.unreadable, 1);
  assert.match(fixture.sent[0].body, /no pude abrir su adjunto/);
});

// Contenido exacto de un adjunto real recibido de Google el 13 de noviembre de
// 2026 (informe del día 12). Fija la forma que el proveedor envía de verdad.
const REAL_REPORT = '{"organization-name":"Google Inc.","date-range":{"start-datetime":"2026-11-12T00:00:00Z","end-datetime":"2026-11-12T23:59:59Z"},"contact-info":"smtp-tls-reporting@google.com","report-id":"2026-11-12T00:00:00Z_vetsa.es","policies":[{"policy":{"policy-type":"sts","policy-string":["version: STSv1","mode: testing","mx: *.mx.cloudflare.net","max_age: 86400"],"policy-domain":"vetsa.es","mx-host":["*.mx.cloudflare.net"]},"summary":{"total-successful-session-count":1,"total-failure-session-count":0}}]}';
const REAL_SUBJECT = 'Report Domain: vetsa.es Submitter: google.com Report-ID: <2026.11.12T00.00.00Z+vetsa.es@google.com>';
const REAL_FILENAME = 'google.com!vetsa.es!1794441600!1794527999!001.json.gz';

test('el informe real de Google se reconoce, se abre y se explica', async () => {
  // El proveedor usa este tipo propio y puntos en el identificador del asunto.
  const item = message(null, { subject: REAL_SUBJECT, id: 'real' });
  const bytes = gzipSync(Buffer.from(REAL_REPORT));
  item.payload.parts.push({ mimeType: 'application/tlsrpt+gzip', filename: REAL_FILENAME, body: { size: bytes.length, attachmentId: 'att-1' } });
  item.attachments['att-1'] = base64url(bytes);

  assert.deepEqual(reportSubjectFacts(REAL_SUBJECT), { domain: 'vetsa.es', submitter: 'google.com', reportId: '2026.11.12T00.00.00Z+vetsa.es@google.com' });
  assert.deepEqual(reportAttachments(item).map(found => found.filename), [REAL_FILENAME]);

  const digest = await digestReportMessage(fakeGmail([item]), item);
  assert.equal(digest.status, 'ready');
  assert.equal(digest.domain, 'vetsa.es');
  assert.equal(digest.successful, 1);
  assert.equal(digest.failed, 0);
  assert.equal(digest.severity, 'ok');
  assert.match(digest.text, /Cubre el 12 de noviembre\./);
  assert.match(digest.text, /Todo bien: 1 entrega llegó protegida y ninguna falló\./);
});

test('un dominio que sólo observa no se cuenta como protegido del todo', async () => {
  const observing = summarizeDeliveryReport(parseDeliveryReport(REAL_REPORT));
  assert.equal(observing.mode, 'testing');
  assert.equal(observing.observing, true);
  assert.match(observing.text, /tu dominio está en modo de prueba.*el correo se entrega igual/s);

  const strict = parseDeliveryReport(REAL_REPORT.replace('mode: testing', 'mode: enforce'));
  const enforced = summarizeDeliveryReport(strict);
  assert.equal(enforced.mode, 'enforce');
  assert.equal(enforced.observing, false);
  assert.ok(!enforced.text.includes('modo de prueba'));

  const failing = JSON.parse(REAL_REPORT);
  failing.policies[0].summary = { 'total-successful-session-count': 4, 'total-failure-session-count': 1 };
  failing.policies[0]['failure-details'] = [{ 'result-type': 'certificate-expired', 'failed-session-count': 1 }];
  const mixed = summarizeDeliveryReport(parseDeliveryReport(JSON.stringify(failing)));
  assert.match(mixed.text, /esos correos se entregaron igual aunque no fueran protegidos/);
});

test('sin informes no se envía nada', async () => {
  const fixture = await watchFixture([]);
  const result = await announceDeliveryReports(fixture.env, fixture.send, fixture.options);
  assert.deepEqual({ status: result.status, announced: result.announced }, { status: 'checked', announced: 0 });
  assert.equal(fixture.sent.length, 0);
  assert.equal(deliveryReportMessage([]), '');
});
