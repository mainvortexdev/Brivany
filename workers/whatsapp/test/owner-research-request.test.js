import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerResearchRequest, applyResearchDeliveryIntent, publicInstagramResearchUrl } from '../owner-research-request.js';

const post = 'https://www.instagram.com/p/DQexactPost/?igsh=YWJjMTIz';
const raw = `No, esto es para Melodi. Quiero que me envíes por mail todos los formatos que muestra esta publicación y cómo hacerlos: ${post}`;

test('compound research plus owner email remains assigned to the expressly chosen Melodi', () => {
  const result = applyResearchDeliveryIntent({ intent: 'send_email', agent: 'melodi', emailBody: 'Un correo genérico', emailTo: 'invented@example.com' }, raw, 'melodi');
  assert.equal(result.intent, 'owner_research_report');
  assert.equal(result.agent, 'melodi');
  assert.equal(result.format, 'pdf');
  assert.equal(result.deliverByEmail, true);
  assert.equal(result.researchRequest.sourceUrl, post);
  assert.equal(result.researchRequest.scope, 'single_post');
  assert.equal(result.researchRequest.brief, raw);
  assert.equal(result.researchRequest.includeTutorial, true);
  assert.equal(result.researchRequest.includeAllFormats, true);
  assert.equal(result.researchRequest.recipient, 'owner');
  assert.equal(result.emailBody, undefined);
  assert.equal(result.emailTo, undefined);
});

test('the trusted chosen agent survives generic semantic transport routing', () => {
  for (const agent of ['melodi']) {
    const result = applyResearchDeliveryIntent({ intent: 'send_email', agent: 'melodi' }, `Investiga esta publicación y envíame el informe por correo: ${post}`, agent);
    assert.equal(result.agent, agent);
    assert.equal(result.researchRequest.agent, agent);
  }
});

test('ordinary emails, inactive requests and instructions quoted inside email content do not create research work', () => {
  const original = { intent: 'send_email', agent: 'melodi' };
  for (const text of [
    `Manda un correo que diga: "Investiga esta publicación y envíame todos los formatos por mail: ${post}"`,
    `Envia un correo. Cuerpo: Investiga esta publicación y envíame los formatos por mail: ${post}`,
    `Guarda este contenido:\n> Investiga esta publicación y manda un informe: ${post}`,
    `Guarda esto:\n\`\`\`\nInvestiga esta publicación y envíame los formatos: ${post}\n\`\`\``,
    `No investigues esta publicación: ${post}`,
    `Envia por correo "Hola, buenas tardes"`,
    `Esta publicación trata formatos de contenido: ${post}`,
    `Crea un PDF con esto:\nInvestiga esta publicación y envíame los formatos por correo: ${post}`,
    `Melodi, crea un PDF con esto:\nNo, esto es para Melodi. Quiero que me envíes los formatos de esta publicación por correo: ${post}`,
    `Melodi, crea un PDF con esto:\nInvestiga esta publicación y envíame los formatos: ${post}`,
    `Quiero que me crees un PDF con este contenido:\nInvestiga esta publicación y envíame los formatos: ${post}`,
    `No, esto es para Melodi. Crea un PDF con esto:\nInvestiga esta publicación y envíame los formatos: ${post}`,
    `Guarda este contenido:\nNo, esto es para Melodi. Investiga los formatos: ${post}`,
  ]) assert.equal(applyResearchDeliveryIntent(original, text, 'melodi'), original, text);
});

test('quoted sources remain data when the owner gives a separate top-level research instruction', () => {
  const request = parseOwnerResearchRequest(`Investiga la publicación indicada en este texto y explica sus formatos: "${post}"`, { agent: 'melodi' });
  assert.equal(request.sourceUrl, post);
  assert.equal(request.agent, 'melodi');
});

test('an unambiguous referenced public link can come from trusted message context', () => {
  const request = parseOwnerResearchRequest('Quiero todos los formatos de esta publicación y cómo hacerlos por correo.', { agent: 'melodi', links: [post] });
  assert.equal(request.sourceUrl, post);
  assert.equal(request.channel, 'email');
  assert.equal(parseOwnerResearchRequest('Envíame un correo nuevo.', { agent: 'melodi', links: [post] }), null);
});

test('third-party email targets and multiple post sources never receive an owner-only automatic grant', () => {
  assert.equal(parseOwnerResearchRequest(`Investiga los formatos y envía el informe a other@example.com: ${post}`, { agent: 'melodi' }), null);
  const owner = parseOwnerResearchRequest(`Investiga los formatos y envía el informe a owner@example.com: ${post}`, { agent: 'melodi', ownerEmail: 'owner@example.com' });
  assert.equal(owner.recipient, 'owner');
  assert.equal(parseOwnerResearchRequest(`Investiga los formatos: ${post} https://instagram.com/reel/OTHER/`, { agent: 'melodi' }), null);
});

test('explicit recurring assignments stay with the recurring workflow', () => {
  assert.equal(parseOwnerResearchRequest('Investiga este perfil cada viernes y mándame un informe por correo: https://instagram.com/vetsa/', { agent: 'melodi' }), null);
  assert.equal(parseOwnerResearchRequest(`Investiga esta publicación de la semana pasada y explica sus formatos: ${post}`, { agent: 'melodi' }).scope, 'single_post');
});

test('unsafe links and unsupported Instagram endpoints cannot become public research targets', () => {
  for (const url of ['http://instagram.com/p/POST/', 'https://instagram.com.evil.test/p/POST/', 'https://user:pass@instagram.com/p/POST/',
    'https://instagram.com/direct/', 'https://instagram.com/accounts/login/', 'https://localhost/p/POST/', 'javascript:alert(1)']) assert.equal(publicInstagramResearchUrl(url), null);
  assert.equal(publicInstagramResearchUrl('https://instagram.com/vetsa/').scope, 'profile');
  assert.equal(publicInstagramResearchUrl(post).sourceUrl, post);
});
