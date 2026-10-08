// Exporte für den Steuerberater. Neue Formate (RZL, DATEV …) als weiteren Eintrag in EXPORTER ergänzen.

import { eaRechnung, journal, kontenSalden, byId } from './reports.js';
import { uva, UVA_KZ, STEUERCODES, ustStatus } from './tax.js';
import { zeitraum, fmtDate } from './dates.js';
import { writeXlsx } from './xlsx.js';

const eur = (v, bold) => ({ v: v || 0, t: 'eur', bold });
const b = (v) => ({ v, t: 'bold' });

/** Datenpaket: { buchungen (Jahr), alleBuchungen (bis Jahresende, für Salden), kategorien, konten, anlagen, belege, settings } */
export function jahresabschlussSheets(d, jahr) {
  const perioden = d.settings.ust_perioden || [];
  const ea = eaRechnung({ buchungen: d.buchungen, kategorien: d.kategorien, anlagen: d.anlagen, perioden, jahr });
  const kat = byId(d.kategorien);
  const kto = byId(d.konten);
  const belegAnz = {};
  for (const x of d.belege || []) if (x.buchung_id) belegAnz[x.buchung_id] = (belegAnz[x.buchung_id] || 0) + 1;

  const firma = d.settings.firma || {};
  const uebersicht = [
    [b(`Einnahmen-Ausgaben-Rechnung ${jahr}`)],
    [firma.name || ''], [firma.steuernummer ? `Steuernummer: ${firma.steuernummer}` : ''], [firma.uid ? `UID: ${firma.uid}` : ''],
    [`USt-Status: ${statusText(perioden, jahr)}`],
    [],
    [b('KZ'), b('Bezeichnung (E1a)'), b('Betrag')],
    ...ea.kennzahlen.map((k) => [k.kz, k.label, eur(k.betrag)]),
    [],
    ['', b('Summe Betriebseinnahmen'), eur(ea.ertraege, true)],
    ['', b('Summe Betriebsausgaben'), eur(ea.aufwendungen, true)],
    ['', b('Gewinn / Verlust (vor Freibeträgen)'), eur(ea.gewinn, true)],
    ['', 'Grundfreibetrag (15 %, max. von 33.000 €) – Info', eur(ea.grundfreibetrag)],
    [],
    ['Hinweise:'],
    [`Buchungen ohne Kategorie: ${ea.offen.length}`],
    ['Kennzahlenzuordnung vor Abgabe mit der aktuellen Ausfüllhilfe (E 2) bzw. dem Steuerberater abgleichen.'],
  ];

  const kategorien = [
    [b('KZ'), b('Kategorie'), b('Typ'), b('Anzahl'), b('Betrag')],
    ...ea.proKategorie.map((p) => [p.kz, p.kategorie.name, p.typ === 'E' ? 'Einnahme' : 'Ausgabe', p.anzahl, eur(p.summe)]),
  ];

  const zeilen = journal(d.buchungen, d.kategorien, perioden, `${jahr}-01-01`, `${jahr}-12-31`);
  const journalRows = [[
    b('Nr'), b('Datum'), b('Beleg-Nr'), b('Konto'), b('Partner'), b('Text'), b('Kategorie'), b('KZ'), b('Steuercode'),
    b('Betrag (Konto)'), b('Netto'), b('USt'), b('Vorsteuer'), b('E/A-Betrag'), b('Privat %'), b('Belege'), b('Status'),
  ]];
  zeilen.forEach((z, i) => journalRows.push([
    i + 1, { v: z.b.datum, t: 'date' }, z.b.beleg_nr || '', kto[z.b.konto_id]?.name || '', z.b.partner || '', z.b.text || '',
    z.k?.name || '— ohne Kategorie —', z.r.kz || '', z.b.steuercode || z.k?.steuercode || '',
    eur(z.b.betrag), eur(z.r.netto), eur(z.r.ust), eur(z.r.vst), eur(z.r.ea), z.b.privat_prozent || 0,
    belegAnz[z.b.id] || (z.b.eigenbeleg ? 'Eigenbeleg' : 0), z.b.geprueft ? 'geprüft' : 'offen',
  ]));

  const periodeTyp = d.settings.uva_zeitraum === 'monat' ? 'monat' : 'quartal';
  const perList = periodeTyp === 'monat' ? Array.from({ length: 12 }, (_, i) => String(i + 1)) : ['Q1', 'Q2', 'Q3', 'Q4'];
  const uvaRes = perList.map((p) => { const [v, bis] = zeitraum(jahr, p); return uva(d.buchungen, kat, perioden, v, bis); });
  const kzKeys = Object.keys(UVA_KZ);
  const uvaRows = [
    [b('KZ'), b('Bezeichnung'), ...perList.map((p) => b(periodeTyp === 'monat' ? `${p.padStart(2, '0')}/${jahr}` : `${p}/${jahr}`)), b('Jahr')],
    ...kzKeys.map((k) => {
      const vals = uvaRes.map((u) => u.kz[k] || 0);
      return [k, UVA_KZ[k], ...vals.map((v) => eur(v)), eur(vals.reduce((s, v) => s + v, 0), true)];
    }),
    [],
    ['', 'USt 20 % (aus KZ 022)', ...uvaRes.map((u) => eur(u.steuer['022'])), eur(uvaRes.reduce((s, u) => s + u.steuer['022'], 0))],
    ['', 'USt 10 % (aus KZ 029)', ...uvaRes.map((u) => eur(u.steuer['029'])), eur(uvaRes.reduce((s, u) => s + u.steuer['029'], 0))],
    ['', 'USt 13 % (aus KZ 006)', ...uvaRes.map((u) => eur(u.steuer['006'])), eur(uvaRes.reduce((s, u) => s + u.steuer['006'], 0))],
  ];

  const anlagenRows = [
    [b('Bezeichnung'), b('Anschaffung'), b('AK netto/brutto'), b('ND Jahre'), b('GWG'), b('BW 1.1.'), b('AfA'), b('Abgang BW'), b('BW 31.12.'), b('Privat %'), b('AfA betrieblich')],
    ...ea.anlagen.map(({ a, w }) => [a.bezeichnung, { v: a.datum, t: 'date' }, eur(a.ak), a.nutzungsdauer, a.gwg ? 'ja' : 'nein', eur(w.bwAnfang), eur(w.afa), eur(w.abgangBuchwert), eur(w.bwEnde), a.privat_prozent || 0, eur(w.afaBetrieblich)]),
    [],
    ['', '', '', '', '', b('Summe'), eur(ea.anlagen.reduce((s, x) => s + x.w.afa, 0), true), '', '', '', eur(ea.afaSumme, true)],
  ];

  const kontenRows = [
    [b('Konto'), b('Art'), b('IBAN'), b('Buchungen'), b(`Saldo 31.12.${jahr}`)],
    ...kontenSalden(d.alleBuchungen || d.buchungen, d.konten, `${jahr}-12-31`).map((s) => [s.konto.name, s.konto.art || '', s.konto.iban || '', s.anzahl, eur(s.saldo)]),
    [], ['Saldo mit Kontoauszug zum 31.12. abgleichen.'],
  ];

  return [
    { name: 'E1a Übersicht', rows: uebersicht, widths: [8, 60, 18] },
    { name: 'Kategorien', rows: kategorien, widths: [8, 45, 12, 10, 16] },
    { name: 'Journal', rows: journalRows, widths: [6, 11, 12, 16, 24, 50, 30, 7, 10, 14, 14, 12, 12, 14, 8, 9, 9], freeze: true },
    { name: 'UVA', rows: uvaRows, widths: [6, 55, ...perList.map(() => 13), 14] },
    { name: 'Anlagenverzeichnis', rows: anlagenRows, widths: [32, 12, 15, 8, 6, 14, 14, 14, 14, 8, 15] },
    { name: 'Konten', rows: kontenRows, widths: [24, 12, 26, 10, 16] },
  ];
}

function statusText(perioden, jahr) {
  const a = ustStatus(`${jahr}-01-01`, perioden);
  const wechsel = (perioden || []).filter((p) => p.ab > `${jahr}-01-01` && p.ab <= `${jahr}-12-31`);
  const t = (s) => (s === 'KU' ? 'Kleinunternehmer' : 'vorsteuerabzugsberechtigt');
  return [t(a), ...wechsel.map((w) => `ab ${fmtDate(w.ab)} ${t(w.status)}`)].join(', ');
}

/**
 * BMD-NTCS-Buchungsimport (CSV, Strichpunkt). VORLAGE: Sachkonten (Kategorie.konto) und Zahlungskonten
 * (Konto.sachkonto) müssen mit dem Kontenplan der Kanzlei übereinstimmen – vor Erstimport abstimmen.
 */
export function bmdCsv(d, jahr) {
  const perioden = d.settings.ust_perioden || [];
  const kto = byId(d.konten);
  const zeilen = journal(d.buchungen, d.kategorien, perioden, `${jahr}-01-01`, `${jahr}-12-31`);
  const n = (c) => (c / 100).toFixed(2).replace('.', ',');
  const q = (s) => `"${String(s || '').replace(/"/g, "'").replace(/[\r\n;]+/g, ' ').slice(0, 60)}"`;
  const out = ['satzart;konto;gkonto;belegnr;belegdat;buchsymbol;buchcode;prozent;steuercode;betrag;steuer;text'];
  const fehlend = new Set();
  for (const z of zeilen) {
    if (!z.k || z.k.typ === 'N') continue;
    const sach = z.k.konto || ''; const geld = kto[z.b.konto_id]?.sachkonto || '';
    if (!sach) fehlend.add(z.k.name);
    if (!geld) fehlend.add(`Zahlungskonto ${kto[z.b.konto_id]?.name || '?'}`);
    const code = z.b.steuercode || z.k.steuercode || '0';
    const satz = z.r.status === 'REGEL' ? STEUERCODES[code]?.satz || 0 : 0;
    const steuercode = code === 'RC20' ? 19 : code === 'IGE20' ? 9 : satz ? 1 : 0; // BMD-Steuercodes: mit Kanzlei abstimmen
    const sym = kto[z.b.konto_id]?.art === 'kassa' ? 'KA' : 'BK';
    const buchcode = z.b.betrag >= 0 ? 2 : 1;
    const steuer = z.k.typ === 'E' ? z.r.ust : z.r.vst;
    out.push([0, sach, geld, q(z.b.beleg_nr || z.b.id), fmtDate(z.b.datum), sym, buchcode, satz, steuercode, n(Math.abs(z.b.betrag)), n(Math.abs(steuer)), q(`${z.b.partner || ''} ${z.b.text || ''}`.trim())].join(';'));
  }
  return { csv: out.join('\r\n') + '\r\n', fehlend: [...fehlend] };
}

export const EXPORTER = {
  excel: {
    label: 'Excel – Jahresabschluss-Paket (E1a, Journal, UVA, Anlagen, Konten)',
    run: (d, jahr) => ({ name: `EA-Rechnung_${jahr}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: writeXlsx(jahresabschlussSheets(d, jahr)) }),
  },
  bmd: {
    label: 'BMD NTCS Buchungsimport (CSV, Vorlage – Konten mit Kanzlei abstimmen)',
    run: (d, jahr) => {
      const r = bmdCsv(d, jahr);
      return { name: `BMD_Buchungen_${jahr}.csv`, mime: 'text/csv', data: '﻿' + r.csv, warnung: r.fehlend.length ? `Ohne Kontonummer: ${r.fehlend.join(', ')}` : null };
    },
  },
  // rzl: { label: 'RZL', run: … }, datev: { label: 'DATEV (EXTF)', run: … }
};
