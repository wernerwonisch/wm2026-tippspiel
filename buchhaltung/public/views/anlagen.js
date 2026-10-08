import { S, ladeState, render as neuRendern, jahrAuswahl } from '../app.js';
import { fmt, fmtPlain, parseAmount } from '../core/money.js';
import { fmtDate } from '../core/dates.js';
import { afaJahr, NUTZUNGSDAUER } from '../core/afa.js';
import { GRENZEN } from '../core/tax.js';
import { api, esc, dialog, toast, fehler, bestaetigen, $ } from '../ui.js';

export async function render() {
  const zeilen = S.anlagen.map((a) => ({ a, w: afaJahr(a, S.jahr) }));
  const summe = zeilen.reduce((s, z) => s + z.w.afaBetrieblich, 0);
  return `
  <div class="leiste">${jahrAuswahl()}<span class="fuell"></span><button class="prim" id="neu">＋ Anlage</button></div>
  <p class="klein">Wirtschaftsgüter über ${fmt(GRENZEN.gwg)} (netto bei Vorsteuerabzug, sonst brutto) werden über die Nutzungsdauer abgeschrieben.
  Anschaffung ab 1. Juli: halbe Jahres-AfA. Bis ${fmt(GRENZEN.gwg)} wahlweise sofort als GWG. Pkw: mind. 8 Jahre, Anschaffungskosten max. 40.000 € (Luxustangente).</p>
  <table class="tab">
    <thead><tr><th>Bezeichnung</th><th>Anschaffung</th><th class="r">AK</th><th>ND</th><th class="r">BW 1.1.</th><th class="r">AfA ${S.jahr}</th><th class="r">BW 31.12.</th></tr></thead>
    <tbody>${zeilen.map(({ a, w }) => `<tr data-id="${a.id}" class="klickbar">
      <td>${esc(a.bezeichnung)}${a.gwg ? ' <small class="badge">GWG</small>' : ''}${a.abgang_datum ? ` <small class="badge">Abgang ${fmtDate(a.abgang_datum)}</small>` : ''}${a.privat_prozent ? ` <small class="badge">privat ${a.privat_prozent} %</small>` : ''}</td>
      <td>${fmtDate(a.datum)}</td><td class="r">${fmt(a.ak)}</td><td>${a.gwg ? '–' : a.nutzungsdauer + ' J.'}</td>
      <td class="r">${fmt(w.bwAnfang)}</td><td class="r">${fmt(w.afa)}</td><td class="r">${fmt(w.bwEnde)}</td></tr>`).join('') || '<tr><td colspan="7">Noch keine Anlagen.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">AfA ${S.jahr} betrieblich (KZ 9130)</td><td class="r"><b>${fmt(summe)}</b></td><td></td></tr></tfoot>
  </table>`;
}

export async function mount() {
  $('#neu').onclick = () => anlageDialog({});
  document.querySelector('#main tbody').onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) anlageDialog(S.anlagen.find((a) => a.id === Number(tr.dataset.id)));
  };
}

/** Aus einer Buchung (Kategorie „Anlagekauf“) eine Anlage vorbefüllen. r = Ergebnis von bewerte(). */
export function anlageAusBuchung(b, r) {
  const ak = r.vst ? r.netto : Math.abs(b.betrag);
  return anlageDialog({ bezeichnung: b.text || b.partner || '', datum: b.datum, ak, nutzungsdauer: 3, buchung_id: b.id, privat_prozent: b.privat_prozent || 0 });
}

function anlageDialog(a) {
  return dialog(a.id ? 'Anlage bearbeiten' : 'Neue Anlage', (el, close) => {
    el.innerHTML = `
    <form class="raster" id="af">
      <label class="span2">Bezeichnung<input name="bezeichnung" value="${esc(a.bezeichnung || '')}" required></label>
      <label>Anschaffung / Inbetriebnahme<input type="date" name="datum" value="${esc(a.datum || '')}" required></label>
      <label>Anschaffungskosten (€)<input name="ak" inputmode="decimal" value="${a.ak ? fmtPlain(a.ak) : ''}" required></label>
      <label>Nutzungsdauer (Jahre)<input type="number" name="nutzungsdauer" min="1" max="50" value="${a.nutzungsdauer || 3}" list="nd"></label>
      <label>Privatanteil %<input type="number" name="privat_prozent" min="0" max="100" value="${a.privat_prozent || 0}"></label>
      <label class="check span2"><input type="checkbox" name="gwg" ${a.gwg ? 'checked' : ''}> Sofort abschreiben als GWG (nur bis ${fmt(GRENZEN.gwg)})</label>
      <label>Ausgeschieden am<input type="date" name="abgang_datum" value="${esc(a.abgang_datum || '')}"></label>
      <label>Verkaufserlös (€)<input name="abgang_erloes" inputmode="decimal" value="${a.abgang_erloes ? fmtPlain(a.abgang_erloes) : ''}"></label>
      <label class="span2">Notiz<input name="notiz" value="${esc(a.notiz || '')}"></label>
      <p class="klein span2">Richtwerte Nutzungsdauer: ${NUTZUNGSDAUER.map((n) => `${esc(n.label)} ${n.jahre} J.`).join(' · ')}</p>
    </form>
    <div class="aktionen">${a.id ? '<button class="gefahr" id="del">Löschen</button>' : ''}<span class="fuell"></span><button class="sek" id="abbr">Abbrechen</button><button class="prim" id="ok">Speichern</button></div>`;
    const f = el.querySelector('#af');
    el.querySelector('#abbr').onclick = () => close(null);
    el.querySelector('#del')?.addEventListener('click', async () => {
      if (!(await bestaetigen('Anlage löschen?', 'Löschen'))) return;
      try { await api(`anlagen/${a.id}`, { method: 'DELETE' }); close(null); await ladeState(); neuRendern(); } catch (e) { fehler(e); }
    });
    el.querySelector('#ok').onclick = async () => {
      if (!f.reportValidity()) return;
      const ak = parseAmount(f.ak.value);
      if (f.gwg.checked && ak > GRENZEN.gwg) return toast(`GWG nur bis ${fmt(GRENZEN.gwg)}`, 'err');
      const body = {
        bezeichnung: f.bezeichnung.value.trim(), datum: f.datum.value, ak, nutzungsdauer: Number(f.nutzungsdauer.value) || 1,
        privat_prozent: Number(f.privat_prozent.value) || 0, gwg: f.gwg.checked ? 1 : 0, abgang_datum: f.abgang_datum.value || null,
        abgang_erloes: parseAmount(f.abgang_erloes.value), notiz: f.notiz.value, buchung_id: a.buchung_id || null,
      };
      try {
        await api(a.id ? `anlagen/${a.id}` : 'anlagen', { method: a.id ? 'PUT' : 'POST', body });
        toast('Gespeichert'); close(true); await ladeState();
        if (location.hash.startsWith('#/anlagen')) neuRendern(); else location.hash = '#/anlagen';
      } catch (e) { fehler(e); }
    };
  });
}
