import { S, ladeBuchungen, ladeState, go } from '../app.js';
import { fmt } from '../core/money.js';
import { fmtDate } from '../core/dates.js';
import { parseCSV, tableFromRows, decodeText } from '../core/csv.js';
import { readXlsx } from '../core/xlsx.js';
import { detectQuelle, guessMapping, rowsToTransactions, parseCamt, addImportHashes, matchRegel, QUELLEN } from '../core/importers.js';
import { api, esc, options, toast, fehler, $, $$ } from '../ui.js';
import { kategorieOptionen } from './buchungen.js';

const FELDER = [
  ['datum', 'Datum *'], ['betrag', 'Betrag (+/−)'], ['soll', 'oder: Soll/Ausgang'], ['haben', 'und: Haben/Eingang'],
  ['gebuehr', 'Gebühr (wird eigene Buchung)'], ['partner', 'Partner/Name'], ['text', 'Text (bis zu 3 Spalten)'],
  ['iban', 'IBAN Gegenkonto'], ['referenz', 'Referenz/Transaktions-ID'], ['waehrung', 'Währung'], ['status', 'Status (nur abgeschlossene)'],
];

let imp = null;

export async function render() {
  imp = { konto_id: imp?.konto_id || S.konten.find((k) => k.aktiv)?.id };
  return `
  <div class="karte">
    <h3>1. Datei wählen</h3>
    <p class="klein">Kontoauszug (CSV oder CAMT.053-XML aus George, ELBA, Bank Austria, N26 …), PayPal-, Stripe-, SumUp-Export
    oder eigene Liste (Excel .xlsx / CSV). Doppelte Buchungen werden automatisch erkannt.</p>
    <div class="raster">
      <label>Zahlungskonto<select id="konto">${options(S.konten.filter((k) => k.aktiv).map((k) => ({ value: k.id, label: k.name })), imp.konto_id)}</select></label>
      <label class="drop" id="drop">Datei hierher ziehen oder <u>auswählen</u>
        <input type="file" id="datei" accept=".csv,.txt,.xlsx,.xml,.camt,.053,text/csv,application/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </label>
    </div>
    <p class="klein">Altes Excel-Format (.xls)? Bitte in Excel als .xlsx oder CSV speichern.</p>
  </div>
  <div id="schritt2"></div>
  <div id="schritt3"></div>`;
}

export async function mount() {
  $('#konto').onchange = (e) => { imp.konto_id = Number(e.target.value); };
  $('#datei').onchange = (e) => e.target.files[0] && lesen(e.target.files[0]);
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('ueber'); };
  drop.ondragleave = () => drop.classList.remove('ueber');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('ueber'); if (e.dataTransfer.files[0]) lesen(e.dataTransfer.files[0]); };
}

const signatur = (headers) => headers.map((h) => String(h).trim().toLowerCase()).join('|');

async function lesen(file) {
  try {
    imp.dateiname = file.name;
    imp.konto_id = Number($('#konto').value);
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b) {
      const sheets = await readXlsx(buf);
      const sheet = sheets.find((s) => s.rows.length > 1) || sheets[0];
      if (!sheet) throw new Error('Keine Daten in der Excel-Datei');
      return tabelle(sheet.rows.map((r) => r.map((x) => (typeof x === 'number' ? x : String(x ?? '')))));
    }
    const text = decodeText(buf);
    if (/^\s*<\?xml|<Document[\s>]/.test(text.slice(0, 500)) && /<(\w+:)?Ntry>/.test(text)) {
      const r = parseCamt(text);
      imp.quelle = 'camt';
      const k = S.konten.find((x) => x.iban && r.iban && x.iban.replace(/\s/g, '') === r.iban);
      if (k) { imp.konto_id = k.id; $('#konto').value = k.id; }
      $('#schritt2').innerHTML = `<div class="karte"><h3>2. Erkannt: ${QUELLEN.camt}</h3><p>${r.transaktionen.length} Buchungen${r.iban ? `, Konto ${esc(r.iban)}` : ''}.</p></div>`;
      return vorschau(r.transaktionen, []);
    }
    const { rows } = parseCSV(text);
    if (!rows.length) throw new Error('Datei ist leer oder nicht lesbar');
    tabelle(rows);
  } catch (e) { fehler(e); }
}

function tabelle(rows) {
  const { headers, data } = tableFromRows(rows);
  imp.headers = headers; imp.data = data;
  imp.quelle = detectQuelle(headers.map(String));
  const prof = S.importprofile.find((p) => p.signatur === signatur(headers));
  imp.mapping = prof?.mapping || guessMapping(headers.map(String));
  imp.vorzeichenUmkehren = !!prof?.mapping?.vorzeichenUmkehren;
  if (prof?.konto_id && S.kto[prof.konto_id]) { imp.konto_id = prof.konto_id; $('#konto').value = prof.konto_id; }
  zuordnung(!!prof);
}

function zuordnung(gespeichert) {
  const spalten = imp.headers.map((h, i) => ({ value: i, label: `${String.fromCharCode(65 + (i % 26))}: ${h}` }));
  const sel = (feld) => {
    if (feld === 'text') {
      const t = imp.mapping.text || [];
      return [0, 1, 2].map((n) => `<select data-feld="text" data-n="${n}">${options(spalten, t[n], { leer: '—' })}</select>`).join('');
    }
    return `<select data-feld="${feld}">${options(spalten, imp.mapping[feld], { leer: '—' })}</select>`;
  };
  $('#schritt2').innerHTML = `
  <div class="karte">
    <h3>2. Spalten zuordnen <span class="badge">${esc(QUELLEN[imp.quelle] || imp.quelle)}</span> ${gespeichert ? '<span class="badge ok">gespeicherte Zuordnung</span>' : ''}</h3>
    <p class="klein">Automatisch erkannt – bitte kurz prüfen. Die Zuordnung wird für dieses Dateiformat gespeichert.</p>
    <div class="zuordnung">${FELDER.map(([f, l]) => `<label>${esc(l)}${sel(f)}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" id="umkehren" ${imp.vorzeichenUmkehren ? 'checked' : ''}> Vorzeichen umkehren (falls Ausgaben positiv in der Datei stehen)</label>
    <div class="scroll"><table class="tab klein"><thead><tr>${imp.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${imp.data.slice(0, 5).map((r) => `<tr>${imp.headers.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="klein">${imp.data.length} Datenzeilen</p>
    <div class="aktionen"><button class="prim" id="weiter">Weiter zur Vorschau</button></div>
  </div>`;
  $('#weiter').onclick = () => {
    const m = { text: [] };
    for (const s of $$('#schritt2 select[data-feld]')) {
      if (s.value === '') continue;
      if (s.dataset.feld === 'text') m.text.push(Number(s.value)); else m[s.dataset.feld] = Number(s.value);
    }
    if (m.datum === undefined || (m.betrag === undefined && m.soll === undefined && m.haben === undefined)) return toast('Datum und Betrag (oder Soll/Haben) zuordnen', 'err');
    imp.mapping = m;
    imp.vorzeichenUmkehren = $('#umkehren').checked;
    const r = rowsToTransactions(imp.data, m, { quelle: imp.quelle, vorzeichenUmkehren: imp.vorzeichenUmkehren });
    vorschau(r.transaktionen, r.fehler);
  };
}

async function vorschau(transaktionen, fehlerZeilen) {
  try {
    addImportHashes(transaktionen, imp.konto_id);
    const vorhanden = new Set(await api('hashes'));
    const gebuehrKat = S.kategorien.find((k) => /gebühren/i.test(k.name) && k.typ === 'A');
    for (const t of transaktionen) {
      t.doppelt = vorhanden.has(t.import_hash);
      t.auswahl = !t.doppelt;
      const r = matchRegel(t, S.regeln);
      if (r) { t.kategorie_id = r.kategorie_id; t.steuercode = r.steuercode || null; t.privat_prozent = r.privat_prozent || 0; t.regel = true; }
      else if (t.istGebuehr && gebuehrKat) t.kategorie_id = gebuehrKat.id;
    }
    imp.tx = transaktionen;
    const neu = transaktionen.filter((t) => !t.doppelt).length;
    $('#schritt3').innerHTML = `
    <div class="karte">
      <h3>3. Vorschau</h3>
      <p>${neu} neue Buchungen, ${transaktionen.length - neu} bereits vorhanden${fehlerZeilen.length ? `, <span class="warn">${fehlerZeilen.length} Zeilen nicht lesbar</span>` : ''}.
      Kategorien kommen aus Ihren Regeln – offene können Sie hier oder später zuordnen.</p>
      ${fehlerZeilen.length ? `<details><summary>Nicht lesbare Zeilen</summary><ul class="klein">${fehlerZeilen.slice(0, 20).map((f) => `<li>Zeile ${f.zeile}: ${esc(f.grund)} – ${esc(f.roh.join(' | ').slice(0, 120))}</li>`).join('')}</ul></details>` : ''}
      <div class="scroll"><table class="tab buchungen">
        <thead><tr><th><input type="checkbox" id="imp-alle" checked aria-label="Alle"></th><th>Datum</th><th>Partner / Text</th><th>Kategorie</th><th class="r">Betrag</th></tr></thead>
        <tbody>${transaktionen.map((t, i) => `<tr data-i="${i}" class="${t.doppelt ? 'doppelt' : ''}">
          <td><input type="checkbox" class="imp-sel" ${t.auswahl ? 'checked' : ''}></td>
          <td class="nw">${fmtDate(t.datum)}${t.doppelt ? '<br><small>vorhanden</small>' : ''}</td>
          <td class="txt"><b>${esc(t.partner || '')}</b> <span>${esc(t.text || '')}</span>${t.hinweis ? `<br><small class="warn">${esc(t.hinweis)}</small>` : ''}</td>
          <td><select class="imp-kat ${t.kategorie_id ? '' : 'leer'}">${kategorieOptionen(t.kategorie_id, '— später —')}</select>${t.regel ? '<small> Regel</small>' : ''}</td>
          <td class="r nw ${t.betrag < 0 ? 'neg' : 'pos'}">${fmt(t.betrag)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="aktionen"><button class="prim" id="importieren">Ausgewählte importieren</button></div>
    </div>`;
    $('#schritt3').onchange = (e) => {
      if (e.target.id === 'imp-alle') { imp.tx.forEach((t) => { if (!t.doppelt) t.auswahl = e.target.checked; }); $$('.imp-sel').forEach((c, i) => { c.checked = imp.tx[i].auswahl; }); return; }
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const t = imp.tx[Number(tr.dataset.i)];
      if (e.target.classList.contains('imp-sel')) t.auswahl = e.target.checked;
      if (e.target.classList.contains('imp-kat')) { t.kategorie_id = Number(e.target.value) || null; t.steuercode = null; }
    };
    $('#importieren').onclick = importieren;
    $('#schritt3').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { fehler(e); }
}

async function importieren() {
  const list = imp.tx.filter((t) => t.auswahl).map((t) => ({
    datum: t.datum, betrag: t.betrag, konto_id: imp.konto_id, kategorie_id: t.kategorie_id || null, steuercode: t.steuercode || null,
    privat_prozent: t.privat_prozent || 0, text: t.text, partner: t.partner, iban: t.iban, referenz: t.referenz,
    quelle: `${imp.quelle}:${imp.dateiname || ''}`.slice(0, 120), import_hash: t.import_hash, notiz: t.hinweis || '',
  }));
  if (!list.length) return toast('Nichts ausgewählt', 'warn');
  try {
    const r = await api('buchungen', { method: 'POST', body: list });
    if (imp.headers && imp.quelle !== 'camt') {
      const sig = signatur(imp.headers);
      const vorh = S.importprofile.find((p) => p.signatur === sig);
      const body = { signatur: sig, name: imp.dateiname, quelle: imp.quelle, konto_id: imp.konto_id, mapping: { ...imp.mapping, vorzeichenUmkehren: imp.vorzeichenUmkehren } };
      await api(vorh ? `importprofile/${vorh.id}` : 'importprofile', { method: vorh ? 'PUT' : 'POST', body });
    }
    toast(`${r.neu} Buchungen importiert${r.doppelt ? `, ${r.doppelt} doppelt übersprungen` : ''}.`);
    await ladeState();
    const jahre = [...new Set(list.map((t) => Number(t.datum.slice(0, 4))))];
    if (!jahre.includes(S.jahr)) S.jahr = Math.max(...jahre);
    await ladeBuchungen(true);
    go('#/buchungen/ungeprueft');
  } catch (e) { fehler(e); }
}
