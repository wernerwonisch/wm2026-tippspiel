// Excel (.xlsx) lesen und schreiben ohne externe Bibliothek.

import { createZip, readZip } from './zip.js';

const dec = new TextDecoder();
const xmlUnesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function colName(i) {
  let s = '';
  i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** Liest alle Tabellenblätter. Rückgabe: [{ name, rows: (string|number)[][] }] */
export async function readXlsx(buffer) {
  const files = await readZip(buffer);
  const txt = (n) => (files[n] ? dec.decode(files[n]) : '');
  const shared = [];
  for (const si of txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(xmlUnesc([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
  }
  const rels = {};
  for (const m of txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnesc(m[0].match(/name="([^"]+)"/)?.[1] || 'Blatt');
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    const path = 'xl/' + (rels[rid] || `worksheets/sheet${sheets.length + 1}.xml`);
    const xml = txt(path);
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const row = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const t = attrs.match(/t="([^"]+)"/)?.[1];
        const inner = c[2] || '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[+v] ?? '';
        else if (t === 'inlineStr') val = xmlUnesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (t === 'str' || t === 'e') val = xmlUnesc(v || '');
        else if (t === 'b') val = v === '1' ? 'WAHR' : 'FALSCH';
        else if (v !== undefined) val = Number(v);
        const idx = ref ? colIndex(ref) : row.length;
        while (row.length < idx) row.push('');
        row[idx] = val;
      }
      rows.push(row);
    }
    sheets.push({ name, rows: rows.filter((r) => r.some((x) => x !== '' && x !== null)) });
  }
  return sheets;
}

const isoToSerial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
};

/**
 * sheets: [{ name, rows, widths? }] – Zellen: string | number | { v, t: 'eur'|'date'|'bold'|'pct' }
 * 'eur'-Zellen erwarten Cent (Integer).
 */
export function writeXlsx(sheets) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;;[Red]\\-#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="DD.MM.YYYY"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
</styleSheet>`;
  const files = [];
  const sheetXml = sheets.map((sh) => {
    const rowsXml = sh.rows.map((row, ri) => {
      const cells = row.map((cell, ci) => {
        if (cell === null || cell === undefined || cell === '') return '';
        const ref = colName(ci) + (ri + 1);
        const o = typeof cell === 'object' ? cell : { v: cell };
        if (o.v === null || o.v === undefined || o.v === '') return '';
        if (o.t === 'eur') return `<c r="${ref}" s="${o.bold ? 4 : 1}"><v>${Math.round(o.v) / 100}</v></c>`;
        if (o.t === 'date') return `<c r="${ref}" s="2"><v>${isoToSerial(o.v)}</v></c>`;
        if (typeof o.v === 'number') return `<c r="${ref}"${o.t === 'bold' ? ' s="3"' : ''}><v>${o.v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${o.t === 'bold' ? ' s="3"' : ''}><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const freeze = sh.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rowsXml}</sheetData></worksheet>`;
  });
  const safeName = (n, i) => xmlEsc(String(n).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Blatt${i + 1}`);
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${safeName(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  files.push({ name: 'xl/styles.xml', data: styles });
  sheetXml.forEach((x, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x }));
  return createZip(files);
}
