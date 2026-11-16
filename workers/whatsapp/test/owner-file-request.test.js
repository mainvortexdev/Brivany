import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerFileRequest, ownerFileRequestReply, assertGeneratedDocumentContent } from '../owner-file-request.js';
import { documentArtifactRequest } from '../document-workflow.js';
import { generate_document } from '../executors/documents.js';
import { job_generate_document } from '../executors/jobs/documents.js';

const reported = String.raw`Melodi, necesito que te comuniques con Melodi por que necesito este documento que. está en esta ubicación E:\GitHub\alexa-ai\output\pdf\Auditoria_Electro_Wisly_2026-10-12.pdf`;

test('the reported existing local PDF request cannot become newly authored prose', () => {
  const request = parseOwnerFileRequest(reported);
  assert.equal(request.source, 'local');
  assert.equal(request.path, String.raw`E:\GitHub\alexa-ai\output\pdf\Auditoria_Electro_Wisly_2026-10-12.pdf`);
  assert.equal(documentArtifactRequest(reported), null);
  assert.match(ownerFileRequestReply(request), /no me da acceso/i);
  assert.doesNotMatch(ownerFileRequestReply(request), /(?:ya envi[eé]|prepar[eé] el documento|lo recuper[eé])/i);
});

test('a Drive retrieval URL is a source requiring actual access and known private documents remain retrievable', () => {
  for (const message of ['Melodi, envíame este documento https://drive.google.com/file/d/abc123/view?usp=sharing',
    '¿Puedes descargar mi informe de https://docs.google.com/document/d/abc123/edit?',
    'Necesito este documento que está aquí:\nE:\\Informes\\original.pdf']) {
    const request = parseOwnerFileRequest(message);
    assert.ok(request);
    assert.ok(['local', 'drive'].includes(request.source));
    assert.equal(documentArtifactRequest(message), null);
  }
  assert.equal(parseOwnerFileRequest('Envíame la factura emitida de octubre').source, 'private');
  assert.equal(parseOwnerFileRequest('Envíame el documento de la auditoría').source, 'private');
});

test('authorship owns its supplied body; quoted instructions, narrative and reminders never retrieve files', () => {
  for (const message of ['Crea un PDF con esto\n\nNecesito este documento E:\\private\\original.pdf',
    'Melodi, redacta un documento que explique cómo descargar https://drive.google.com/file/d/source/view',
    'No envíes este documento E:\\private\\original.pdf',
    'Recuérdame enviar el documento E:\\private\\original.pdf',
    '“Envíame este documento E:\\private\\original.pdf”',
    'Ayer pedí el documento E:\\private\\original.pdf',
    'Hoy empezaré a crear el proyecto Cognira Edits']) {
    assert.equal(parseOwnerFileRequest(message), null, message);
  }
  assert.equal(documentArtifactRequest('Necesito un documento nuevo sobre privacidad').intent, 'generate_document');
  assert.equal(parseOwnerFileRequest('Melodi. Quiero que me envíes por email los formatos de esta publicación https://www.instagram.com/p/abc123/'), null,
    'the s:/ inside https:// is never a local Windows drive');
});

test('even a wrong generation interpretation cannot queue a substitute for the existing local file', async () => {
  const replies = [];
  assert.equal(await generate_document({ interpretation: { intent: 'generate_document' }, normalized: reported,
    env: {}, phone: 'owner', reply: async body => replies.push(body) }, {
    enqueueOwnerJob: async () => assert.fail('No invented replacement job'),
    resolveDocumentRequest: async () => assert.fail('No document deadline inference'),
  }), true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /Adjunta el archivo/);
});

test('misclassified private document requests retrieve the owner original instead of generating one', async () => {
  const original = { id: 'original-private', object_key: 'owner/original.pdf' }, sent = [];
  assert.equal(await generate_document({ interpretation: { intent: 'generate_document' }, normalized: 'Envíame el documento de la auditoría',
    env: {}, phone: 'owner-A', markTyping: async () => {}, reply: async () => assert.fail('Original is available') }, {
    findIssuedDocuments: async (_env, phone, query) => { assert.equal(phone, 'owner-A'); assert.equal(query, 'Envíame el documento de la auditoría'); return [original]; },
    sendIssuedDocument: async (_env, phone, artifact) => sent.push({ phone, artifact }),
    enqueueOwnerJob: async () => assert.fail('No new generation'),
  }), true);
  assert.deepEqual(sent, [{ phone: 'owner-A', artifact: original }]);
});

function jobFixture({ prompt = 'Crea un informe PDF sobre privacidad', output = 'Contenido profesional final', literal } = {}) {
  const calls = [];
  const context = { env: {}, row: { owner_phone: 'owner-A' }, jobId: 'job-owner-A',
    payload: { prompt, format: 'pdf', ...(literal !== undefined ? { preserveSourceContent: true, sourceContent: literal } : {}) } };
  const services = { getIssuedDocument: async () => null, documentKind: () => 'document', cleanText: value => String(value || '').trim(),
    callVetsa: async () => { calls.push('inference'); return { text: output }; },
    documentBytes: (_format, content) => { calls.push('render'); return { content }; },
    storeIssuedDocument: async () => { calls.push('store'); return { id: context.jobId }; },
    sendIssuedDocument: async () => { calls.push('send'); },
  };
  return { context, services, calls };
}

test('an already queued existing-file request fails before inference, storage, conversion or delivery', async () => {
  const h = jobFixture({ prompt: reported });
  await assert.rejects(job_generate_document(h.context, h.services), /existing_file_requires_retrieval/);
  assert.deepEqual(h.calls, []);
});

test('a generated refusal is a failure and can never become a PDF or a successful delivery', async () => {
  for (const output of ['Lo siento, pero no puedo cumplir con esa solicitud.',
    'No tengo acceso al archivo de tu ordenador.',
    "Sorry, I cannot access the requested file.",
    'Melodi: No puedo recuperar el documento que me has pedido.']) {
    assert.throws(() => assertGeneratedDocumentContent(output), /document_generation_refused/);
    const h = jobFixture({ output });
    await assert.rejects(job_generate_document(h.context, h.services), /document_generation_refused/);
    assert.deepEqual(h.calls, ['inference']);
  }
});

test('a literal user-supplied refusal and prose discussing restrictions are valid document content', async () => {
  const literal = 'Lo siento, pero no puedo cumplir con esa solicitud.';
  const h = jobFixture({ prompt: 'Crea un PDF con esto\n\n' + literal, literal });
  assert.equal((await job_generate_document(h.context, h.services)).status, 'delivered');
  assert.deepEqual(h.calls, ['render', 'store', 'send']);
  assert.equal(assertGeneratedDocumentContent('Política de acceso\nNo puedo recuperar archivos sin autorización: ejemplo de respuesta.'),
    'Política de acceso\nNo puedo recuperar archivos sin autorización: ejemplo de respuesta.');
});
