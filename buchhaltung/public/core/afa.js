// Anlagenverzeichnis: lineare AfA nach § 7 EStG mit Halbjahresregel, GWG-Sofortabschreibung.
// Hinweis: degressive AfA (§ 7 Abs. 1a), beschleunigte Gebäude-AfA und Pkw-Luxustangente (40.000 €)
// sind nicht automatisiert – bei Bedarf Anschaffungskosten/Nutzungsdauer entsprechend erfassen.

import { anteil } from './money.js';
import { GRENZEN } from './tax.js';

const jahrVon = (iso) => Number(iso.slice(0, 4));
const monatVon = (iso) => Number(iso.slice(5, 7));

/**
 * AfA-Werte einer Anlage für ein Jahr.
 * anlage: { datum, ak (Cent), nutzungsdauer (Jahre), gwg (bool), abgang_datum?, privat_prozent? }
 */
export function afaJahr(anlage, jahr) {
  const ak = Number(anlage.ak) || 0;
  const start = jahrVon(anlage.datum);
  const res = { bwAnfang: 0, afa: 0, bwEnde: 0, abgangBuchwert: 0, afaBetrieblich: 0, abgangBetrieblich: 0 };
  if (!ak || jahr < start) return res;
  const abgangJahr = anlage.abgang_datum ? jahrVon(anlage.abgang_datum) : null;
  if (abgangJahr !== null && jahr > abgangJahr) return res;

  const gwg = anlage.gwg === true || anlage.gwg === 1 || (anlage.gwg == null && ak <= GRENZEN.gwg);
  const nd = Math.max(1, Number(anlage.nutzungsdauer) || 1);
  const voll = Math.round(ak / nd);
  let bw = ak;

  for (let y = start; y <= jahr; y++) {
    const bwAnfang = bw;
    let a;
    if (gwg) a = y === start ? bw : 0;
    else if (y === start) a = monatVon(anlage.datum) >= 7 ? Math.round(voll / 2) : voll;
    else a = voll;

    if (y === abgangJahr && !gwg && y !== start) {
      a = monatVon(anlage.abgang_datum) <= 6 ? Math.round(voll / 2) : voll;
    }
    a = Math.min(a, bw);
    bw -= a;
    if (y === jahr) {
      res.bwAnfang = bwAnfang;
      res.afa = a;
      if (y === abgangJahr) { res.abgangBuchwert = bw; bw = 0; }
      res.bwEnde = bw;
    }
  }
  const betr = 100 - (Number(anlage.privat_prozent) || 0);
  res.afaBetrieblich = anteil(res.afa, betr);
  res.abgangBetrieblich = anteil(res.abgangBuchwert, betr);
  return res;
}

/** Nutzungsdauer-Vorschläge (Jahre) – Richtwerte, keine Rechtsvorgabe außer Pkw (§ 8 Abs. 6 EStG: mind. 8 Jahre). */
export const NUTZUNGSDAUER = [
  { label: 'Computer, Laptop, Tablet, Smartphone', jahre: 3 },
  { label: 'Software', jahre: 3 },
  { label: 'Büromöbel', jahre: 10 },
  { label: 'Maschinen, Werkzeug', jahre: 5 },
  { label: 'Pkw / Kombi (gesetzlich mind. 8 Jahre)', jahre: 8 },
  { label: 'Lkw, Kastenwagen (Fiskal-Lkw)', jahre: 5 },
  { label: 'Betriebs- und Geschäftsausstattung', jahre: 5 },
];
