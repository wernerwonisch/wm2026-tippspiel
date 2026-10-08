import { S, ladeBuchungen, ladeState, jahrAuswahl, render as neuRendern } from '../app.js';
import { fmt, parseAmount } from '../core/money.js';
import { fmtDate, zeitraum } from '../core/dates.js';
import { eaRechnung, kontenSalden } from '../core/reports.js';
import { uva, UVA_KZ, ustStatus } from '../core/tax.js';
import { EXPORTER } from '../core/exporters.js';
import { api, esc, toast, fehler, download, bestaetigen, $ } from '../ui.js';

let tab = 'uva';

function perioden() {
  return S.settings.uva_zeitraum === 'monat' ? Array.from({ length: 12 }, (_, i) => String(i + 1)) : ['Q1', 'Q2', 'Q3', 'Q4'];
}
const perLabel = (p) => (p.startsWith('Q') ? `${p}/${S.jahr}` : `${p.padStart(2, '0')}/${S.jahr}`);

function uvaHtml(bs) {
  const per = perioden();
  const res = per.map((p) => { const [v, b] = zeitraum(S.jahr, p); return { p, v, b, u: uva(bs, S.kat, S.settings.ust_perioden, v, b) }; });
  const keys = Object.keys(UVA_KZ).filter((k) => res.some((r) => r.u.kz[k]));
  const fb = S.settings.festgeschrieben_bis || '';
  const nurKU = res.every((r) => ustStatus(r.b, S.settings.ust_perioden) === 'KU' && ustStatus(r.v, S.settings.ust_perioden) === 'KU');
  return `
  ${nurKU ? '<div class="karte info">Im gesamten Jahr Kleinunternehmer: Eine UVA ist nur nötig, wenn Reverse-Charge-Steuer (KZ 057) anfällt. Umsätze erscheinen in der Jahreserklärung (U1).</div>' : ''}
  <div class="scroll"><table class="tab uva">
    <thead><tr><th>KZ</th><th>Bezeichnung</th>${res.map((r) => `<th class="r">${perLabel(r.p)}</th>`).join('')}</tr></thead>
    <tbody>${keys.map((k) => `<tr class="${k === '095' ? 'summe' : ''}"><td>${k}</td><td>${esc(UVA_KZ[k])}</td>${res.map((r) => `<td class="r">${r.u.kz[k] ? fmt(r.u.kz[k]) : ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${2 + res.length}">Keine UVA-relevanten Buchungen.</td></tr>`}
    <tr><td></td><td>Buchungen ohne Kategorie</td>${res.map((r) => `<td class="r ${r.u.ohneKategorie.length ? 'warn' : ''}">${r.u.ohneKategorie.length || ''}</td>`).join('')}</tr>
    <tr><td></td><td>Festschreiben (nach Abgabe)</td>${res.map((r) => `<td class="r">${r.b <= fb ? '🔒' : `<button class="sek klein" data-fest="${r.b}">sperren</button>`}</td>`).join('')}</tr>
    </tbody>
  </table></div>
  <p class="klein">USt wird je Kennzahl aus der Bemessungsgrundlage berechnet (20/10/13 %). Fälligkeit: 15. des zweitfolgenden Monats.
  Beträge in FinanzOnline (U30) übertragen. ${fb ? `Festgeschrieben bis ${fmtDate(fb)}.` : ''}</p>`;
}

function eaHtml(ea) {
  return `
  <div class="kacheln">
    <div class="kachel"><small>Betriebseinnahmen</small><b>${fmt(ea.ertraege)}</b></div>
    <div class="kachel"><small>Betriebsausgaben</small><b>${fmt(ea.aufwendungen)}</b></div>
    <div class="kachel"><small>Gewinn / Verlust</small><b class="${ea.gewinn >= 0 ? 'pos' : 'neg'}">${fmt(ea.gewinn)}</b></div>
    <div class="kachel"><small>Grundfreibetrag (Info)</small><b>${fmt(ea.grundfreibetrag)}</b></div>
  </div>
  <table class="tab">
    <thead><tr><th>KZ (E1a)</th><th>Bezeichnung</th><th class="r">Betrag</th></tr></thead>
    <tbody>${ea.kennzahlen.map((k) => `<tr><td>${k.kz}</td><td>${esc(k.label)}</td><td class="r">${fmt(k.betrag)}</td></tr>`).join('')}</tbody>
  </table>
  <details><summary>Aufschlüsselung nach Kategorien</summary>
  <table class="tab"><tbody>${ea.proKategorie.map((p) => `<tr><td>${p.kz}</td><td>${esc(p.kategorie.name)}</td><td class="r">${p.anzahl}</td><td class="r">${fmt(p.summe)}</td></tr>`).join('')}</tbody></table>
  </details>
  <p class="klein">Kennzahlen entsprechen der Zuordnung in den Kategorien – vor Abgabe mit der aktuellen Ausfüllhilfe (E 2) bzw. dem Steuerberater abgleichen.
  Gewinnfreibetrag über den Grundfreibetrag hinaus (investitionsbedingt) ist nicht berechnet.</p>`;
}

function abschlussHtml(bs, ea, bisJahresende) {
  const ohneKat = bs.filter((b) => !b.kategorie_id).length;
  const ungeprueft = bs.filter((b) => !b.geprueft).length;
  const ohneBeleg = bs.filter((b) => { const k = S.kat[b.kategorie_id]; return k && ['A', 'ANL'].includes(k.typ) && !b.belege && !b.eigenbeleg; }).length;
  const anlKaeufe = bs.filter((b) => S.kat[b.kategorie_id]?.typ === 'ANL');
  const ohneAnlage = anlKaeufe.filter((b) => !S.anlagen.some((a) => a.buchung_id === b.id)).length;
  const salden = kontenSalden(bisJahresende, S.konten, `${S.jahr}-12-31`).filter((s) => s.anzahl);
  const fb = S.settings.festgeschrieben_bis || '';
  const check = (ok, text, link) => `<li class="${ok ? 'ok' : 'offen'}">${ok ? '✓' : '○'} ${link && !ok ? `<a href="${link}">${text}</a>` : text}</li>`;
  return `
  <div class="karte">
    <h3>Checkliste Jahresabschluss ${S.jahr}</h3>
    <ul class="check">
      ${check(!ohneKat, `Alle Buchungen kategorisiert${ohneKat ? ` (${ohneKat} offen)` : ''}`, '#/buchungen/ohnekategorie')}
      ${check(!ungeprueft, `Alle Buchungen geprüft${ungeprueft ? ` (${ungeprueft} offen)` : ''}`, '#/buchungen/ungeprueft')}
      ${check(!ohneBeleg, `Belege zu allen Ausgaben${ohneBeleg ? ` (${ohneBeleg} fehlen)` : ''}`, '#/buchungen/ohnebeleg')}
      ${check(!ohneAnlage, `Anlagekäufe im Anlagenverzeichnis${ohneAnlage ? ` (${ohneAnlage} fehlen)` : ''}`, '#/anlagen')}
      ${check(!S.offeneBelege, `Alle Belege zugeordnet${S.offeneBelege ? ` (${S.offeneBelege} offen)` : ''}`, '#/belege')}
      ${check(fb >= `${S.jahr}-12-31`, 'Jahr festgeschrieben (nach Abschluss)')}
      <li>○ Privatanteile (Kfz, Telefon, Internet, Arbeitsplatz) mit Steuerberater abgestimmt</li>
      <li>○ Offene Forderungen/Verbindlichkeiten zum 31.12. notiert (bei E/A erst bei Zahlung wirksam; regelmäßig wiederkehrende Zahlungen ±15 Tage beachten)</li>
    </ul>
  </div>
  <div class="karte">
    <h3>Kontenabgleich 31.12.${S.jahr}</h3>
    <table class="tab"><thead><tr><th>Konto</th><th class="r">Saldo lt. Buchhaltung</th><th class="r">Saldo lt. Auszug</th><th class="r">Differenz</th></tr></thead>
    <tbody>${salden.map((s) => `<tr><td>${esc(s.konto.name)}${s.konto.anfangssaldo ? '' : ' <small class="warn">Anfangssaldo fehlt?</small>'}</td><td class="r">${fmt(s.saldo)}</td>
      <td class="r"><input class="abgleich r" data-saldo="${s.saldo}" inputmode="decimal" placeholder="0,00" size="10"></td><td class="r diff"></td></tr>`).join('')}</tbody></table>
    <p class="klein">Anfangssaldo je Konto unter Einstellungen → Konten erfassen.</p>
  </div>
  <div class="karte">
    <h3>Export für den Steuerberater</h3>
    <div class="aktionen links">
      ${Object.entries(EXPORTER).map(([k, e]) => `<button class="${k === 'excel' ? 'prim' : 'sek'}" data-export="${k}">${esc(e.label)}</button>`).join('')}
      <a class="btn sek" href="/api/export/belege?jahr=${S.jahr}" download>Alle Belege ${S.jahr} (ZIP)</a>
      <button class="sek" id="drucken">Drucken / als PDF speichern</button>
    </div>
    <p class="klein">Empfehlung: Excel-Paket + Beleg-ZIP an die Kanzlei. Die Belegdateien im ZIP sind nach Datum und Beleg-Nr. benannt und passen zum Journal.</p>
  </div>
  <div id="druck" class="druck-nur">${druckHtml(bs, ea)}</div>`;
}

function druckHtml(bs, ea) {
  const firma = S.settings.firma || {};
  const per = perioden();
  const u = uva(bs, S.kat, S.settings.ust_perioden, `${S.jahr}-01-01`, `${S.jahr}-12-31`);
  return `
  <h1>Einnahmen-Ausgaben-Rechnung ${S.jahr}</h1>
  <p>${esc(firma.name || '')} ${firma.steuernummer ? `· StNr. ${esc(firma.steuernummer)}` : ''} ${firma.uid ? `· UID ${esc(firma.uid)}` : ''}</p>
  ${eaHtml(ea)}
  <h2>Umsatzsteuer ${S.jahr} (Summe ${per.length === 12 ? 'aller Monate' : 'aller Quartale'})</h2>
  <table class="tab">${Object.keys(UVA_KZ).filter((k) => u.kz[k]).map((k) => `<tr><td>${k}</td><td>${esc(UVA_KZ[k])}</td><td class="r">${fmt(u.kz[k])}</td></tr>`).join('')}</table>
  <h2>Anlagenverzeichnis</h2>
  <table class="tab"><tr><th>Bezeichnung</th><th>Anschaffung</th><th class="r">AK</th><th class="r">BW 1.1.</th><th class="r">AfA</th><th class="r">BW 31.12.</th></tr>
  ${ea.anlagen.map(({ a, w }) => `<tr><td>${esc(a.bezeichnung)}</td><td>${fmtDate(a.datum)}</td><td class="r">${fmt(a.ak)}</td><td class="r">${fmt(w.bwAnfang)}</td><td class="r">${fmt(w.afa)}</td><td class="r">${fmt(w.bwEnde)}</td></tr>`).join('')}</table>
  <p class="klein">Erstellt am ${new Date().toLocaleDateString('de-AT')}</p>`;
}

export async function render() {
  const bs = await ladeBuchungen();
  const ea = eaRechnung({ buchungen: bs, kategorien: S.kategorien, anlagen: S.anlagen, perioden: S.settings.ust_perioden, jahr: S.jahr });
  const tabs = { uva: 'Umsatzsteuer (UVA)', ea: 'E/A-Rechnung', abschluss: 'Jahresabschluss & Export' };
  return `
  <div class="leiste">${jahrAuswahl()}<div class="tabs">${Object.entries(tabs).map(([k, l]) => `<button class="${k === tab ? 'aktiv' : ''}" data-tab="${k}">${l}</button>`).join('')}</div></div>
  ${tab === 'uva' ? uvaHtml(bs) : tab === 'ea' ? eaHtml(ea) : abschlussHtml(bs, ea, await api(`buchungen?bis=${S.jahr}-12-31`))}`;
}

export async function mount(main) {
  main.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; neuRendern(); }; });
  main.querySelectorAll('[data-fest]').forEach((b) => {
    b.onclick = async () => {
      if (!(await bestaetigen(`Alle Buchungen bis ${fmtDate(b.dataset.fest)} festschreiben? Danach sind Änderungen in diesem Zeitraum gesperrt (Aufhebung in den Einstellungen möglich).`, 'Festschreiben'))) return;
      try { await api('settings', { method: 'PUT', body: { festgeschrieben_bis: b.dataset.fest } }); await ladeState(); neuRendern(); } catch (e) { fehler(e); }
    };
  });
  main.querySelectorAll('[data-export]').forEach((b) => {
    b.onclick = async () => {
      try {
        const [belege, alle] = await Promise.all([api('belege'), api(`buchungen?bis=${S.jahr}-12-31`), ladeBuchungen()]);
        const d = { buchungen: S.buchungen, alleBuchungen: alle, kategorien: S.kategorien, konten: S.konten, anlagen: S.anlagen, belege, settings: S.settings };
        const r = EXPORTER[b.dataset.export].run(d, S.jahr);
        download(r.name, r.data, r.mime);
        if (r.warnung) toast(r.warnung, 'warn', 9000);
      } catch (e) { fehler(e); }
    };
  });
  main.querySelectorAll('input.abgleich').forEach((inp) => {
    inp.oninput = () => {
      const v = parseAmount(inp.value);
      const td = inp.closest('tr').querySelector('.diff');
      if (v === null) { td.textContent = ''; return; }
      const d = Number(inp.dataset.saldo) - v;
      td.textContent = d ? fmt(d) : '✓';
      td.className = `r diff ${d ? 'warn' : 'pos'}`;
    };
  });
  $('#drucken', main)?.addEventListener('click', () => { document.body.classList.add('druckmodus'); window.print(); setTimeout(() => document.body.classList.remove('druckmodus'), 500); });
}
