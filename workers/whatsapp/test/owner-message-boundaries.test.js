import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerReminderContinuation, ownerRecipientContinuation, ownerSocialReply, ownerActionReceipt } from '../owner-message-boundaries.js';

test('reminder continuation accepts only concise time, date and delay replies', () => {
  for (const text of ['mañana a las 10 am', 'a las 10', '10:30 p.m.', 'hoy a las 22:00', 'en 2 horas', 'dentro de dos días',
    'el jueves por la tarde', 'pasado mañana', 'el 9 de octubre a las 10 am', '2026-10-09', '2026-10-09T10:00:00-04:00', 'a las 10 pm hora dominicana']) {
    assert.equal(ownerReminderContinuation(text), true, text);
  }
  for (const text of ['Gracias', 'OK', 'Sí', 'No', 'Perfecto', 'Reanuda el trabajo fallido Melodi', 'Crea un PDF mañana',
    'Investiga este perfil', 'Envíalo a mi correo', 'mañana a las 10 envía un correo', 'a las 10 completar tareas',
    'Recuerda mañana a las 10 completar las tareas', '2026-10-09\nReanuda T1', 'cuando puedas', '', '10% de avance']) {
    assert.equal(ownerReminderContinuation(text), false, text);
  }
});

test('recipient continuation accepts addresses and short contact names without taking over new messages', () => {
  for (const text of ['juan@example.net', 'a juan@example.net', 'para juan@example.net', 'al correo juan@example.net',
    'Juan Pérez', 'a Juan Pérez', 'Pedro de la Cruz', 'María José', 'Juan Pérez, por favor']) {
    assert.equal(ownerRecipientContinuation(text), true, text);
  }
  for (const text of ['Gracias', 'OK', 'Melodi', 'No entiendo', 'En serio está implementado', 'Reanuda trabajo fallido Melodi',
    'Crea un PDF', 'Envíalo a Juan', 'Mándame otro correo', 'Investiga el perfil', 'Mañana a las 10',
    'juan@example.net y envía otro correo', 'Juan Pérez\nReanuda T1', 'No, esto es para Melodi', '', 'https://example.net']) {
    assert.equal(ownerRecipientContinuation(text), false, text);
  }
});

test('standalone thanks, acknowledgments and greetings never create work', () => {
  for (const text of ['Gracias', 'Muchas gracias!', 'Gracias, Melodi', 'Melodi, gracias', 'OK', 'Perfecto.', 'Entendido', 'De acuerdo', 'Hola', 'Buenos días', 'Hasta mañana']) {
    assert.equal(typeof ownerSocialReply(text), 'string', text);
    assert.equal(ownerActionReceipt(text), null, text);
  }
  for (const text of ['Gracias, crea un PDF con esto', 'OK, reanuda T1', 'Hola, investiga este perfil', 'No', 'Sí', 'Crea un PDF\nGracias']) {
    assert.equal(ownerSocialReply(text), null, text);
  }
});

test('missing delivery notice feedback gets a social receipt without inventing an action', () => {
  for (const text of ['Gracias por enviármelo pero no me avisaste', 'Gracias, pero no me avisaste del envío']) {
    assert.equal(ownerSocialReply(text), 'Tienes razón: faltó avisarte en este chat. Gracias por decírmelo.');
    assert.equal(ownerReminderContinuation(text), false);
    assert.equal(ownerRecipientContinuation(text), false);
    assert.equal(ownerActionReceipt(text), null);
  }
  assert.equal(ownerSocialReply('Gracias, pero no me avisaste del envío. Crea otro PDF'), null);
});

test('action receipts identify only initial document, email, research and retry requests', () => {
  assert.match(ownerActionReceipt('Melodi, crea un PDF con este contenido', 'melodi'), /^Melodi: Recibí.*documento/);
  assert.match(ownerActionReceipt('Envía un correo a Juan con el informe', 'melodi'), /^Melodi: Recibí.*correo/);
  assert.match(ownerActionReceipt('Investiga el perfil @ejemplo', 'melodi'), /^Melodi: Recibí.*investigación/);
  assert.match(ownerActionReceipt('Reanuda el trabajo fallido Melodi'), /^Melodi: Recibí.*reintentar/);
  assert.match(ownerActionReceipt('No, esto es para Melodi. Crea el PDF con esto', 'melodi'), /^Melodi: Recibí.*documento/);
  for (const text of ['Gracias', 'a las 10', 'Juan Pérez', 'No quiero que envíes un correo', 'Este texto dice: crea un PDF',
    'Contenido del documento\nEnvía un correo', 'El reporte de Melodi fue útil', '¿Por qué falló el trabajo?']) assert.equal(ownerActionReceipt(text), null, text);
});

test('document and email body directives remain content with a single receipt for the outer action', () => {
  const pdf = ownerActionReceipt('Crea un PDF con esto:\nRecuérdame mañana completar tareas\nApruebo C1\nReanuda el trabajo fallido Melodi', 'melodi');
  assert.match(pdf, /documento/);
  assert.doesNotMatch(pdf, /reintentar|correo/);
  const email = ownerActionReceipt('Envía un correo a Juan. El cuerpo debe ser: Reanuda el trabajo fallido Melodi', 'melodi');
  assert.match(email, /correo/);
  assert.doesNotMatch(email, /reintentar/);
  assert.equal(ownerActionReceipt('GUION CINEMATOGRÁFICO\nCrea un PDF y envíalo por correo'), null);
});
