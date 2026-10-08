// CSV-Parser ohne Abhängigkeiten: erkennt Trennzeichen, Anführungszeichen, BOM, Kopfzeile.

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  const cands = [';', ',', '\t', '|'];
  let best = ';', bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const freq = {};
    for (const c of counts) freq[c] = (freq[c] || 0) + 1;
    const [mode, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [1, 0];
    const score = Number(mode) > 1 ? n * 100 + Number(mode) : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

function splitLine(line, d) {
  return parseCSV(line, d).rows[0] || [];
}

export function parseCSV(text, delimiter) {
  text = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { q = true; field = ''; i++; continue; }
    if (c === d) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { rows: rows.filter((r) => r.some((x) => String(x).trim() !== '')).map((r) => r.map((x) => String(x).trim())), delimiter: d };
}

const isNumericish = (s) => /^[-+(]?\s*[€$]?\s*[\d.,'\s]+\)?\s*-?$/.test(String(s).trim()) || /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/.test(String(s).trim());

/** Findet die Kopfzeile (Banken setzen oft einige Zeilen Kontoinformationen davor). */
export function findHeaderRow(rows) {
  const lens = rows.slice(0, 200).map((r) => r.length);
  const freq = {};
  for (const l of lens) freq[l] = (freq[l] || 0) + 1;
  const mode = Number(Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0);
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (r.length < Math.min(mode, 2) || r.length < mode - 1) continue;
    const filled = r.filter((x) => x !== '');
    const textual = filled.filter((x) => !isNumericish(x));
    if (filled.length >= 2 && textual.length >= filled.length * 0.7) return i;
  }
  return 0;
}

/** Wandelt Zeilen in Objekte mit Kopfzeile um. */
export function tableFromRows(rows) {
  const h = findHeaderRow(rows);
  const headers = rows[h].map((x, i) => x || `Spalte ${i + 1}`);
  const data = rows.slice(h + 1).filter((r) => r.length >= Math.max(2, headers.length - 3));
  return { headers, data };
}

/** Dekodiert eine Datei als UTF-8, fällt bei ungültigen Zeichen auf Windows-1252 zurück (z. B. ELBA-Exporte). */
export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}
