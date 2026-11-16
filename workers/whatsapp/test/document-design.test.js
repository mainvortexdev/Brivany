import test from 'node:test';
import assert from 'node:assert/strict';
import { documentBytes } from '../owner-features.js';
import { documentBlocks, documentPlainInline } from '../document-design.js';
const source = '**Funciones de Alexa AI para Electro Wisly**\n\n**Alcance**\n\nUna propuesta para **Electro Wisly**, con énfasis en atención y soporte.\n\n1. **Asistencia virtual**\n* Consultar servicios y pedidos\n* Reservar una visita\n\n| Funcionalidad | Estado |\n| --- | --- |\n| Soporte | Propuesta |';
const unzipStored = bytes => {
  const files = new Map(), buf = Buffer.from(bytes); let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size=buf.readUInt32LE(at+18),len=buf.readUInt16LE(at+26),extra=buf.readUInt16LE(at+28),start=at+30+len+extra;
    files.set(buf.subarray(at+30,at+30+len).toString(),buf.subarray(start,start+size).toString());at=start+size;
  }
  return files;
};
test('native DOCX removes Markdown tokens and creates styles, lists, a real table and one Melodi signature', () => {
  const files=unzipStored(documentBytes('docx',source,{signature:true}).bytes),xml=files.get('word/document.xml');
  assert.doesNotMatch(xml,/\*\*|\| ---|>\* /); assert.match(xml,/w:pStyle w:val="Title"/); assert.match(xml,/<w:b\/>/);
  assert.match(xml,/<w:tbl>/); assert.match(xml,/<w:tblHeader\/>/); assert.match(xml,/<w:numPr>/);
  assert.equal((xml.match(/r:embed="rIdMelodiSignature"/g)||[]).length,1); assert.match(xml,/Melodi · Brivany/); assert.match(xml,/emily@vetsa.es/);
  assert.ok(files.has('word/media/melodi-signature.png')); assert.match(files.get('[Content_Types].xml'),/image\/png/);
  assert.match(files.get('word/_rels/document.xml.rels'),/Target="media\/melodi-signature.png"/);
  assert.match(files.get('word/styles.xml'),/w:widowControl/); assert.match(files.get('word/styles.xml'),/w:keepNext/);
  assert.match(files.get('word/_rels/document.xml.rels'),/Target="styles.xml"/);
});
test('PDF and TXT present readable tables and signatures instead of raw Markdown', () => {
  for(const format of ['pdf','txt']) {
    const raw=Buffer.from(documentBytes(format,source,{signature:true}).bytes).toString(format==='pdf'?'latin1':'utf8');
    // Image bytes can contain any ASCII sequence; formatting assertions apply to content streams.
    const value=format==='pdf' ? raw.replace(/(\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n)([\s\S]*?)\nendstream/,(_,head)=>`${head}\nendstream`) : raw;
    assert.doesNotMatch(value,/\*\*|\| ---/); assert.match(value,/Electro Wisly/); assert.match(value,/emily@vetsa.es/);
    if(format==='pdf') { assert.match(value,/\/Subtype \/Image/); assert.match(value,/\/EmilySignature Do/); assert.match(value,/re f/); }
  }
});
test('source syntax is escaped and a signature is only added when explicitly requested by the generator', () => {
  const files=unzipStored(documentBytes('docx','Informe\n<x>&datos **claros**').bytes);
  assert.match(files.get('word/document.xml'),/&lt;x&gt;&amp;datos/); assert.doesNotMatch(files.get('word/document.xml'),/emily@vetsa.es/);
  assert.equal(documentPlainInline('2 * 3 = 6; **clave** y `dato`'),'2 * 3 = 6; clave y dato');
  assert.equal(documentBlocks(source).filter(block=>block.type==='table').length,1);
});
test('PDF paginates long table rows inside the margins and repeats their column headers',()=>{
  const value=Buffer.from(documentBytes('pdf',`Informe\n\n| Concepto | Detalle |\n| --- | --- |\n| Servicio | ${'Información extensa con caracteres áéíóú. '.repeat(150)} |`).bytes).toString('latin1');
  assert.match(value,/\/Count [2-9]/);assert.ok((value.match(/\(Concepto\)/g)||[]).length>1);
  for(const match of value.matchAll(/\d+(?:\.\d+)? (\d+(?:\.\d+)?) \d+(?:\.\d+)? \d+(?:\.\d+)? re f/g)) assert.ok(Number(match[1])>=68);
});
