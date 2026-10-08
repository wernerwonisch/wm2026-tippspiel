// Steuerlogik Österreich: Umsatzsteuer (Ist-Besteuerung), UVA-Kennzahlen (U30), E/A-Rechnung (E1a).
// Methode: Nettosystem, sobald Vorsteuerabzug besteht; als Kleinunternehmer Bruttobeträge.
// Der USt-Status (Kleinunternehmer / regelbesteuert) gilt ab einem Stichtag und kann unterjährig wechseln.

import { nettoAusBrutto, anteil } from './money.js';

export const GRENZEN = {
  kleinunternehmerBrutto: 5500000, // 55.000 € Jahresumsatz brutto (ab 2025), Toleranz 10 % einmal in 5 Jahren
  gwg: 100000,                     // geringwertige Wirtschaftsgüter bis 1.000 € (ab 2023)
  grundfreibetragBasis: 3300000,   // Gewinngrundfreibetrag: 15 % von max. 33.000 € (ab 2024)
  grundfreibetragProzent: 15,
};

export const STEUERCODES = {
  '20':    { label: '20 % USt/VSt', satz: 20, inland: true },
  '10':    { label: '10 % USt/VSt', satz: 10, inland: true },
  '13':    { label: '13 % USt/VSt', satz: 13, inland: true },
  '0':     { label: '0 % – steuerfrei / ohne USt', satz: 0 },
  'RC20':  { label: 'Reverse Charge 20 % (Leistung aus EU/Drittland, § 19)', satz: 20, rc: true },
  'IGE20': { label: 'Innergem. Erwerb 20 % (Waren aus EU)', satz: 20, ige: true },
  'IGL':   { label: 'Innergem. Lieferung (steuerfrei)', satz: 0 },
  'NSTB':  { label: 'Nicht steuerbar (Leistungsort im Ausland)', satz: 0 },
};

const KZ_SATZ = { 20: '022', 10: '029', 13: '006' };

export const UVA_KZ = {
  '000': 'Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen',
  '016': 'davon steuerfrei: Kleinunternehmer (§ 6 Abs. 1 Z 27)',
  '017': 'davon steuerfrei: innergemeinschaftliche Lieferungen',
  '020': 'davon steuerfrei: übrige steuerfreie Umsätze ohne Vorsteuerabzug',
  '022': 'Bemessungsgrundlage 20 %',
  '029': 'Bemessungsgrundlage 10 %',
  '006': 'Bemessungsgrundlage 13 %',
  '057': 'Steuerschuld gem. § 19 Abs. 1 zweiter Satz (Reverse Charge)',
  '070': 'Innergemeinschaftliche Erwerbe – Gesamtbetrag Bemessungsgrundlagen',
  '072': 'davon igE zu 20 % (Bemessungsgrundlage)',
  '060': 'Gesamtbetrag der Vorsteuern',
  '065': 'Vorsteuern aus innergemeinschaftlichem Erwerb',
  '066': 'Vorsteuern gem. § 19 Abs. 1 zweiter Satz (Reverse Charge)',
  '095': 'Vorauszahlung (+) / Überschuss (−)',
};

// Standardzuordnung E1a. In den Kategorien änderbar – vor Abgabe mit Steuerberater bzw. Ausfüllhilfe E 2 abgleichen.
export const E1A_KZ = {
  '9040': 'Erlöse/Betriebseinnahmen (Waren, Leistungen)',
  '9060': 'Anlagenerträge / Erlöse aus Anlagenverkauf',
  '9090': 'Übrige Erträge/Betriebseinnahmen',
  '9100': 'Waren, Rohstoffe, Hilfsstoffe',
  '9110': 'Beigestelltes Personal (Fremdpersonal) und Fremdleistungen',
  '9120': 'Personalaufwand (eigenes Personal)',
  '9130': 'Abschreibungen auf das Anlagevermögen (AfA, GWG)',
  '9160': 'Reise- und Fahrtspesen inkl. Kilometergeld und Diäten',
  '9170': 'Kfz-Aufwand (ohne AfA, Leasing, Kilometergeld)',
  '9180': 'Miet- und Pachtaufwand, Leasing',
  '9190': 'Provisionen an Dritte, Lizenzgebühren',
  '9200': 'Werbe- und Repräsentationsaufwand, Spenden, Trinkgelder',
  '9210': 'Buchwert abgehender Anlagen',
  '9220': 'Zinsen und ähnliche Aufwendungen',
  '9225': 'Eigene Pflichtversicherungsbeiträge (SVS)',
  '9230': 'Übrige Aufwendungen/Betriebsausgaben',
};

/** Kategorie-Typen: E=Einnahme, A=Ausgabe, ANL=Anlagekauf (AfA statt Sofortaufwand), UST=Finanzamt USt, N=neutral/privat */
export const KATEGORIE_TYPEN = {
  E: 'Einnahme', A: 'Ausgabe', ANL: 'Anlagekauf (AfA)', UST: 'Finanzamt Umsatzsteuer', N: 'Neutral / privat / Umbuchung',
};

/** Status zum Stichtag. perioden: [{ab:'YYYY-MM-DD', status:'KU'|'REGEL'}] */
export function ustStatus(datum, perioden) {
  const list = [...(perioden || [])].sort((a, b) => a.ab.localeCompare(b.ab));
  let st = list.length ? list[0].status : 'KU';
  for (const p of list) if (p.ab <= datum) st = p.status;
  return st;
}

/**
 * Bewertet eine Buchung steuerlich.
 * buchung.betrag: Cent, Vorzeichen aus Sicht des Kontos (+ Eingang, − Ausgang).
 * Rückgabe:
 *   ea   – Betrag für die E/A-Rechnung (Einnahme bzw. Ausgabe positiv; Gutschriften/Erstattungen negativ)
 *   kz   – E1a-Kennzahl
 *   uva  – Bemessungsgrundlagen/Beträge je UVA-Kennzahl
 *   ust  – geschuldete USt (inkl. Reverse Charge / igE), vst – abziehbare Vorsteuer
 */
export function bewerte(buchung, kategorie, perioden) {
  const status = ustStatus(buchung.datum, perioden);
  const r = { status, typ: kategorie?.typ || null, ea: 0, kz: null, netto: 0, ust: 0, vst: 0, uva: {}, hinweis: null };
  if (!kategorie) { r.hinweis = 'Keine Kategorie'; return r; }

  const typ = kategorie.typ;
  const code = buchung.steuercode || kategorie.steuercode || '0';
  const sc = STEUERCODES[code] || STEUERCODES['0'];
  const betr = 100 - (Number(buchung.privat_prozent) || 0);
  const add = (kz, v) => { if (v) r.uva[kz] = (r.uva[kz] || 0) + v; };

  if (typ === 'N') return r;

  if (typ === 'UST') {
    // Regelbesteuert (Nettosystem): Zahlungen/Gutschriften des Finanzamts sind erfolgsneutral.
    // Kleinunternehmer: z. B. Reverse-Charge-USt ist nicht abziehbar → Betriebsausgabe bei Zahlung.
    if (status === 'KU') { r.ea = -buchung.betrag; r.kz = kategorie.kz || '9230'; r.typ = 'A'; }
    return r;
  }

  if (typ === 'E') {
    const x = buchung.betrag;
    r.kz = kategorie.kz || '9040';
    if (status === 'KU') {
      r.netto = x; r.ea = x;
      if (code !== 'NSTB') { add('000', x); add('016', x); }
      return r;
    }
    if (sc.inland) {
      r.netto = nettoAusBrutto(x, sc.satz);
      r.ust = x - r.netto;
      add('000', r.netto); add(KZ_SATZ[sc.satz], r.netto);
    } else {
      r.netto = x;
      if (code === 'IGL') { add('000', x); add('017', x); }
      else if (code === '0') { add('000', x); add('020', x); }
      else if (code !== 'NSTB') { r.hinweis = `Steuercode ${code} passt nicht zu einer Einnahme`; }
    }
    r.ea = r.netto;
    return r;
  }

  // Ausgabe (A) oder Anlagekauf (ANL)
  const x = -buchung.betrag;
  // Kein Vorsteuerabzug als Kleinunternehmer, bei gesperrten Kategorien (z. B. Pkw) und aus Eigenbelegen.
  const vstErlaubt = status === 'REGEL' && kategorie.vst_abzug !== 0 && kategorie.vst_abzug !== false && !buchung.eigenbeleg;
  let netto = x, vstVoll = 0;
  if (sc.inland) {
    netto = nettoAusBrutto(x, sc.satz);
    vstVoll = x - netto;
    if (vstErlaubt) add('060', anteil(vstVoll, betr));
  } else if (sc.rc || sc.ige) {
    const steuer = anteil(x, sc.satz);
    r.ust = steuer;
    vstVoll = steuer;
    if (sc.rc) {
      add('057', steuer);
      if (vstErlaubt) add('066', anteil(steuer, betr));
    } else {
      add('070', x); add('072', x); r.uva.ust072 = steuer;
      if (vstErlaubt) add('065', anteil(steuer, betr));
    }
  }
  r.netto = netto;
  r.vst = vstErlaubt ? anteil(vstVoll, betr) : 0;
  if (typ === 'ANL') { r.kz = null; return r; } // Aufwand über AfA im Anlagenverzeichnis

  // Ohne Vorsteuerabzug ist die inländische USt Teil der Kosten. Reverse-Charge-USt wird bei
  // fehlendem Abzug erst bei Zahlung an das Finanzamt (Kategorie-Typ UST) Aufwand.
  const kosten = vstErlaubt || !sc.inland ? netto : x;
  const abzug = kategorie.abzug_prozent ?? 100;
  r.ea = anteil(anteil(kosten, betr), abzug);
  r.kz = kategorie.kz || '9230';
  return r;
}

/** Summiert die UVA-Kennzahlen für einen Zeitraum und berechnet Zahllast/Gutschrift (KZ 095). */
export function uva(buchungen, kategorienById, perioden, von, bis) {
  const kz = {};
  let ustInland = 0, anzahl = 0;
  const ohneKategorie = [];
  for (const b of buchungen) {
    if (b.datum < von || b.datum > bis) continue;
    const k = kategorienById[b.kategorie_id];
    if (!k) { ohneKategorie.push(b); continue; }
    const r = bewerte(b, k, perioden);
    for (const [key, v] of Object.entries(r.uva)) kz[key] = (kz[key] || 0) + v;
    if (r.typ === 'E') ustInland += r.ust;
    anzahl++;
  }
  const steuer022 = Math.round((kz['022'] || 0) * 0.20);
  const steuer029 = Math.round((kz['029'] || 0) * 0.10);
  const steuer006 = Math.round((kz['006'] || 0) * 0.13);
  const ustIge = kz.ust072 || 0;
  const schuld = steuer022 + steuer029 + steuer006 + (kz['057'] || 0) + ustIge;
  const vorsteuer = (kz['060'] || 0) + (kz['065'] || 0) + (kz['066'] || 0);
  kz['095'] = schuld - vorsteuer;
  return {
    kz, anzahl, ohneKategorie,
    steuer: { '022': steuer022, '029': steuer029, '006': steuer006, '072': ustIge },
    ustLautBelegen: ustInland, // Summe der USt aus den Einzelbuchungen – Rundungsdifferenzen zur UVA sind normal
    schuld, vorsteuer, zahllast: kz['095'],
  };
}

/** Umsatz für die Kleinunternehmergrenze (brutto, nur steuerbare Inlandsumsätze). */
export function kuUmsatz(buchungen, kategorienById, jahr) {
  let sum = 0;
  for (const b of buchungen) {
    if (!b.datum.startsWith(String(jahr))) continue;
    const k = kategorienById[b.kategorie_id];
    if (!k || k.typ !== 'E' || k.kz === '9060') continue; // Hilfsgeschäfte (Anlagenverkauf) zählen nicht
    const code = b.steuercode || k.steuercode || '0';
    if (code === 'NSTB' || code === 'IGL') continue;
    sum += b.betrag;
  }
  return sum;
}
