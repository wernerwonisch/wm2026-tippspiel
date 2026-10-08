import { S, ladeBuchungen, jahrAuswahl } from '../app.js';
import { fmt } from '../core/money.js';
import { eaRechnung } from '../core/reports.js';
import { uva, ustStatus, kuUmsatz, GRENZEN } from '../core/tax.js';
import { zeitraum, today } from '../core/dates.js';
import { esc } from '../ui.js';

export async function render() {
  const bs = await ladeBuchungen();
  const perioden = S.settings.ust_perioden;
  const ea = eaRechnung({ buchungen: bs, kategorien: S.kategorien, anlagen: S.anlagen, perioden, jahr: S.jahr });
  const heute = today();
  const status = ustStatus(S.jahr === new Date().getFullYear() ? heute : `${S.jahr}-12-31`, perioden);

  const ohneKat = bs.filter((b) => !b.kategorie_id).length;
  const ungeprueft = bs.filter((b) => !b.geprueft).length;
  const ohneBeleg = bs.filter((b) => {
    const k = S.kat[b.kategorie_id];
    return k && ['A', 'ANL'].includes(k.typ) && !b.belege && !b.eigenbeleg;
  }).length;

  // laufende UVA-Periode
  let uvaHtml = '';
  if (perioden.some((p) => p.status === 'REGEL')) {
    const m = new Date().getMonth() + 1;
    const per = S.settings.uva_zeitraum === 'monat' ? String(S.jahr === new Date().getFullYear() ? m : 12) : `Q${Math.ceil((S.jahr === new Date().getFullYear() ? m : 12) / 3)}`;
    const [v, b] = zeitraum(S.jahr, per);
    const u = uva(bs, S.kat, perioden, v, b);
    uvaHtml = `<div class="kachel"><small>USt ${per.startsWith('Q') ? per : per.padStart(2, '0')}/${S.jahr}</small><b class="${u.zahllast > 0 ? 'neg' : 'pos'}">${fmt(u.zahllast)}</b><small>${u.zahllast >= 0 ? 'Zahllast' : 'Gutschrift'} (KZ 095)</small></div>`;
  }

  let kuHtml = '';
  if (status === 'KU' || ustStatus(`${S.jahr}-01-01`, perioden) === 'KU') {
    const um = kuUmsatz(bs, S.kat, S.jahr);
    const pct = Math.min(100, Math.round((um / GRENZEN.kleinunternehmerBrutto) * 100));
    kuHtml = `<div class="karte">
      <h3>Kleinunternehmergrenze ${S.jahr}</h3>
      <div class="balken"><span style="width:${pct}%" class="${pct >= 90 ? 'warn' : ''}"></span></div>
      <p>${fmt(um)} von ${fmt(GRENZEN.kleinunternehmerBrutto)} brutto (${pct} %).
      ${pct >= 90 ? '<b>Achtung:</b> Grenze fast erreicht – bei Überschreitung (mehr als 10 % Toleranz) sofort steuerpflichtig. Wechsel unter Einstellungen → USt-Status eintragen.' : ''}</p>
    </div>`;
  }

  const todo = [
    [ohneKat, 'Buchungen ohne Kategorie', '#/buchungen/ohnekategorie'],
    [ungeprueft, 'Buchungen ungeprüft', '#/buchungen/ungeprueft'],
    [ohneBeleg, 'Ausgaben ohne Beleg', '#/buchungen/ohnebeleg'],
    [S.offeneBelege, 'Belege ohne Buchung', '#/belege'],
  ].filter(([n]) => n);

  return `
  <div class="leiste">${jahrAuswahl()}<span class="badge">${status === 'KU' ? 'Kleinunternehmer' : 'vorsteuerabzugsberechtigt'}</span></div>
  <div class="schnell">
    <a class="gross prim" href="#/belege/kamera">📷 Beleg fotografieren</a>
    <a class="gross" href="#/buchungen/neu">＋ Buchung</a>
    <a class="gross" href="#/import">⇩ Import</a>
  </div>
  <div class="kacheln">
    <div class="kachel"><small>Einnahmen</small><b>${fmt(ea.ertraege)}</b></div>
    <div class="kachel"><small>Ausgaben (inkl. AfA)</small><b>${fmt(ea.aufwendungen)}</b></div>
    <div class="kachel"><small>Gewinn / Verlust</small><b class="${ea.gewinn >= 0 ? 'pos' : 'neg'}">${fmt(ea.gewinn)}</b></div>
    ${uvaHtml}
  </div>
  ${todo.length ? `<div class="karte"><h3>Zu erledigen</h3><ul class="todo">${todo.map(([n, t, h]) => `<li><a href="${h}"><b>${n}</b> ${esc(t)}</a></li>`).join('')}</ul></div>` : '<div class="karte ok">✓ Alles erledigt – keine offenen Punkte.</div>'}
  ${kuHtml}
  <div class="karte">
    <h3>Größte Positionen ${S.jahr}</h3>
    <table class="tab"><tbody>
    ${ea.proKategorie.slice().sort((a, b) => b.summe - a.summe).slice(0, 8).map((p) => `<tr><td>${esc(p.kategorie.name)}</td><td class="r">${fmt(p.summe)}</td></tr>`).join('') || '<tr><td>Noch keine Buchungen.</td></tr>'}
    </tbody></table>
  </div>`;
}
