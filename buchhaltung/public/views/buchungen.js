import { S, ladeBuchungen, jahrAuswahl, render as neuRendern, ladeState } from '../app.js';
import { fmt, fmtPlain, parseAmount } from '../core/money.js';
import { fmtDate, today } from '../core/dates.js';
import { bewerte, STEUERCODES, KATEGORIE_TYPEN } from '../core/tax.js';
import { api, esc, dialog, toast, fehler, bestaetigen, options, $, $$, debounce } from '../ui.js';
import { hochladen } from '../belegtools.js';

const FILTER = {
  alle: 'Alle', ohnekategorie: 'Ohne Kategorie', ungeprueft: 'Ungeprüft', ohnebeleg: 'Ausgaben ohne Beleg', einnahmen: 'Nur Einnahmen', ausgaben: 'Nur Ausgaben',
};
let filter = { monat: '', konto: '', art: 'alle', suche: '' };
let auswahl = new Set();

export function kategorieOptionen(selected, leer = '— Kategorie wählen —') {
  const gruppen = {};
  for (const k of S.kategorien) {
    if (!k.aktiv && String(k.id) !== String(selected)) continue;
    (gruppen[k.typ] ??= []).push(k);
  }
  return `<option value="">${esc(leer)}</option>` + Object.entries(gruppen).map(([typ, ks]) =>
    `<optgroup label="${esc(KATEGORIE_TYPEN[typ] || typ)}">${ks.map((k) => `<option value="${k.id}"${String(k.id) === String(selected ?? '') ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`).join('');
}

const steuerOptionen = (sel) => options(Object.entries(STEUERCODES).map(([v, s]) => ({ value: v, label: s.label })), sel, { leer: 'wie Kategorie' });

function gefiltert(bs) {
  const q = filter.suche.toLowerCase();
  return bs.filter((b) => {
    if (filter.monat && b.datum.slice(5, 7) !== filter.monat) return false;
    if (filter.konto && String(b.konto_id) !== filter.konto) return false;
    const k = S.kat[b.kategorie_id];
    switch (filter.art) {
      case 'ohnekategorie': if (b.kategorie_id) return false; break;
      case 'ungeprueft': if (b.geprueft) return false; break;
      case 'ohnebeleg': if (!k || !['A', 'ANL'].includes(k.typ) || b.belege || b.eigenbeleg) return false; break;
      case 'einnahmen': if (b.betrag < 0) return false; break;
      case 'ausgaben': if (b.betrag > 0) return false; break;
    }
    if (q && !`${b.text} ${b.partner} ${b.beleg_nr} ${b.notiz} ${fmtPlain(b.betrag)}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function render(args) {
  if (FILTER[args[0]]) filter.art = args[0];
  await ladeBuchungen();
  return `
  <div class="leiste">
    ${jahrAuswahl()}
    <select id="f-monat" aria-label="Monat"><option value="">Ganzes Jahr</option>${Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return `<option value="${m}"${filter.monat === m ? ' selected' : ''}>${new Date(2000, i, 1).toLocaleString('de-AT', { month: 'long' })}</option>`; }).join('')}</select>
    <select id="f-konto" aria-label="Konto">${options(S.konten.map((k) => ({ value: k.id, label: k.name })), filter.konto, { leer: 'Alle Konten' })}</select>
    <select id="f-art" aria-label="Filter">${options(Object.entries(FILTER).map(([value, label]) => ({ value, label })), filter.art)}</select>
    <input id="f-suche" type="search" placeholder="Suche (Text, Partner, Betrag)" value="${esc(filter.suche)}">
    <span class="fuell"></span>
    <button class="prim" id="neu">＋ Buchung</button>
    <button class="sek" id="eigenbeleg">Eigenbeleg</button>
  </div>
  <div class="masse" id="masse" hidden>
    <span id="masse-n"></span>
    <select id="masse-kat">${kategorieOptionen('', 'Kategorie setzen …')}</select>
    <button class="sek" id="masse-geprueft">Als geprüft markieren</button>
    <button class="sek" id="masse-weg">Auswahl aufheben</button>
  </div>
  <div id="liste"></div>`;
}

function liste() {
  const bs = gefiltert(S.buchungen);
  const summe = bs.reduce((s, b) => s + b.betrag, 0);
  $('#liste').innerHTML = `
  <p class="klein">${bs.length} Buchungen · Saldo ${fmt(summe)}</p>
  <table class="tab buchungen">
    <thead><tr><th><input type="checkbox" id="alle" aria-label="Alle auswählen"></th><th>Datum</th><th>Partner / Text</th><th>Kategorie</th><th class="r">Betrag</th><th title="Belege">📎</th><th title="geprüft">✓</th></tr></thead>
    <tbody>${bs.slice(0, 1000).map((b) => {
      const k = S.kat[b.kategorie_id];
      return `<tr data-id="${b.id}" class="${b.geprueft ? '' : 'offen'}">
        <td><input type="checkbox" class="sel" ${auswahl.has(b.id) ? 'checked' : ''} aria-label="Auswählen"></td>
        <td class="nw">${fmtDate(b.datum)}<small class="bnr">${esc(b.beleg_nr || '')}</small></td>
        <td class="txt" data-edit><b>${esc(b.partner || '')}</b> <span>${esc(b.text || '')}</span>${b.privat_prozent ? `<small class="badge">privat ${b.privat_prozent} %</small>` : ''}</td>
        <td><select class="kat ${k ? '' : 'leer'}" aria-label="Kategorie">${kategorieOptionen(b.kategorie_id)}</select></td>
        <td class="r nw ${b.betrag < 0 ? 'neg' : 'pos'}" data-edit>${fmt(b.betrag)}</td>
        <td data-edit>${b.belege ? `📎${b.belege > 1 ? b.belege : ''}` : b.eigenbeleg ? 'EB' : (k && ['A', 'ANL'].includes(k.typ) ? '<span class="warn">fehlt</span>' : '')}</td>
        <td><input type="checkbox" class="gp" ${b.geprueft ? 'checked' : ''} aria-label="geprüft"></td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  ${bs.length > 1000 ? '<p class="klein">Nur die ersten 1000 Einträge angezeigt – bitte Filter verwenden.</p>' : ''}
  ${bs.length ? '' : '<div class="karte">Keine Buchungen für diese Auswahl. Tipp: Kontoauszug über „Import“ einlesen.</div>'}`;
  masseAnzeigen();
}

function masseAnzeigen() {
  $('#masse').hidden = !auswahl.size;
  $('#masse-n').textContent = `${auswahl.size} ausgewählt`;
}

async function speichernFeld(id, aenderung) {
  const neu = await api(`buchungen/${id}`, { method: 'PUT', body: aenderung });
  const i = S.buchungen.findIndex((b) => b.id === id);
  if (i >= 0) S.buchungen[i] = { ...S.buchungen[i], ...neu };
}

export async function mount(main, args) {
  liste();
  const neuLaden = () => { liste(); };
  $('#f-monat').onchange = (e) => { filter.monat = e.target.value; neuLaden(); };
  $('#f-konto').onchange = (e) => { filter.konto = e.target.value; neuLaden(); };
  $('#f-art').onchange = (e) => { filter.art = e.target.value; neuLaden(); };
  $('#f-suche').oninput = debounce((e) => { filter.suche = e.target.value; neuLaden(); });
  $('#neu').onclick = () => bearbeiten({});
  $('#eigenbeleg').onclick = () => bearbeiten({ eigenbeleg: { grund: '' } });

  $('#liste').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (e.target.id === 'alle') {
      const ids = gefiltert(S.buchungen).slice(0, 1000).map((b) => b.id);
      auswahl = e.target.checked ? new Set(ids) : new Set();
      $$('.sel', main).forEach((c) => { c.checked = e.target.checked; });
      return masseAnzeigen();
    }
    if (!tr) return;
    const id = Number(tr.dataset.id);
    try {
      if (e.target.classList.contains('sel')) { e.target.checked ? auswahl.add(id) : auswahl.delete(id); masseAnzeigen(); }
      if (e.target.classList.contains('kat')) {
        await speichernFeld(id, { kategorie_id: e.target.value || null, steuercode: null });
        e.target.classList.toggle('leer', !e.target.value);
        regelAnbieten(S.buchungen.find((b) => b.id === id));
      }
      if (e.target.classList.contains('gp')) { await speichernFeld(id, { geprueft: e.target.checked ? 1 : 0 }); tr.classList.toggle('offen', !e.target.checked); }
    } catch (err) { fehler(err); liste(); }
  });
  $('#liste').addEventListener('click', (e) => {
    const td = e.target.closest('[data-edit]');
    if (!td) return;
    const b = S.buchungen.find((x) => x.id === Number(td.closest('tr').dataset.id));
    if (b) bearbeiten(b);
  });
  $('#masse-kat').onchange = async (e) => {
    if (!e.target.value) return;
    try {
      await api('buchungen/massen', { method: 'PUT', body: { ids: [...auswahl], aenderung: { kategorie_id: Number(e.target.value), steuercode: null } } });
      toast(`${auswahl.size} Buchungen geändert`);
      auswahl.clear(); await ladeBuchungen(true); neuRendern();
    } catch (err) { fehler(err); }
  };
  $('#masse-geprueft').onclick = async () => {
    try {
      await api('buchungen/massen', { method: 'PUT', body: { ids: [...auswahl], aenderung: { geprueft: 1 } } });
      auswahl.clear(); await ladeBuchungen(true); neuRendern();
    } catch (err) { fehler(err); }
  };
  $('#masse-weg').onclick = () => { auswahl.clear(); liste(); };

  if (args[0] === 'neu') { history.replaceState(null, '', '#/buchungen'); bearbeiten({}); }
  else if (/^\d+$/.test(args[0] || '')) { const b = S.buchungen.find((x) => x.id === Number(args[0])); if (b) bearbeiten(b); }
}

/** Nach manueller Kategorisierung: Regel für künftige Importe vorschlagen. */
async function regelAnbieten(b) {
  if (!b?.partner || !b.kategorie_id) return;
  if (S.regeln.some((r) => b.partner.toLowerCase().includes(r.muster.toLowerCase()))) return;
  document.querySelectorAll('.toast.regel').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast info regel';
  el.innerHTML = `Künftig „${esc(b.partner)}“ automatisch so zuordnen? <button class="sek klein">Regel anlegen</button>`;
  $('#toasts').append(el);
  el.querySelector('button').onclick = async () => {
    try {
      await api('regeln', { method: 'POST', body: { muster: b.partner, feld: 'partner', richtung: b.betrag < 0 ? 'A' : 'E', kategorie_id: b.kategorie_id, prioritaet: 10 } });
      await ladeState(); toast('Regel angelegt'); el.remove();
    } catch (e) { fehler(e); }
  };
  setTimeout(() => el.remove(), 9000);
}

/** Dialog zum Erfassen/Bearbeiten. Rückgabe: gespeicherte Buchung oder null. */
export async function bearbeiten(b, { belegId } = {}) {
  const neu = !b.id;
  const eingang = b.betrag !== undefined ? b.betrag >= 0 : false;
  const eb = b.eigenbeleg && typeof b.eigenbeleg === 'object' ? b.eigenbeleg : null;
  return dialog(neu ? (eb ? 'Eigenbeleg erfassen' : 'Neue Buchung') : `Buchung ${b.beleg_nr || ''}`, async (el, close) => {
    el.innerHTML = `
    <form id="bf" class="raster">
      <label>Datum<input type="date" name="datum" value="${esc(b.datum || today())}" required></label>
      <div class="richtung">
        <label class="radio"><input type="radio" name="richtung" value="A" ${eingang ? '' : 'checked'}> Ausgabe</label>
        <label class="radio"><input type="radio" name="richtung" value="E" ${eingang ? 'checked' : ''}> Einnahme</label>
      </div>
      <label>Betrag brutto (€)<input name="betrag" inputmode="decimal" value="${b.betrag !== undefined ? fmtPlain(Math.abs(b.betrag)) : ''}" required placeholder="0,00"></label>
      <label>Zahlungskonto<select name="konto_id">${options(S.konten.filter((k) => k.aktiv || k.id === b.konto_id).map((k) => ({ value: k.id, label: k.name })), b.konto_id ?? (eb ? S.konten.find((k) => k.art === 'kassa')?.id : S.konten[0]?.id))}</select></label>
      <label class="span2">Kategorie<select name="kategorie_id">${kategorieOptionen(b.kategorie_id)}</select></label>
      <label>Steuer<select name="steuercode">${steuerOptionen(b.steuercode)}</select></label>
      <label>Privatanteil %<input type="number" name="privat_prozent" min="0" max="100" step="1" value="${b.privat_prozent || 0}"></label>
      <label class="span2">Partner (Lieferant/Kunde)<input name="partner" value="${esc(b.partner || '')}" list="partnerliste"></label>
      <label class="span2">Text / Verwendungszweck<input name="text" value="${esc(b.text || '')}"></label>
      <label>Beleg-Nr.<input name="beleg_nr" value="${esc(b.beleg_nr || '')}" placeholder="automatisch"></label>
      <label>Notiz<input name="notiz" value="${esc(b.notiz || '')}"></label>
      ${eb ? `<fieldset class="span2"><legend>Eigenbeleg (wenn keine Rechnung vorhanden)</legend>
        <label>Grund, warum kein Fremdbeleg vorliegt<input name="eb_grund" value="${esc(eb.grund || '')}" required placeholder="z. B. Trinkgeld, Parkautomat ohne Beleg, Beleg verloren"></label>
        <label>Empfänger / Ort<input name="eb_empfaenger" value="${esc(eb.empfaenger || '')}"></label>
      </fieldset>` : ''}
      <label class="check span2"><input type="checkbox" name="geprueft" ${b.geprueft ? 'checked' : ''}> geprüft</label>
      <div class="vorschau span2" id="vorschau"></div>
    </form>
    <datalist id="partnerliste">${[...new Set(S.buchungen.map((x) => x.partner).filter(Boolean))].slice(0, 300).map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    ${neu ? '' : `<div id="belegbox"><h3>Belege</h3><div id="belegliste" class="belegliste"></div>
      <label class="btn sek">📎 Datei / Foto hinzufügen<input type="file" id="belegupload" accept="image/*,application/pdf" capture="environment" hidden multiple></label></div>`}
    <div class="aktionen">
      ${neu ? '' : '<button class="gefahr" id="loeschen">Löschen</button>'}
      ${eb || b.eigenbeleg ? '<button class="sek" id="ebdruck">Eigenbeleg drucken</button>' : ''}
      <span class="fuell"></span>
      <button class="sek" id="abbr">Abbrechen</button>
      <button class="prim" id="speichern">Speichern</button>
    </div>`;
    const f = el.querySelector('#bf');

    const daten = () => {
      const betrag = Math.abs(parseAmount(f.betrag.value) || 0) * (f.richtung.value === 'E' ? 1 : -1);
      const o = {
        datum: f.datum.value, betrag, konto_id: Number(f.konto_id.value) || null, kategorie_id: Number(f.kategorie_id.value) || null,
        steuercode: f.steuercode.value || null, privat_prozent: Number(f.privat_prozent.value) || 0, partner: f.partner.value.trim(),
        text: f.text.value.trim(), beleg_nr: f.beleg_nr.value.trim(), notiz: f.notiz.value.trim(), geprueft: f.geprueft.checked ? 1 : 0,
      };
      if (eb) o.eigenbeleg = { grund: f.eb_grund.value.trim(), empfaenger: f.eb_empfaenger.value.trim(), erstellt: today() };
      return o;
    };
    const vorschau = () => {
      const d = daten();
      const k = S.kat[d.kategorie_id];
      if (!k || !d.betrag) { el.querySelector('#vorschau').innerHTML = ''; return; }
      const r = bewerte(d, k, S.settings.ust_perioden);
      const typ = KATEGORIE_TYPEN[r.typ] || '';
      el.querySelector('#vorschau').innerHTML = `
        <span>${r.status === 'KU' ? 'Kleinunternehmer' : 'mit Vorsteuerabzug'} · ${esc(typ)}</span>
        <span>Netto ${fmt(r.netto)}</span>
        ${r.ust ? `<span>USt ${fmt(r.ust)}</span>` : ''}${r.vst ? `<span>Vorsteuer ${fmt(r.vst)}</span>` : ''}
        <span><b>${r.typ === 'E' ? 'Einnahme' : r.typ === 'ANL' ? 'AfA über Anlagenverzeichnis' : r.ea ? 'Betriebsausgabe' : 'nicht erfolgswirksam'} ${r.ea ? fmt(r.ea) : ''}</b></span>
        ${r.kz ? `<span>KZ ${r.kz}</span>` : ''}${r.hinweis ? `<span class="warn">${esc(r.hinweis)}</span>` : ''}
        ${k.typ === 'ANL' && !neu ? '<button type="button" class="sek klein" id="alsanlage">Ins Anlagenverzeichnis</button>' : ''}`;
      el.querySelector('#alsanlage')?.addEventListener('click', async () => {
        const { anlageAusBuchung } = await import('./anlagen.js');
        close(null); anlageAusBuchung({ ...b, ...d }, r);
      });
    };
    f.addEventListener('input', vorschau);
    f.addEventListener('change', (e) => {
      if (e.target.name === 'kategorie_id') {
        const k = S.kat[e.target.value];
        if (k && (k.typ === 'E') !== (f.richtung.value === 'E') && ['E', 'A', 'ANL'].includes(k.typ)) f.richtung.value = k.typ === 'E' ? 'E' : 'A';
        f.steuercode.value = '';
      }
      vorschau();
    });
    vorschau();

    const belegeLaden = async () => {
      if (neu) return;
      const list = await api(`belege?buchung=${b.id}`);
      el.querySelector('#belegliste').innerHTML = list.map((x) => `<a href="/api/belege/${x.id}/datei" target="_blank" rel="noopener" class="beleg">${x.mime.startsWith('image/') ? `<img src="/api/belege/${x.id}/datei" alt="" loading="lazy">` : '📄'}<span>${esc(x.dateiname)}</span></a>`).join('') || '<p class="klein">Noch kein Beleg.</p>';
    };
    belegeLaden().catch(fehler);
    el.querySelector('#belegupload')?.addEventListener('change', async (e) => {
      try {
        for (const file of e.target.files) await hochladen(file, b.id);
        await belegeLaden(); await ladeBuchungen(true);
      } catch (err) { fehler(err); }
    });

    el.querySelector('#abbr').onclick = () => close(null);
    el.querySelector('#ebdruck')?.addEventListener('click', () => eigenbelegDrucken({ ...b, ...daten() }));
    el.querySelector('#loeschen')?.addEventListener('click', async () => {
      if (!(await bestaetigen('Buchung löschen? (Bleibt im Änderungsprotokoll nachvollziehbar.)', 'Löschen'))) return;
      try { await api(`buchungen/${b.id}`, { method: 'DELETE' }); close(null); await ladeBuchungen(true); neuRendern(); } catch (e) { fehler(e); }
    });
    el.querySelector('#speichern').onclick = async () => {
      if (!f.reportValidity()) return;
      const d = daten();
      if (!d.betrag) return toast('Betrag fehlt', 'err');
      try {
        const res = neu ? await api('buchungen', { method: 'POST', body: d }) : await api(`buchungen/${b.id}`, { method: 'PUT', body: d });
        if (belegId) await api(`belege/${belegId}`, { method: 'PUT', body: { buchung_id: res.id } });
        toast('Gespeichert');
        close(res);
        if (!neu && d.kategorie_id && d.kategorie_id !== b.kategorie_id) regelAnbieten(res);
        if (res.datum.slice(0, 4) !== String(S.jahr)) toast(`Buchung liegt im Jahr ${res.datum.slice(0, 4)}`, 'info');
        await ladeBuchungen(true);
        if (location.hash.startsWith('#/buchungen') || location.hash === '' || location.hash === '#/') neuRendern();
      } catch (e) { fehler(e); }
    };
  }, { breit: true });
}

function eigenbelegDrucken(b) {
  const eb = b.eigenbeleg || {};
  const firma = S.settings.firma || {};
  const w = document.createElement('div');
  w.className = 'druck-nur';
  w.innerHTML = `<div class="eigenbeleg">
    <h1>Eigenbeleg ${esc(b.beleg_nr || '')}</h1>
    <p>${esc(firma.name || '')}<br>${esc(firma.adresse || '')}</p>
    <table class="tab">
      <tr><th>Datum der Zahlung</th><td>${fmtDate(b.datum)}</td></tr>
      <tr><th>Betrag (brutto)</th><td>${fmt(Math.abs(b.betrag))}</td></tr>
      <tr><th>Empfänger / Ort</th><td>${esc(eb.empfaenger || b.partner || '')}</td></tr>
      <tr><th>Leistung / Zweck</th><td>${esc(b.text || '')}</td></tr>
      <tr><th>Kategorie</th><td>${esc(S.kat[b.kategorie_id]?.name || '')}</td></tr>
      <tr><th>Grund für Eigenbeleg</th><td>${esc(eb.grund || '')}</td></tr>
    </table>
    <p class="klein">Hinweis: Aus einem Eigenbeleg kann keine Vorsteuer geltend gemacht werden.</p>
    <p style="margin-top:4em">______________________________<br>Datum, Unterschrift</p>
  </div>`;
  document.body.append(w);
  document.body.classList.add('druckmodus');
  window.print();
  setTimeout(() => { w.remove(); document.body.classList.remove('druckmodus'); }, 500);
}
