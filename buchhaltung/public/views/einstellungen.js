import { S, ladeState, render as neuRendern } from '../app.js';
import { fmtPlain, parseAmount } from '../core/money.js';
import { fmtDate } from '../core/dates.js';
import { STEUERCODES, KATEGORIE_TYPEN, E1A_KZ } from '../core/tax.js';
import { api, esc, options, toast, fehler, bestaetigen, $ } from '../ui.js';

const steuerOpts = Object.entries(STEUERCODES).map(([value, s]) => ({ value, label: s.label }));
const typOpts = Object.entries(KATEGORIE_TYPEN).map(([value, label]) => ({ value, label }));
const kzOpts = Object.entries(E1A_KZ).map(([value, label]) => ({ value, label: `${value} ${label}` }));

const TABELLEN = {
  kategorien: {
    titel: 'Kategorien', neu: { name: 'Neue Kategorie', typ: 'A', kz: '9230', steuercode: '20', aktiv: 1 },
    spalten: [
      { f: 'name', l: 'Name' }, { f: 'typ', l: 'Typ', opts: typOpts }, { f: 'kz', l: 'E1a-KZ', opts: kzOpts, leer: '—' },
      { f: 'steuercode', l: 'Steuer', opts: steuerOpts }, { f: 'vst_abzug', l: 'VSt-Abzug', t: 'check' },
      { f: 'abzug_prozent', l: 'abzugsf. %', t: 'number' }, { f: 'konto', l: 'Sachkonto (BMD)' }, { f: 'aktiv', l: 'aktiv', t: 'check' },
    ],
  },
  konten: {
    titel: 'Zahlungskonten', neu: { name: 'Neues Konto', art: 'bank', aktiv: 1 },
    spalten: [
      { f: 'name', l: 'Name' }, { f: 'art', l: 'Art', opts: ['bank', 'kassa', 'paypal', 'stripe', 'sumup', 'kreditkarte', 'sonstig'].map((v) => ({ value: v, label: v })) },
      { f: 'iban', l: 'IBAN' }, { f: 'anfangssaldo', l: 'Anfangssaldo', t: 'cent' }, { f: 'anfangssaldo_datum', l: 'Saldo zum', t: 'date' },
      { f: 'sachkonto', l: 'Sachkonto (BMD)' }, { f: 'aktiv', l: 'aktiv', t: 'check' },
    ],
  },
  regeln: {
    titel: 'Zuordnungsregeln (Import)', neu: { muster: 'Suchtext', feld: 'alle', richtung: '', prioritaet: 0 },
    spalten: [
      { f: 'muster', l: 'enthält (oder /RegEx/)' },
      { f: 'feld', l: 'in', opts: [{ value: 'alle', label: 'Partner+Text' }, { value: 'partner', label: 'Partner' }, { value: 'text', label: 'Text' }] },
      { f: 'richtung', l: 'nur', opts: [{ value: '', label: 'Ein+Aus' }, { value: 'E', label: 'Eingänge' }, { value: 'A', label: 'Ausgänge' }] },
      { f: 'kategorie_id', l: 'Kategorie', opts: () => S.kategorien.map((k) => ({ value: k.id, label: k.name })), leer: '—' },
      { f: 'steuercode', l: 'Steuer', opts: steuerOpts, leer: 'wie Kategorie' }, { f: 'privat_prozent', l: 'privat %', t: 'number' },
      { f: 'prioritaet', l: 'Priorität', t: 'number' },
    ],
  },
};

function zelle(sp, row) {
  const v = row[sp.f];
  const n = `data-f="${sp.f}"`;
  if (sp.opts) {
    const opts = typeof sp.opts === 'function' ? sp.opts() : sp.opts;
    return `<select ${n}>${options(opts, v, sp.leer !== undefined ? { leer: sp.leer } : {})}</select>`;
  }
  if (sp.t === 'check') return `<input type="checkbox" ${n} ${v ? 'checked' : ''}>`;
  if (sp.t === 'number') return `<input type="number" ${n} value="${v ?? ''}" style="width:5em">`;
  if (sp.t === 'cent') return `<input inputmode="decimal" ${n} value="${v ? fmtPlain(v) : ''}" style="width:8em">`;
  if (sp.t === 'date') return `<input type="date" ${n} value="${esc(v || '')}">`;
  return `<input ${n} value="${esc(v ?? '')}">`;
}

function tabelle(name) {
  const t = TABELLEN[name];
  return `<details class="karte" data-tabelle="${name}"><summary><h3>${t.titel} (${S[name].length})</h3></summary>
    <div class="scroll"><table class="tab edit"><thead><tr>${t.spalten.map((s) => `<th>${esc(s.l)}</th>`).join('')}<th></th></tr></thead>
    <tbody>${S[name].map((r) => `<tr data-id="${r.id}">${t.spalten.map((s) => `<td>${zelle(s, r)}</td>`).join('')}<td><button class="icon" data-del title="Löschen">🗑</button></td></tr>`).join('')}</tbody></table></div>
    <button class="sek" data-neu>＋ Hinzufügen</button></details>`;
}

export async function render() {
  const s = S.settings;
  const f = s.firma || {};
  return `
  <form class="karte" id="firma">
    <h3>Unternehmen</h3>
    <div class="raster">
      <label>Name<input name="name" value="${esc(f.name || '')}"></label>
      <label>Adresse<input name="adresse" value="${esc(f.adresse || '')}"></label>
      <label>Steuernummer<input name="steuernummer" value="${esc(f.steuernummer || '')}"></label>
      <label>UID-Nummer<input name="uid" value="${esc(f.uid || '')}" placeholder="ATU…"></label>
      <label>Präfix Beleg-Nr.<input name="beleg_praefix" value="${esc(s.beleg_praefix || 'B')}" maxlength="6"></label>
      <label>UVA-Zeitraum<select name="uva_zeitraum">${options([{ value: 'quartal', label: 'Quartal (Vorjahresumsatz bis 100.000 €)' }, { value: 'monat', label: 'Monat' }], s.uva_zeitraum)}</select></label>
    </div>
    <div class="aktionen"><button class="prim">Speichern</button></div>
  </form>

  <div class="karte">
    <h3>Umsatzsteuer-Status</h3>
    <p class="klein">Ab welchem Datum gilt welcher Status? Ein Wechsel ist unterjährig möglich (z. B. Verzicht auf Kleinunternehmerregelung
    oder Überschreiten der Grenze). Jede Buchung wird nach dem Status an ihrem Datum bewertet.</p>
    <table class="tab" id="perioden"><tbody>${(s.ust_perioden || []).map((p, i) => `<tr data-i="${i}">
      <td>ab <input type="date" data-p="ab" value="${esc(p.ab)}"></td>
      <td><select data-p="status">${options([{ value: 'KU', label: 'Kleinunternehmer (keine USt, kein Vorsteuerabzug)' }, { value: 'REGEL', label: 'Regelbesteuert (USt + Vorsteuerabzug)' }], p.status)}</select></td>
      <td>${i ? '<button class="icon" data-pdel>🗑</button>' : ''}</td></tr>`).join('')}</tbody></table>
    <div class="aktionen links"><button class="sek" id="padd">＋ Statuswechsel</button><button class="prim" id="psave">Speichern</button></div>
  </div>

  <div class="karte">
    <h3>Festschreibung</h3>
    <p>${s.festgeschrieben_bis ? `Buchungen bis <b>${fmtDate(s.festgeschrieben_bis)}</b> sind gesperrt.` : 'Keine Festschreibung.'}</p>
    <div class="aktionen links"><input type="date" id="fbdatum" value="${esc(s.festgeschrieben_bis || '')}"><button class="sek" id="fbsave">Übernehmen</button></div>
    <p class="klein">Nach Abgabe einer UVA bzw. nach Jahresabschluss festschreiben. Alle Änderungen werden zusätzlich protokolliert.</p>
  </div>

  ${Object.keys(TABELLEN).map(tabelle).join('')}

  <div class="karte">
    <h3>Datensicherung</h3>
    <p class="klein">Enthält Datenbank und alle Belege. Zusätzlich empfohlen: automatische Sicherung des Datenordners am NAS/Server (Snapshot, Hyper Backup, restic).</p>
    <div class="aktionen links"><a class="btn prim" href="/api/backup" download>Sicherung herunterladen (ZIP)</a></div>
    <details><summary>Änderungsprotokoll (letzte 100)</summary><div id="audit" class="klein">lädt …</div></details>
  </div>
  <div class="aktionen"><button class="gefahr" id="logout">Abmelden</button></div>`;
}

export async function mount(main) {
  $('#firma').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('settings', { method: 'PUT', body: {
        firma: { name: f.name.value.trim(), adresse: f.adresse.value.trim(), steuernummer: f.steuernummer.value.trim(), uid: f.uid.value.trim().toUpperCase() },
        beleg_praefix: f.beleg_praefix.value.trim() || 'B', uva_zeitraum: f.uva_zeitraum.value,
      } });
      await ladeState(); toast('Gespeichert');
    } catch (err) { fehler(err); }
  };

  const perioden = () => [...main.querySelectorAll('#perioden tr')].map((tr) => ({ ab: tr.querySelector('[data-p=ab]').value, status: tr.querySelector('[data-p=status]').value }));
  $('#padd').onclick = () => {
    const tb = $('#perioden tbody');
    tb.insertAdjacentHTML('beforeend', `<tr><td>ab <input type="date" data-p="ab" value="${new Date().getFullYear()}-01-01"></td><td><select data-p="status"><option value="REGEL">Regelbesteuert (USt + Vorsteuerabzug)</option><option value="KU">Kleinunternehmer (keine USt, kein Vorsteuerabzug)</option></select></td><td><button class="icon" data-pdel>🗑</button></td></tr>`);
  };
  $('#perioden').onclick = (e) => { if (e.target.closest('[data-pdel]')) e.target.closest('tr').remove(); };
  $('#psave').onclick = async () => {
    const p = perioden();
    if (p.some((x) => !x.ab)) return toast('Datum fehlt', 'err');
    try { await api('settings', { method: 'PUT', body: { ust_perioden: p.sort((a, b) => a.ab.localeCompare(b.ab)) } }); await ladeState(); toast('USt-Status gespeichert'); neuRendern(); } catch (err) { fehler(err); }
  };
  $('#fbsave').onclick = async () => {
    try { await api('settings', { method: 'PUT', body: { festgeschrieben_bis: $('#fbdatum').value || '' } }); await ladeState(); toast('Gespeichert'); neuRendern(); } catch (err) { fehler(err); }
  };

  for (const det of main.querySelectorAll('[data-tabelle]')) {
    const name = det.dataset.tabelle;
    const t = TABELLEN[name];
    det.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr[data-id]'); const f = e.target.dataset.f;
      if (!tr || !f) return;
      const sp = t.spalten.find((s) => s.f === f);
      let v = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value;
      if (sp.t === 'number') v = v === '' ? null : Number(v);
      if (sp.t === 'cent') v = parseAmount(v) ?? 0;
      if (v === '' && sp.leer !== undefined) v = null;
      try { await api(`${name}/${tr.dataset.id}`, { method: 'PUT', body: { [f]: v } }); await ladeState(); e.target.classList.add('gespeichert'); } catch (err) { fehler(err); }
    });
    det.addEventListener('click', async (e) => {
      if (e.target.closest('[data-neu]')) {
        try { await api(name, { method: 'POST', body: t.neu }); await ladeState(); await neuRendern(); document.querySelector(`[data-tabelle="${name}"]`).open = true; } catch (err) { fehler(err); }
      }
      if (e.target.closest('[data-del]')) {
        const id = e.target.closest('tr').dataset.id;
        if (!(await bestaetigen('Eintrag löschen?', 'Löschen'))) return;
        try { await api(`${name}/${id}`, { method: 'DELETE' }); await ladeState(); await neuRendern(); document.querySelector(`[data-tabelle="${name}"]`).open = true; } catch (err) { fehler(err); }
      }
    });
  }

  main.querySelector('details:has(#audit)')?.addEventListener('toggle', async (e) => {
    if (!e.target.open) return;
    try {
      const rows = await api('audit?limit=100');
      $('#audit').innerHTML = `<table class="tab"><tbody>${rows.map((r) => `<tr><td class="nw">${esc(r.ts)}</td><td>${esc(r.tabelle)} ${r.datensatz ?? ''}</td><td>${esc(r.aktion)}</td><td>${esc((r.neu || r.alt || '').slice(0, 160))}</td></tr>`).join('')}</tbody></table>`;
    } catch (err) { fehler(err); }
  });

  $('#logout').onclick = async () => { await api('logout', { method: 'POST' }).catch(() => {}); location.reload(); };
}
