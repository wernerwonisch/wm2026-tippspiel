// Auswertungen: E/A-Rechnung (E1a-Kennzahlen), Journal, Kontensalden.

import { bewerte, E1A_KZ, GRENZEN } from './tax.js';
import { afaJahr } from './afa.js';
import { anteil } from './money.js';

export function byId(list) {
  const m = {};
  for (const x of list || []) m[x.id] = x;
  return m;
}

/** Bewertete Journalzeilen eines Zeitraums (sortiert nach Datum). */
export function journal(buchungen, kategorien, perioden, von, bis) {
  const kat = byId(kategorien);
  return buchungen
    .filter((b) => b.datum >= von && b.datum <= bis)
    .sort((a, b) => a.datum.localeCompare(b.datum) || (a.id || 0) - (b.id || 0))
    .map((b) => ({ b, k: kat[b.kategorie_id] || null, r: bewerte(b, kat[b.kategorie_id], perioden) }));
}

export function eaRechnung({ buchungen, kategorien, anlagen, perioden, jahr }) {
  const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
  const zeilen = journal(buchungen, kategorien, perioden, von, bis);
  const kz = {};
  const proKategorie = {};
  const offen = [];
  const hinweise = [];
  for (const z of zeilen) {
    if (!z.k) { offen.push(z.b); continue; }
    if (z.r.hinweis) hinweise.push({ buchung: z.b, text: z.r.hinweis });
    if (!z.r.kz || !z.r.ea) continue;
    kz[z.r.kz] = (kz[z.r.kz] || 0) + z.r.ea;
    const key = z.k.id;
    proKategorie[key] ??= { kategorie: z.k, summe: 0, anzahl: 0, kz: z.r.kz, typ: z.r.typ };
    proKategorie[key].summe += z.r.ea;
    proKategorie[key].anzahl++;
  }

  const anlagenZeilen = (anlagen || []).map((a) => ({ a, w: afaJahr(a, jahr) }))
    .filter((x) => x.w.bwAnfang || x.w.afa || x.w.abgangBuchwert || x.a.datum.startsWith(String(jahr)));
  const afaSumme = anlagenZeilen.reduce((s, x) => s + x.w.afaBetrieblich, 0);
  const abgangSumme = anlagenZeilen.reduce((s, x) => s + x.w.abgangBetrieblich, 0);
  if (afaSumme) kz['9130'] = (kz['9130'] || 0) + afaSumme;
  if (abgangSumme) kz['9210'] = (kz['9210'] || 0) + abgangSumme;

  let ertraege = 0, aufwendungen = 0;
  for (const [k, v] of Object.entries(kz)) {
    if (Number(k) < 9100) ertraege += v; else aufwendungen += v;
  }
  const gewinn = ertraege - aufwendungen;
  const grundfreibetrag = gewinn > 0 ? anteil(Math.min(gewinn, GRENZEN.grundfreibetragBasis), GRENZEN.grundfreibetragProzent) : 0;

  const kennzahlen = Object.keys({ ...E1A_KZ, ...kz }).sort()
    .filter((k) => kz[k])
    .map((k) => ({ kz: k, label: E1A_KZ[k] || 'Kennzahl lt. Kategorie', betrag: kz[k] }));

  return {
    jahr, kennzahlen, ertraege, aufwendungen, gewinn, grundfreibetrag,
    proKategorie: Object.values(proKategorie).sort((a, b) => a.kz.localeCompare(b.kz) || b.summe - a.summe),
    anlagen: anlagenZeilen, afaSumme, abgangSumme, offen, hinweise, anzahl: zeilen.length,
  };
}

/** Saldo je Zahlungskonto (Anfangssaldo + Bewegungen bis Stichtag) – zum Abgleich mit Kontoauszug. */
export function kontenSalden(buchungen, konten, bis) {
  return konten.map((k) => {
    let saldo = Number(k.anfangssaldo) || 0, anzahl = 0;
    for (const b of buchungen) {
      if (b.konto_id !== k.id || b.datum > bis) continue;
      if (k.anfangssaldo_datum && b.datum < k.anfangssaldo_datum) continue;
      saldo += b.betrag; anzahl++;
    }
    return { konto: k, saldo, anzahl };
  });
}
