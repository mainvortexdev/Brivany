// Formatting is deterministic. Source material never supplies executable instructions.
import { MELODI_SIGNATURE_IMAGE } from './melodi-signature-asset.js';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function documentInlineRuns(value) {
  const runs = [], pattern = /\*\*([^\n]+?)\*\*|__([^\n]+?)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])/g;
  let end = 0;
  for (const match of String(value).matchAll(pattern)) {
    if (match.index > end) runs.push({ text: value.slice(end, match.index) });
    runs.push({ text: match[1] || match[2] || match[3] || (match[4] ? `${match[4]} (${match[5]})` : match[6]),
      bold: Boolean(match[1] || match[2]), italic: Boolean(match[6]), code: Boolean(match[3]) });
    end = match.index + match[0].length;
  }
  if (end < value.length) runs.push({ text: value.slice(end) });
  return runs;
}
export const documentPlainInline = value => documentInlineRuns(String(value)).map(run => run.text).join('');
export function documentTableWidths(rows, total = 9360) {
  const weights = rows[0].map((_, col) => Math.max(9, Math.min(45, Math.max(...rows.map(row => documentPlainInline(row[col] || '').length)))));
  const sum = weights.reduce((a,b) => a+b,0), widths = weights.map(weight => Math.floor(total*weight/sum));
  widths[widths.length-1] += total-widths.reduce((a,b)=>a+b,0); return widths;
}

export function documentBlocks(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').trim().split('\n'), blocks = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (!line || (!fenced && /^[-*_]{3,}$/.test(line))) continue;
    if (!fenced && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = item => item.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
      const rows = [cells(line)]; i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]));
      if (rows[0].length <= 8) { blocks.push({ type: 'table', rows }); continue; }
      blocks.push(...rows.map(row => ({ type: 'paragraph', text: row.join(' · ') }))); continue;
    }
    if (fenced) { blocks.push({ type: 'code', text: lines[i] }); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const list = /^(?:([-*+] |•\s+)|(\d+)[.)]\s+)(.+)$/.exec(line);
    const standalone = /^\*\*(.+)\*\*$/.exec(line);
    if (heading || standalone || (/^[A-ZÁÉÍÓÚÑ\d\s]{3,90}$/.test(line) && /[A-ZÁÉÍÓÚÑ]/.test(line))) {
      blocks.push({ type: blocks.length ? 'heading' : 'title', level: heading ? Math.min(2, heading[1].length) : 1,
        text: heading?.[2] || standalone?.[1] || line });
    } else if (list) blocks.push({ type: 'list', text: list[3], number: list[2] || null });
    else blocks.push({ type: blocks.length ? 'paragraph' : 'title', text: line.replace(/^>\s*/, '') });
  }
  return blocks;
}

function runsXml(text, { color, size, font, italic } = {}) {
  return documentInlineRuns(text).map(run => `<w:r><w:rPr>${run.bold ? '<w:b/>' : ''}${run.italic || italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}${font || run.code ? `<w:rFonts w:ascii="${font || 'Consolas'}" w:hAnsi="${font || 'Consolas'}"/>` : ''}</w:rPr><w:t xml:space="preserve">${escape(run.text)}</w:t></w:r>`).join('');
}
const p = (text, style = 'Normal', extra = '', runOptions) => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${runsXml(text, runOptions)}</w:p>`;

export const MELODI_SIGNATURE = Object.freeze({ name: 'Melodi', role: 'Asistente de Brivany', brand: 'Brivany', email: 'emily@vetsa.es' });
export function melodiSignatureXml() {
  const cx=2743200,cy=Math.round(cx*MELODI_SIGNATURE_IMAGE.height/MELODI_SIGNATURE_IMAGE.width);
  const graphic=`<w:p><w:pPr><w:keepNext/><w:spacing w:before="100" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Firma de Melodi" descr="Melodi · Brivany"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="melodi-signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdMelodiSignature"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  return p('Elaborado por', 'SignatureLabel', '<w:keepNext/>')
    + graphic
    + p('Brivany', 'SignatureLabel', '<w:keepNext/>')
    + p('emily@vetsa.es', 'SignatureLabel');
}

export function professionalDocxParts(text, { signature = false } = {}) {
  const blocks = documentBlocks(text), columnsWidth = 9360;
  let body = '';
  for (const block of blocks) {
    if (block.type !== 'table') {
      const style = block.type === 'title' ? 'Title' : block.type === 'heading' ? `Heading${block.level}` : block.type === 'code' ? 'Code' : block.type === 'list' ? 'ListParagraph' : 'Normal';
      const numbering = block.type === 'list' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
      body += p(block.number ? `${block.number}. ${block.text}` : block.text, style, block.number ? '' : numbering);
      continue;
    }
    const count = block.rows[0].length;
    // Descriptions get more room; short status/index columns remain compact.
    const widths = documentTableWidths(block.rows,columnsWidth);
    body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="130" w:type="dxa"/><w:right w:w="130" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
    body += block.rows.map((row, index) => `<w:tr><w:trPr>${index === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${widths.map((width, col) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/><w:shd w:fill="${index === 0 ? '243447' : index % 2 ? 'FFFFFF' : 'F3F6F9'}"/></w:tcPr>${p(row[col] || '', index === 0 ? 'TableHeader' : 'TableText')}</w:tc>`).join('')}</w:tr>`).join('') + '</w:tbl>' + p('', 'TableSpacer');
  }
  if (signature) body += melodiSignatureXml();
  const style = (id, name, options = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${options}</w:style>`;
  const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Brivany Editorial" w:hAnsi="Brivany Editorial"/><w:sz w:val="22"/><w:color w:val="000000"/><w:lang w:val="es-DO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title','Title','<w:pPr><w:keepNext/><w:spacing w:after="300"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="38"/><w:b/><w:color w:val="000000"/></w:rPr>')}${[1,2].map(level => style(`Heading${level}`,`heading ${level}`,`<w:pPr><w:keepNext/><w:outlineLvl w:val="${level - 1}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${level === 1 ? 26 : 23}"/><w:color w:val="000000"/></w:rPr>`)).join('')}${style('ListParagraph','List Paragraph','<w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="80"/></w:pPr>')}${style('TableText','Table Text','<w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>')}${style('TableHeader','Table Header','<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="FFFFFF"/></w:rPr>')}${style('TableSpacer','Table Spacer','<w:rPr><w:sz w:val="8"/></w:rPr>')}${style('Code','Code','<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr>')}${style('SignatureLabel','Signature Label','<w:pPr><w:spacing w:before="80" w:after="40"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="475569"/></w:rPr>')}${style('SignatureName','Signature Name','<w:pPr><w:spacing w:after="60"/></w:pPr>')}</w:styles>`;
  const numbering = '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  return [
    { name: '[Content_Types].xml', data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + (signature ? '<Default Extension="png" ContentType="image/png"/>' : '') + ['document','styles','numbering'].map(part => `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part === 'document' ? 'document.main' : part}+xml"/>`).join('') + '</Types>' },
    { name: '_rels/.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbers" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + (signature ? '<Relationship Id="rIdMelodiSignature" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/melodi-signature.png"/>' : '') + '</Relationships>' },
    { name: 'word/document.xml', data: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1200" w:right="1440" w:bottom="1200" w:left="1440"/></w:sectPr></w:body></w:document>` },
    { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering },
  ].map(part => ({ ...part, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${part.data}` })).concat(signature ? [{ name:'word/media/melodi-signature.png',data:Uint8Array.from(atob(MELODI_SIGNATURE_IMAGE.pngBase64),character=>character.charCodeAt(0)) }] : []);
}
