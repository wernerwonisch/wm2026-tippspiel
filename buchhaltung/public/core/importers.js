// Import aus Bank-CSV, CAMT.053 (XML), PayPal, Stripe, SumUp, Excel und eigenen Listen.
// Ablauf: Rohzeilen → Spaltenzuordnung (automatisch, manuell änderbar) → Transaktionen → Duplikatprüfung → Regeln.

import { parseAmount } from './money.js';
import { parseDate, detectDateOrder } from './dates.js';

const norm = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Synonyme je Feld, in Prioritätsreihenfolge (exakte Treffer vor Teiltreffern).
const SYN = {
  datum: ['buchungsdatum', 'datum', 'date', 'created utc', 'created', 'transaktionsdatum', 'booking date', 'valutadatum', 'valuta', 'zeitpunkt', 'belegdatum'],
  betrag: ['betrag', 'brutto', 'gross', 'amount', 'betrag inkl mwst', 'umsatz', 'betrag eur', 'summe', 'total'],
  soll: ['soll', 'belastung', 'ausgang', 'debit', 'lastschrift', 'ausgaben'],
  haben: ['haben', 'gutschrift', 'eingang', 'credit', 'einnahmen'],
  gebuehr: ['gebuehr', 'gebuehren', 'fee', 'fees', 'transaktionsgebuehr'],
  text: ['verwendungszweck', 'buchungstext', 'beschreibung', 'description', 'zahlungsreferenz', 'umsatztext', 'text', 'details', 'artikelbezeichnung', 'betreff', 'buchungs info', 'buchungsinfo', 'typ', 'type', 'referenz'],
  partner: ['partnername', 'partner name', 'name', 'auftraggeber', 'empfaenger', 'zahlungsempfaenger', 'auftraggeber empfaenger', 'customer', 'kunde', 'lieferant', 'customer email', 'absender e mail adresse'],
  iban: ['partner iban', 'iban', 'gegenkonto', 'kontonummer'],
  waehrung: ['waehrung', 'currency', 'whrg'],
  status: ['status'],
  referenz: ['transaktionscode', 'transaction id', 'id', 'transaktions id', 'belegnummer', 'beleg nr', 'rechnungsnummer', 'referenz'],
};

/** Erkennt bekannte Exportformate an den Spaltenköpfen. */
export function detectQuelle(headers) {
  const h = headers.map(norm);
  const has = (x) => h.includes(x);
  if ((has('brutto') || has('gross')) && (has('gebuehr') || has('fee')) && (has('netto') || has('net')) && (has('transaktionscode') || has('transaction id') || has('zeitzone') || has('timezone'))) return 'paypal';
  if (has('created utc') || (has('available on utc')) || (has('amount') && has('fee') && has('net') && has('source'))) return 'stripe';
  if (h.some((x) => x.startsWith('transaktions id')) && h.some((x) => x.includes('auszahlung') || x.includes('zahlungsart'))) return 'sumup';
  if (h.some((x) => x.includes('iban')) || has('buchungsdatum') || has('valutadatum')) return 'bank';
  return 'liste';
}

export const QUELLEN = {
  bank: 'Bankkonto (CSV)', camt: 'Bankkonto (CAMT.053 XML)', paypal: 'PayPal', stripe: 'Stripe', sumup: 'SumUp', liste: 'Excel/CSV-Liste',
};

/** Schlägt eine Spaltenzuordnung vor. Rückgabe: { feld: spaltenIndex | spaltenIndex[] } */
export function guessMapping(headers) {
  const h = headers.map(norm);
  const used = new Set();
  const find = (feld, opts = {}) => {
    for (const s of SYN[feld]) {
      const i = h.findIndex((x, idx) => !used.has(idx) && x === s);
      if (i >= 0) return i;
    }
    if (opts.exact) return -1;
    for (const s of SYN[feld]) {
      const i = h.findIndex((x, idx) => !used.has(idx) && (x.startsWith(s + ' ') || x.endsWith(' ' + s)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const take = (feld, opts) => { const i = find(feld, opts); if (i >= 0) used.add(i); return i; };

  const m = {};
  m.datum = take('datum');
  m.betrag = take('betrag'); // bei PayPal/Stripe/SumUp der Bruttobetrag, Gebühr separat
  if (m.betrag < 0) { m.soll = take('soll'); m.haben = take('haben'); }
  m.gebuehr = take('gebuehr', { exact: true });
  m.waehrung = take('waehrung');
  m.status = take('status', { exact: true });
  m.partner = take('partner');
  m.iban = take('iban');
  m.referenz = take('referenz', { exact: true });
  const text = [];
  for (let k = 0; k < 3; k++) { const i = take('text'); if (i >= 0) text.push(i); }
  m.text = text;
  for (const k of Object.keys(m)) if (m[k] === -1) delete m[k];
  return m;
}

const NICHT_GEBUCHT = /(ausstehend|storniert|abgelehnt|failed|refused|declined|canceled|cancelled|offen|fehlgeschlagen)/i;

/**
 * Wandelt Tabellenzeilen anhand der Zuordnung in Transaktionen um.
 * Gebühren (PayPal, Stripe, SumUp) werden als eigene Buchung erzeugt, damit Umsatz brutto bleibt.
 */
export function rowsToTransactions(data, mapping, opts = {}) {
  const order = opts.dateOrder || detectDateOrder(data.map((r) => r[mapping.datum]));
  const out = [];
  const fehler = [];
  data.forEach((r, idx) => {
    const get = (i) => (i === undefined || i < 0 ? '' : r[i] ?? '');
    const datum = parseDate(get(mapping.datum), order);
    let betrag = null;
    if (mapping.betrag !== undefined) betrag = parseAmount(get(mapping.betrag));
    else if (mapping.soll !== undefined || mapping.haben !== undefined) {
      const soll = Math.abs(parseAmount(get(mapping.soll)) || 0);
      const haben = Math.abs(parseAmount(get(mapping.haben)) || 0);
      betrag = haben - soll;
    }
    if (opts.vorzeichenUmkehren && betrag) betrag = -betrag;
    const status = get(mapping.status);
    if (status && NICHT_GEBUCHT.test(status)) return;
    if (!datum || betrag === null || betrag === 0) {
      if (r.some((x) => String(x).trim())) fehler.push({ zeile: idx + 1, grund: !datum ? 'Datum nicht erkannt' : 'Betrag fehlt/0', roh: r });
      return;
    }
    const text = (mapping.text || []).map(get).filter(Boolean).join(' · ');
    const waehrung = get(mapping.waehrung).toUpperCase();
    const tx = {
      datum, betrag, text, partner: get(mapping.partner), iban: get(mapping.iban), referenz: get(mapping.referenz),
      waehrung: waehrung || 'EUR', hinweis: waehrung && waehrung !== 'EUR' ? `Fremdwährung ${waehrung} – Betrag in EUR prüfen` : null,
    };
    out.push(tx);
    const fee = mapping.gebuehr !== undefined ? parseAmount(get(mapping.gebuehr)) : null;
    if (fee) {
      out.push({
        datum, betrag: -Math.abs(fee), text: `Gebühr ${opts.quelle ? QUELLEN[opts.quelle] || '' : ''} ${tx.referenz || text}`.trim(),
        partner: opts.quelle ? QUELLEN[opts.quelle] : 'Zahlungsanbieter', referenz: tx.referenz ? tx.referenz + '-FEE' : '',
        waehrung: tx.waehrung, istGebuehr: true, hinweis: tx.hinweis,
      });
    }
  });
  return { transaktionen: out, fehler, dateOrder: order };
}

/** CAMT.053 / CAMT.052 (ISO 20022) Kontoauszug. */
export function parseCamt(xml) {
  const s = String(xml).replace(/<(\/?)[\w-]+:/g, '<$1');
  const tag = (src, name) => {
    const m = src.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : '';
  };
  const all = (src, name) => [...src.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1].trim());
  const unesc = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const iban = tag(tag(s, 'Acct'), 'IBAN');
  const tx = [];
  for (const e of all(s, 'Ntry')) {
    if (tag(e, 'RvslInd') === 'true') continue;
    const sts = tag(tag(e, 'Sts'), 'Cd') || tag(e, 'Sts');
    if (sts && sts !== 'BOOK') continue;
    const amt = Number(tag(e, 'Amt'));
    const credit = tag(e, 'CdtDbtInd') === 'CRDT';
    const book = tag(e, 'BookgDt');
    const datum = (tag(book, 'Dt') || tag(book, 'DtTm') || tag(tag(e, 'ValDt'), 'Dt')).slice(0, 10);
    const parties = tag(e, 'RltdPties');
    const gegen = credit ? tag(parties, 'Dbtr') : tag(parties, 'Cdtr');
    const partner = tag(gegen, 'Nm') || tag(tag(parties, credit ? 'UltmtDbtr' : 'UltmtCdtr'), 'Nm');
    const gegenIban = tag(tag(parties, credit ? 'DbtrAcct' : 'CdtrAcct'), 'IBAN');
    const text = [...all(e, 'Ustrd'), tag(e, 'AddtlNtryInf'), tag(e, 'AddtlTxInf')].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    tx.push({
      datum, betrag: Math.round(amt * 100) * (credit ? 1 : -1), text: unesc(text), partner: unesc(partner), iban: gegenIban,
      referenz: tag(e, 'AcctSvcrRef') || tag(e, 'EndToEndId'), waehrung: (e.match(/Ccy="([A-Z]{3})"/) || [])[1] || 'EUR',
    });
  }
  return { iban, transaktionen: tx };
}

// --- Duplikatprüfung -------------------------------------------------------

function hashStr(s) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/** Stabiler Fingerabdruck; gleiche Buchungen am selben Tag werden durchnummeriert. */
export function addImportHashes(transaktionen, kontoId) {
  const seen = {};
  for (const t of transaktionen) {
    const base = `${kontoId}|${t.datum}|${t.betrag}|${norm(t.referenz || t.text).slice(0, 80)}`;
    seen[base] = (seen[base] || 0) + 1;
    t.import_hash = hashStr(base) + '-' + seen[base];
  }
  return transaktionen;
}

// --- Regeln ------------------------------------------------------------------

/** regel: { muster, feld: 'alle'|'text'|'partner', richtung: ''|'E'|'A', kategorie_id, steuercode, privat_prozent } */
export function matchRegel(tx, regeln) {
  for (const r of regeln || []) {
    if (!r.muster) continue;
    if (r.richtung === 'E' && tx.betrag < 0) continue;
    if (r.richtung === 'A' && tx.betrag > 0) continue;
    const quelle = r.feld === 'text' ? tx.text : r.feld === 'partner' ? tx.partner : `${tx.partner || ''} ${tx.text || ''} ${tx.iban || ''}`;
    let ok;
    if (/^\/.+\/[a-z]*$/.test(r.muster)) {
      try { const i = r.muster.lastIndexOf('/'); ok = new RegExp(r.muster.slice(1, i), r.muster.slice(i + 1) || 'i').test(quelle || ''); } catch { ok = false; }
    } else ok = String(quelle || '').toLowerCase().includes(r.muster.toLowerCase());
    if (ok) return r;
  }
  return null;
}

// --- Belege zuordnen ---------------------------------------------------------

/** Passende Buchungen zu einem Beleg (Betrag gleich, Datum ±14 Tage). */
export function vorschlaegeFuerBeleg(beleg, buchungen, tage = 14) {
  if (!beleg.betrag) return [];
  const d0 = Date.parse(beleg.datum || '');
  return buchungen
    .filter((b) => Math.abs(Math.abs(b.betrag) - Math.abs(beleg.betrag)) <= 1)
    .map((b) => ({ b, diff: isNaN(d0) ? 0 : Math.abs(Date.parse(b.datum) - d0) / 86400000 }))
    .filter((x) => x.diff <= tage)
    .sort((a, b) => a.diff - b.diff)
    .map((x) => x.b);
}

// --- Beleg-Text (OCR/PDF) auswerten -----------------------------------------

const BETRAG_RE = /(-?\d{1,3}(?:[.\s']\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})(?!\d)/g;

export function belegAusText(text) {
  const t = String(text || '').replace(/\r/g, '');
  const res = { datum: null, betrag: null, ust_saetze: [], uid: null, rechnungsnr: null, lieferant: null };

  const dm = t.match(/\b(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})\b/) || t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dm) res.datum = parseDate(dm[1].replace(/\s/g, ''));

  let best = null;
  const lines = t.split('\n');
  for (const line of lines) {
    if (/(gesamt|summe|total|zu zahlen|zahlbetrag|rechnungsbetrag|endbetrag|brutto|betrag eur|amount due)/i.test(line) && !/(netto|zwischensumme|subtotal|mwst\.?\s*\d|ust\.?\s*\d)/i.test(line)) {
      for (const m of line.matchAll(BETRAG_RE)) {
        const v = parseAmount(m[1]);
        if (v && (best === null || Math.abs(v) > Math.abs(best))) best = v;
      }
    }
  }
  if (best === null) {
    for (const m of t.matchAll(BETRAG_RE)) {
      const v = parseAmount(m[1]);
      if (v && (best === null || Math.abs(v) > Math.abs(best)) && Math.abs(v) < 100000000) best = v;
    }
  }
  res.betrag = best;

  const saetze = new Set();
  for (const m of t.matchAll(/(\d{1,2})(?:[.,]0+)?\s?%/g)) if ([20, 10, 13].includes(+m[1])) saetze.add(+m[1]);
  res.ust_saetze = [...saetze];

  const uid = t.match(/\b(ATU\s?\d{8})\b/i) || t.match(/UID[^A-Z0-9]{0,15}([A-Z]{2}\s?[0-9A-Z]{8,12})/i);
  if (uid) res.uid = uid[1].replace(/\s/g, '').toUpperCase();

  const rn = t.match(/(?:rechnungs?[-\s]?(?:nr|nummer)|re[-.\s]?nr|beleg[-\s]?nr|invoice\s(?:no|number|#))\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/._]{2,})/i);
  if (rn) res.rechnungsnr = rn[1];

  res.lieferant = lines.map((l) => l.trim()).find((l) => l.length > 2 && /[A-Za-zÄÖÜäöü]{3}/.test(l)) || null;
  return res;
}
