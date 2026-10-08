// Startdaten: Kategorien mit E1a-Kennzahl und Standard-Steuercode, Konten, Beispielregeln.
// vst_abzug: 0 = kein Vorsteuerabzug (z. B. Pkw), abzug_prozent: ertragsteuerlich abzugsfähiger Anteil.

export const KATEGORIEN = [
  // Einnahmen
  { name: 'Erlöse 20 %', typ: 'E', kz: '9040', steuercode: '20' },
  { name: 'Erlöse 10 %', typ: 'E', kz: '9040', steuercode: '10' },
  { name: 'Erlöse 13 %', typ: 'E', kz: '9040', steuercode: '13' },
  { name: 'Erlöse Ausland/EU B2B (nicht steuerbar)', typ: 'E', kz: '9040', steuercode: 'NSTB' },
  { name: 'Innergemeinschaftliche Lieferungen', typ: 'E', kz: '9040', steuercode: 'IGL' },
  { name: 'Erlöse Anlagenverkauf', typ: 'E', kz: '9060', steuercode: '20' },
  { name: 'Sonstige Erträge (Zinsen, Förderungen, Versicherungsersatz)', typ: 'E', kz: '9090', steuercode: '0' },
  // Ausgaben
  { name: 'Wareneinkauf, Material', typ: 'A', kz: '9100', steuercode: '20' },
  { name: 'Fremdleistungen, Subunternehmer', typ: 'A', kz: '9110', steuercode: '20' },
  { name: 'Personalaufwand (Löhne, Lohnnebenkosten)', typ: 'A', kz: '9120', steuercode: '0' },
  { name: 'Geringwertige Wirtschaftsgüter (bis 1.000 €)', typ: 'A', kz: '9130', steuercode: '20' },
  { name: 'Reisekosten, Kilometergeld, Diäten', typ: 'A', kz: '9160', steuercode: '0' },
  { name: 'Kfz-Kosten Pkw (Treibstoff, Service, Versicherung)', typ: 'A', kz: '9170', steuercode: '20', vst_abzug: 0 },
  { name: 'Kfz-Kosten Fiskal-Lkw / E-Auto (mit Vorsteuer)', typ: 'A', kz: '9170', steuercode: '20' },
  { name: 'Miete, Pacht, Leasing', typ: 'A', kz: '9180', steuercode: '20' },
  { name: 'Provisionen, Lizenzgebühren', typ: 'A', kz: '9190', steuercode: '20' },
  { name: 'Werbung, Marketing (Inland)', typ: 'A', kz: '9200', steuercode: '20' },
  { name: 'Online-Werbung EU (Google, Meta – Reverse Charge)', typ: 'A', kz: '9200', steuercode: 'RC20' },
  { name: 'Bewirtung Geschäftsfreunde (50 % abzugsfähig)', typ: 'A', kz: '9200', steuercode: '10', abzug_prozent: 50 },
  { name: 'Zinsen, Kreditkosten', typ: 'A', kz: '9220', steuercode: '0' },
  { name: 'SVS-Beiträge (eigene Pflichtversicherung)', typ: 'A', kz: '9225', steuercode: '0' },
  { name: 'Bank- und Zahlungsgebühren (PayPal, Stripe, SumUp)', typ: 'A', kz: '9230', steuercode: '0' },
  { name: 'Software, Cloud, Abos (Inland)', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Software, Cloud, Abos (EU/Drittland – Reverse Charge)', typ: 'A', kz: '9230', steuercode: 'RC20' },
  { name: 'Telefon, Internet', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Büromaterial, Porto', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Fachliteratur', typ: 'A', kz: '9230', steuercode: '10' },
  { name: 'Instandhaltung, Reparaturen', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Versicherungen (betrieblich)', typ: 'A', kz: '9230', steuercode: '0' },
  { name: 'Steuerberatung, Rechtsberatung', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Fortbildung', typ: 'A', kz: '9230', steuercode: '20' },
  { name: 'Gebühren, Beiträge (WKO, Behörden)', typ: 'A', kz: '9230', steuercode: '0' },
  { name: 'Sonstige Betriebsausgaben', typ: 'A', kz: '9230', steuercode: '20' },
  // Anlagen
  { name: 'Anlagekauf über 1.000 € (AfA)', typ: 'ANL', kz: '9130', steuercode: '20' },
  // Finanzamt / neutral
  { name: 'Umsatzsteuer Zahlung/Gutschrift Finanzamt', typ: 'UST', kz: '9230', steuercode: '0' },
  { name: 'Privateinlage', typ: 'N', kz: null, steuercode: '0' },
  { name: 'Privatentnahme', typ: 'N', kz: null, steuercode: '0' },
  { name: 'Einkommensteuer (privat)', typ: 'N', kz: null, steuercode: '0' },
  { name: 'Umbuchung zwischen eigenen Konten', typ: 'N', kz: null, steuercode: '0' },
  { name: 'Kredit Auszahlung/Tilgung', typ: 'N', kz: null, steuercode: '0' },
];

export const KONTEN = [
  { name: 'Geschäftskonto', art: 'bank' },
  { name: 'Kassa', art: 'kassa' },
  { name: 'PayPal', art: 'paypal' },
];

// [Muster, Kategoriename, Richtung]
export const REGELN = [
  ['SVS', 'SVS-Beiträge (eigene Pflichtversicherung)', 'A'],
  ['Sozialversicherung der Selbständigen', 'SVS-Beiträge (eigene Pflichtversicherung)', 'A'],
  ['Google Ireland', 'Online-Werbung EU (Google, Meta – Reverse Charge)', 'A'],
  ['Meta Platforms Ireland', 'Online-Werbung EU (Google, Meta – Reverse Charge)', 'A'],
  ['FACEBK', 'Online-Werbung EU (Google, Meta – Reverse Charge)', 'A'],
  ['Kontoführung', 'Bank- und Zahlungsgebühren (PayPal, Stripe, SumUp)', 'A'],
  ['Gebühr', 'Bank- und Zahlungsgebühren (PayPal, Stripe, SumUp)', 'A'],
  ['Finanzamt Österreich', 'Umsatzsteuer Zahlung/Gutschrift Finanzamt', ''],
  ['Wirtschaftskammer', 'Gebühren, Beiträge (WKO, Behörden)', 'A'],
  ['Allgemeine Abbuchung', 'Umbuchung zwischen eigenen Konten', ''],
  ['Bankgutschrift auf PayPal', 'Umbuchung zwischen eigenen Konten', ''],
];

export const SETTINGS = {
  firma: { name: '', adresse: '', steuernummer: '', uid: '' },
  ust_perioden: [{ ab: '2000-01-01', status: 'KU' }],
  uva_zeitraum: 'quartal',
  festgeschrieben_bis: '',
  beleg_praefix: 'B',
};
