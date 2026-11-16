import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBytes } from '../owner-features.js';

const decode = bytes => Buffer.from(bytes).toString('latin1');

function verifyXref(bytes) {
  const pdf = decode(bytes);
  const offset = Number(pdf.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);
  assert.ok(Number.isInteger(offset));
  assert.equal(pdf.slice(offset, offset + 4), 'xref');
  const match = pdf.slice(offset).match(/^xref\n0 (\d+)\n([\s\S]+?)trailer/);
  const entries = match[2].trim().split('\n');
  assert.equal(entries.length, Number(match[1]));
  for (let object = 1; object < entries.length; object++) {
    const start = Number(entries[object].slice(0, 10));
    assert.equal(pdf.slice(start, start + `${object} 0 obj`.length), `${object} 0 obj`);
  }
  for (const stream of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(stream[2].length, Number(stream[1]));
  return pdf;
}

test('generic PDF preserves Spanish accents, declares fonts and builds byte-correct xref streams', () => {
  const document = documentBytes('pdf', 'Informe de edición y diseño\n\nMÉTRICAS Y PERÍODO\nEspaña, niña, hipótesis y visualización. UTC−04:00.');
  assert.equal(document.mimeType, 'application/pdf');
  const pdf = verifyXref(document.bytes);
  assert.ok(pdf.includes('edición')); assert.ok(pdf.includes('España')); assert.ok(pdf.includes('niña'));
  assert.ok(pdf.includes('UTC-04:00'));
  assert.match(pdf, /Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /Página 1 de 1/);
});

test('long unbroken URLs are wrapped without losing their characters', () => {
  const url = `https://www.instagram.com/reel/example/?context=${'W'.repeat(800)}`;
  const pdf = verifyXref(documentBytes('pdf', `Informe\n\nFUENTES\n${url}`).bytes);
  const parts = [...pdf.matchAll(/\(([^()]*)\) Tj ET/g)].map(match => match[1]);
  const first = parts.findIndex(value => value.startsWith('https://'));
  const recovered = parts.slice(first).filter(value => !value.startsWith('Página')).join('');
  assert.equal(recovered, url);
  assert.ok(parts.filter(value => value.includes('W')).length > 5);
  assert.ok(parts.every(value => value.length < 130));
});

test('long documents paginate with numbered pages and every page font resource intact', () => {
  const lines = Array.from({ length: 220 }, (_, index) => `Línea ${index + 1}: revisión de edición, evidencia y próximos pasos.`);
  const pdf = verifyXref(documentBytes('pdf', `Informe extenso\n\n${lines.join('\n')}`).bytes);
  const count = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)?.[1]);
  assert.ok(count >= 4);
  assert.equal([...pdf.matchAll(/\/Type \/Page \/Parent/g)].length, count);
  assert.equal([...pdf.matchAll(/\/Font << \/F1 3 0 R \/F2 4 0 R/g)].length, count);
  for (let page = 1; page <= count; page++) assert.ok(pdf.includes(`Página ${page} de ${count}`));
  assert.ok(pdf.includes('Línea 220:'));
});
