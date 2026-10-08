import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../public/core/money.js';
import { parseDate, detectDateOrder, zeitraum } from '../public/core/dates.js';
import { bewerte, uva, ustStatus, kuUmsatz } from '../public/core/tax.js';
import { afaJahr } from '../public/core/afa.js';
import { parseCSV, tableFromRows } from '../public/core/csv.js';
import { guessMapping, rowsToTransactions, detectQuelle, parseCamt, addImportHashes, matchRegel, belegAusText } from '../public/core/importers.js';
import { eaRechnung, byId } from '../public/core/reports.js';
import { writeXlsx, readXlsx } from '../public/core/xlsx.js';
import { jahresabschlussSheets, bmdCsv } from '../public/core/exporters.js';

test('Beträge in verschiedenen Formaten', () => {
  assert.equal(parseAmount('1.234,56'), 123456);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount('-12,50'), -1250);
  assert.equal(parseAmount('12,50-'), -1250);
  assert.equal(parseAmount('€ 1.234,56'), 123456);
  assert.equal(parseAmount('(12.50)'), -1250);
  assert.equal(parseAmount('1.234'), 123400);
  assert.equal(parseAmount('0.99'), 99);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount(12.5), 1250);
  assert.equal(parseAmount('1 234,00 EUR'), 123400);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
});

test('Datumsformate', () => {
  assert.equal(parseDate('31.12.2026'), '2026-12-31');
  assert.equal(parseDate('1.3.26'), '2026-03-01');
  assert.equal(parseDate('2026-03-31T10:00:00Z'), '2026-03-31');
  assert.equal(parseDate('03/31/2026', 'mdy'), '2026-03-31');
  assert.equal(parseDate('31/03/2026'), '2026-03-31');
  assert.equal(parseDate('31. März 2026'), '2026-03-31');
  assert.equal(parseDate(46022), '2025-12-31');
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(detectDateOrder(['03/31/2026', '04/01/2026']), 'mdy');
  assert.deepEqual(zeitraum(2026, 'Q1'), ['2026-01-01', '2026-03-31']);
  assert.deepEqual(zeitraum(2028, '2'), ['2028-02-01', '2028-02-29']);
});

const perioden = [{ ab: '2026-01-01', status: 'KU' }, { ab: '2026-07-01', status: 'REGEL' }];
const kE20 = { id: 1, typ: 'E', kz: '9040', steuercode: '20' };
const kA20 = { id: 2, typ: 'A', kz: '9230', steuercode: '20' };
const kRC = { id: 3, typ: 'A', kz: '9200', steuercode: 'RC20' };
const kPkw = { id: 4, typ: 'A', kz: '9170', steuercode: '20', vst_abzug: 0 };
const kBew = { id: 5, typ: 'A', kz: '9200', steuercode: '10', abzug_prozent: 50 };
const kUST = { id: 6, typ: 'UST', kz: '9230' };
const kANL = { id: 7, typ: 'ANL', kz: '9130', steuercode: '20' };

test('USt-Status wechselt unterjährig', () => {
  assert.equal(ustStatus('2026-06-30', perioden), 'KU');
  assert.equal(ustStatus('2026-07-01', perioden), 'REGEL');
});

test('Kleinunternehmer: brutto, keine Vorsteuer, UVA KZ 016', () => {
  const e = bewerte({ datum: '2026-03-01', betrag: 12000 }, kE20, perioden);
  assert.equal(e.ea, 12000); assert.equal(e.ust, 0);
  assert.equal(e.uva['016'], 12000);
  const a = bewerte({ datum: '2026-03-01', betrag: -12000 }, kA20, perioden);
  assert.equal(a.ea, 12000); assert.equal(a.vst, 0);
});

test('Regelbesteuert: Nettomethode, Vorsteuer, Privatanteil', () => {
  const e = bewerte({ datum: '2026-08-01', betrag: 12000 }, kE20, perioden);
  assert.equal(e.ea, 10000); assert.equal(e.ust, 2000); assert.equal(e.uva['022'], 10000);
  const a = bewerte({ datum: '2026-08-01', betrag: -12000, privat_prozent: 40 }, kA20, perioden);
  assert.equal(a.vst, 1200); assert.equal(a.ea, 6000); assert.equal(a.uva['060'], 1200);
  const gs = bewerte({ datum: '2026-08-01', betrag: -1200 }, kE20, perioden); // Gutschrift an Kunden
  assert.equal(gs.ea, -1000);
});

test('Pkw ohne Vorsteuer, Bewirtung 50 %, Anlagekauf neutral', () => {
  const p = bewerte({ datum: '2026-08-01', betrag: -6000 }, kPkw, perioden);
  assert.equal(p.vst, 0); assert.equal(p.ea, 6000);
  const bw = bewerte({ datum: '2026-08-01', betrag: -11000 }, kBew, perioden);
  assert.equal(bw.vst, 1000); assert.equal(bw.ea, 5000);
  const eb = bewerte({ datum: '2026-08-01', betrag: -1200, eigenbeleg: { grund: 'x' } }, kA20, perioden);
  assert.equal(eb.vst, 0); assert.equal(eb.ea, 1200);
  const an = bewerte({ datum: '2026-08-01', betrag: -240000 }, kANL, perioden);
  assert.equal(an.ea, 0); assert.equal(an.uva['060'], 40000);
});

test('Reverse Charge: 057/066 bei Regelbesteuerung, nur 057 als Kleinunternehmer', () => {
  const r = bewerte({ datum: '2026-08-01', betrag: -10000 }, kRC, perioden);
  assert.equal(r.uva['057'], 2000); assert.equal(r.uva['066'], 2000); assert.equal(r.ea, 10000);
  const k = bewerte({ datum: '2026-02-01', betrag: -10000 }, kRC, perioden);
  assert.equal(k.uva['057'], 2000); assert.equal(k.uva['066'], undefined); assert.equal(k.ea, 10000);
  const z = bewerte({ datum: '2026-02-20', betrag: -2000 }, kUST, perioden);
  assert.equal(z.ea, 2000); // KU: RC-Steuer bei Zahlung Betriebsausgabe
  const z2 = bewerte({ datum: '2026-08-20', betrag: -2000 }, kUST, perioden);
  assert.equal(z2.ea, 0);
});

test('UVA-Zahllast', () => {
  const kat = byId([kE20, kA20, kRC]);
  const bs = [
    { datum: '2026-08-01', betrag: 120000, kategorie_id: 1 },
    { datum: '2026-08-05', betrag: -24000, kategorie_id: 2 },
    { datum: '2026-08-06', betrag: -10000, kategorie_id: 3 },
  ];
  const u = uva(bs, kat, perioden, '2026-07-01', '2026-09-30');
  assert.equal(u.kz['000'], 100000);
  assert.equal(u.steuer['022'], 20000);
  assert.equal(u.kz['060'], 4000);
  assert.equal(u.zahllast, 20000 + 2000 - 4000 - 2000);
});

test('Kleinunternehmergrenze ohne Anlagenverkauf und Auslandsumsätze', () => {
  const kat = byId([kE20, { id: 9, typ: 'E', kz: '9060' }, { id: 10, typ: 'E', kz: '9040', steuercode: 'NSTB' }]);
  const s = kuUmsatz([
    { datum: '2026-01-01', betrag: 1000, kategorie_id: 1 },
    { datum: '2026-01-01', betrag: 5000, kategorie_id: 9 },
    { datum: '2026-01-01', betrag: 7000, kategorie_id: 10 },
  ], kat, 2026);
  assert.equal(s, 1000);
});

test('AfA mit Halbjahresregel, GWG, Abgang', () => {
  const a = { datum: '2026-09-15', ak: 300000, nutzungsdauer: 3 };
  assert.equal(afaJahr(a, 2026).afa, 50000);
  assert.equal(afaJahr(a, 2027).afa, 100000);
  assert.equal(afaJahr(a, 2029).afa, 50000);
  assert.equal(afaJahr(a, 2029).bwEnde, 0);
  assert.equal(afaJahr(a, 2030).afa, 0);
  const g = { datum: '2026-11-01', ak: 89900, nutzungsdauer: 3 };
  assert.equal(afaJahr(g, 2026).afa, 89900);
  const ab = { datum: '2026-01-10', ak: 400000, nutzungsdauer: 4, abgang_datum: '2028-03-01' };
  const w = afaJahr(ab, 2028);
  assert.equal(w.afa, 50000); assert.equal(w.abgangBuchwert, 150000); assert.equal(w.bwEnde, 0);
  assert.equal(afaJahr({ ...a, privat_prozent: 20 }, 2027).afaBetrieblich, 80000);
});

test('Bank-CSV mit Vorspann (George/ELBA-Stil)', () => {
  const csv = '﻿Konto;AT12 3456\n\nBuchungsdatum;Partnername;Partner IBAN;Betrag;Währung;Buchungstext\n02.01.2026;Google Ireland Ltd;IE29AIBK93115212345678;-49,90;EUR;Google Ads\n03.01.2026;Kunde GmbH;AT611904300234573201;1.200,00;EUR;RE 2026-001\n';
  const { rows } = parseCSV(csv);
  const { headers, data } = tableFromRows(rows);
  assert.equal(headers[0], 'Buchungsdatum');
  assert.equal(detectQuelle(headers), 'bank');
  const m = guessMapping(headers);
  const { transaktionen } = rowsToTransactions(data, m);
  assert.equal(transaktionen.length, 2);
  assert.equal(transaktionen[0].betrag, -4990);
  assert.equal(transaktionen[1].partner, 'Kunde GmbH');
  addImportHashes(transaktionen, 1);
  assert.ok(transaktionen[0].import_hash);
  const r = matchRegel(transaktionen[0], [{ muster: 'google', feld: 'alle', richtung: 'A', kategorie_id: 3 }]);
  assert.equal(r.kategorie_id, 3);
});

test('PayPal-Export: Gebühr als eigene Buchung, nur abgeschlossene', () => {
  const csv = '"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Transaktionscode"\n"15.03.2026","10:00:00","CET","Max Muster","Website-Zahlung","Abgeschlossen","EUR","100,00","-3,74","96,26","ABC123"\n"16.03.2026","10:00:00","CET","Erika","Website-Zahlung","Ausstehend","EUR","50,00","0,00","50,00","DEF"\n';
  const { headers, data } = tableFromRows(parseCSV(csv).rows);
  assert.equal(detectQuelle(headers), 'paypal');
  const { transaktionen } = rowsToTransactions(data, guessMapping(headers), { quelle: 'paypal' });
  assert.equal(transaktionen.length, 2);
  assert.equal(transaktionen[0].betrag, 10000);
  assert.equal(transaktionen[1].betrag, -374);
  assert.ok(transaktionen[1].istGebuehr);
});

test('Stripe-Export (englisch, Punkt als Dezimaltrennzeichen)', () => {
  const csv = 'id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Description\ntxn_1,charge,ch_1,120.00,2.05,117.95,eur,2026-04-02 09:12,Kurs\n';
  const { headers, data } = tableFromRows(parseCSV(csv).rows);
  assert.equal(detectQuelle(headers), 'stripe');
  const { transaktionen } = rowsToTransactions(data, guessMapping(headers));
  assert.equal(transaktionen[0].betrag, 12000);
  assert.equal(transaktionen[0].datum, '2026-04-02');
  assert.equal(transaktionen[1].betrag, -205);
});

test('Soll/Haben-Spalten', () => {
  const csv = 'Datum;Text;Soll;Haben\n05.05.2026;Miete;800,00;\n06.05.2026;Honorar;;1.500,00\n';
  const { headers, data } = tableFromRows(parseCSV(csv).rows);
  const { transaktionen } = rowsToTransactions(data, guessMapping(headers));
  assert.deepEqual(transaktionen.map((t) => t.betrag), [-80000, 150000]);
});

test('CAMT.053', () => {
  const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>AT001</IBAN></Id></Acct>
  <Ntry><Amt Ccy="EUR">49.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-02-03</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>A1 Telekom</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Rechnung 123</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-02-04</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kunde &amp; Co</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
  </Stmt></BkToCstmrStmt></Document>`;
  const r = parseCamt(xml);
  assert.equal(r.iban, 'AT001');
  assert.equal(r.transaktionen[0].betrag, -4990);
  assert.equal(r.transaktionen[0].partner, 'A1 Telekom');
  assert.equal(r.transaktionen[1].partner, 'Kunde & Co');
});

test('Beleg-Text auslesen', () => {
  const t = `Musterfirma GmbH\nRechnungsnummer: RE-2026-0042\nDatum: 12.03.2026\nUID: ATU12345678\nNetto 100,00\nUSt 20% 20,00\nGesamtbetrag EUR 120,00`;
  const r = belegAusText(t);
  assert.equal(r.betrag, 12000); assert.equal(r.datum, '2026-03-12');
  assert.equal(r.uid, 'ATU12345678'); assert.equal(r.rechnungsnr, 'RE-2026-0042');
  assert.deepEqual(r.ust_saetze, [20]); assert.equal(r.lieferant, 'Musterfirma GmbH');
});

test('E/A-Rechnung und Excel-Export', async () => {
  const kategorien = [{ ...kE20, name: 'Erlöse' }, { ...kA20, name: 'Sonstiges' }, { ...kANL, name: 'Anlage' }];
  const buchungen = [
    { id: 1, datum: '2026-08-01', betrag: 120000, kategorie_id: 1, konto_id: 1 },
    { id: 2, datum: '2026-08-02', betrag: -24000, kategorie_id: 2, konto_id: 1 },
    { id: 3, datum: '2026-08-03', betrag: -360000, kategorie_id: 7, konto_id: 1 },
    { id: 4, datum: '2026-08-04', betrag: -100, kategorie_id: null, konto_id: 1 },
  ];
  const anlagen = [{ id: 1, bezeichnung: 'Laptop', datum: '2026-08-03', ak: 300000, nutzungsdauer: 3 }];
  const ea = eaRechnung({ buchungen, kategorien, anlagen, perioden, jahr: 2026 });
  assert.equal(ea.ertraege, 100000);
  assert.equal(ea.aufwendungen, 20000 + 50000);
  assert.equal(ea.gewinn, 30000);
  assert.equal(ea.offen.length, 1);
  const d = { buchungen, kategorien, anlagen, konten: [{ id: 1, name: 'Bank', anfangssaldo: 0 }], belege: [], settings: { ust_perioden: perioden } };
  const sheets = jahresabschlussSheets(d, 2026);
  const bytes = writeXlsx(sheets);
  const back = await readXlsx(bytes);
  assert.equal(back.length, 6);
  assert.equal(back[0].rows[0][0], 'Einnahmen-Ausgaben-Rechnung 2026');
  assert.equal(back[2].rows.length, 5);
  const bmd = bmdCsv(d, 2026);
  assert.ok(bmd.csv.startsWith('satzart;'));
  assert.ok(bmd.fehlend.length > 0);
});
