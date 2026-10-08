// Datumserkennung für Bank-, PayPal-, Stripe-, SumUp- und Excel-Exporte. Ergebnis immer ISO "YYYY-MM-DD".

const pad = (n) => String(n).padStart(2, '0');

function valid(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONATE = {
  jan: 1, jän: 1, jaen: 1, feb: 2, mär: 3, mrz: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

/**
 * Ermittelt anhand mehrerer Beispielwerte, ob "a/b/yyyy" als Tag/Monat (AT) oder Monat/Tag (US) zu lesen ist.
 * @returns {'dmy'|'mdy'}
 */
export function detectDateOrder(samples) {
  let dmy = 0, mdy = 0;
  for (const s of samples) {
    const m = String(s || '').trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++;
    if (b > 12 && a <= 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/** Excel-Seriennummer (1900-System) → ISO. */
export function excelSerialToISO(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseDate(input, order = 'dmy') {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date && !isNaN(input)) {
    return valid(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  if (typeof input === 'number') return input > 20000 && input < 80000 ? excelSerialToISO(input) : null;
  const s = String(input).trim();

  // ISO: 2026-03-31, 2026-03-31T10:00:00Z, 2026/03/31, 20260331
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);

  // 31.03.2026, 31.03.26, 03/31/2026, 31-03-2026
  m = s.match(/^(\d{1,2})([./\-])(\d{1,2})\2(\d{2,4})/);
  if (m) {
    let y = +m[4];
    if (y < 100) y += 2000;
    const a = +m[1], b = +m[3];
    const useMdy = m[2] === '/' ? order === 'mdy' : false;
    return useMdy ? valid(y, a, b) : valid(y, b, a);
  }

  // 31. März 2026 / 31 Mar 2026 / Mar 31, 2026
  m = s.match(/^(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,})\.?\s+(\d{4})/);
  if (m) {
    const mon = MONATE[m[2].toLowerCase().slice(0, 3)];
    return mon ? valid(+m[3], mon, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONATE[m[1].toLowerCase().slice(0, 3)];
    return mon ? valid(+m[3], mon, +m[2]) : null;
  }
  // Excel-Seriennummer als Text
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(+s);
  return null;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Liefert [von, bis] (inklusive) für Monat (1–12) oder Quartal ('Q1'–'Q4') oder ganzes Jahr. */
export function zeitraum(jahr, periode) {
  if (!periode || periode === 'jahr') return [`${jahr}-01-01`, `${jahr}-12-31`];
  if (/^Q[1-4]$/.test(periode)) {
    const q = +periode[1];
    const m1 = (q - 1) * 3 + 1, m3 = q * 3;
    return [`${jahr}-${pad(m1)}-01`, `${jahr}-${pad(m3)}-${pad(lastDay(jahr, m3))}`];
  }
  const m = +periode;
  return [`${jahr}-${pad(m)}-01`, `${jahr}-${pad(m)}-${pad(lastDay(jahr, m))}`];
}

function lastDay(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
