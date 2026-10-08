// Beträge werden durchgehend als ganze Cent (Integer) geführt, um Rundungsfehler zu vermeiden.

const fmtEUR = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });
const fmtNum = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmt(cents) {
  return fmtEUR.format((cents || 0) / 100);
}

export function fmtPlain(cents) {
  return fmtNum.format((cents || 0) / 100);
}

/** Cent → Dezimalzahl (für Excel-Export). */
export function toNumber(cents) {
  return Math.round(cents || 0) / 100;
}

/**
 * Liest Beträge in allen üblichen Schreibweisen:
 * "1.234,56"  "1,234.56"  "-12,50"  "12,50-"  "€ 1.234,56"  "(12.50)"  "1234"  12.5 (Zahl)
 * Gibt Cent zurück oder null, wenn nichts Sinnvolles erkennbar ist.
 */
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*[-−–]/.test(s)) { neg = true; s = s.replace(/^\s*[-−–]/, ''); }
  if (/^\s*\+/.test(s)) s = s.replace(/^\s*\+/, '');
  s = s.replace(/(EUR|€|\s| |')/gi, '');
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart, decPart = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? ',' : '.';
    const idx = Math.max(lastComma, lastDot);
    intPart = s.slice(0, idx).replace(/[.,]/g, '');
    decPart = s.slice(idx + 1);
    if (decSep === '.' && decPart.length === 3 && s.split('.').length > 2) { intPart += decPart; decPart = ''; }
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length > 2) {
      // "1.234.567" → nur Tausendertrennzeichen
      intPart = parts.join('');
    } else if (sep === '.' && tail.length === 3 && /^[1-9]\d{0,2}$/.test(parts[0])) {
      // "1.234" ist im deutschsprachigen Raum ein Tausenderpunkt
      intPart = parts.join('');
    } else {
      // "12.5" / "12,50" → Dezimaltrennzeichen
      intPart = parts[0];
      decPart = tail;
    }
  } else {
    intPart = s;
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  if (!intPart && !decPart) return null;
  const dec = (decPart + '00').slice(0, 2);
  const rest = decPart.length > 2 ? Number('0.' + decPart.slice(2)) : 0;
  let cents = Number(intPart || '0') * 100 + Number(dec) + (rest >= 0.5 ? 1 : 0);
  return neg ? -cents : cents;
}

/** Brutto → Netto bei gegebenem Steuersatz (in Prozent), kaufmännisch gerundet. */
export function nettoAusBrutto(bruttoCents, satz) {
  if (!satz) return bruttoCents;
  return Math.round((bruttoCents * 100) / (100 + satz));
}

/** Prozentanteil eines Cent-Betrags, kaufmännisch gerundet (auch für negative Beträge symmetrisch). */
export function anteil(cents, prozent) {
  const v = (Math.abs(cents) * prozent) / 100;
  return Math.sign(cents) * Math.round(v);
}
