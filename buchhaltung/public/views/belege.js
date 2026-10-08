import { S, ladeBuchungen, ladeState, render as neuRendern } from '../app.js';
import { fmt, fmtPlain, parseAmount } from '../core/money.js';
import { fmtDate } from '../core/dates.js';
import { vorschlaegeFuerBeleg } from '../core/importers.js';
import { api, esc, toast, fehler, bestaetigen, $ } from '../ui.js';
import { hochladen, auslesen } from '../belegtools.js';
import { bearbeiten } from './buchungen.js';

let offene = [];

export async function render(args) {
  offene = await api('belege?offen=1');
  await ladeBuchungen();
  return `
  <div class="schnell">
    <label class="gross prim">📷 Foto aufnehmen<input type="file" id="kamera" accept="image/*" capture="environment" hidden></label>
    <label class="gross">📄 Dateien hochladen<input type="file" id="dateien" accept="image/*,application/pdf" multiple hidden></label>
  </div>
  ${args[0] === 'kamera' ? '<p class="klein mitte">Tippen Sie auf „Foto aufnehmen“ – die Kamera öffnet sich.</p>' : ''}
  <p class="klein">Ablauf: Beleg hochladen → „Auslesen“ füllt Datum und Betrag → passende Bankbuchung zuordnen oder neue Barbuchung anlegen.
  Aufbewahrungspflicht: 7 Jahre (§ 132 BAO).</p>
  <h3>Belege ohne Buchung (${offene.length})</h3>
  <div id="offene" class="belegkarten">${offene.map(karte).join('') || '<div class="karte ok">Keine offenen Belege.</div>'}</div>`;
}

function karte(x) {
  const vor = vorschlaegeFuerBeleg(x, S.buchungen.filter((b) => !b.belege)).slice(0, 3);
  return `<div class="karte beleg-karte" data-id="${x.id}">
    <a href="/api/belege/${x.id}/datei" target="_blank" rel="noopener" class="thumb">${x.mime?.startsWith('image/') ? `<img src="/api/belege/${x.id}/datei" alt="Beleg" loading="lazy">` : '<span>📄 PDF</span>'}</a>
    <div class="beleg-daten">
      <small>${esc(x.dateiname)} · ${x.hochgeladen?.slice(0, 10) || ''}</small>
      <div class="raster klein">
        <label>Datum<input type="date" data-f="datum" value="${esc(x.datum || '')}"></label>
        <label>Betrag brutto<input data-f="betrag" inputmode="decimal" value="${x.betrag ? fmtPlain(Math.abs(x.betrag)) : ''}"></label>
        <label class="span2">Lieferant<input data-f="partner" value="${esc(x.partner || '')}"></label>
      </div>
      ${x.uid || x.rechnungsnr ? `<small>${x.rechnungsnr ? `Re-Nr. ${esc(x.rechnungsnr)} ` : ''}${x.uid ? `UID ${esc(x.uid)}` : ''}</small>` : ''}
      <div class="aktionen links">
        <button class="sek klein" data-a="lesen">🔍 Auslesen</button>
        <button class="sek klein" data-a="buchung">＋ Als Barzahlung/Buchung</button>
        <button class="gefahr klein" data-a="weg">Löschen</button>
      </div>
      <div class="vorschlaege">${vor.length ? '<small>Passende Buchungen:</small>' + vor.map((b) => `<button class="vorschlag" data-a="zu" data-b="${b.id}">${fmtDate(b.datum)} · ${esc((b.partner || b.text || '').slice(0, 40))} · <b>${fmt(b.betrag)}</b></button>`).join('') : x.betrag ? '<small>Keine Bankbuchung mit gleichem Betrag (±14 Tage) gefunden.</small>' : ''}</div>
    </div>
  </div>`;
}

export async function mount() {
  const upload = async (files) => {
    try {
      let n = 0;
      for (const f of files) { const r = await hochladen(f); if (r?.doppelt) toast(`${f.name} ist bereits vorhanden`, 'warn'); else if (r) n++; }
      if (n) toast(`${n} Beleg(e) hochgeladen`);
      await ladeState(); neuRendern();
    } catch (e) { fehler(e); }
  };
  $('#kamera').onchange = (e) => upload(e.target.files);
  $('#dateien').onchange = (e) => upload(e.target.files);

  const box = $('#offene');
  box.addEventListener('change', async (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const id = Number(e.target.closest('[data-id]').dataset.id);
    let v = e.target.value;
    if (f === 'betrag') v = v ? -Math.abs(parseAmount(v) || 0) : null;
    try {
      await api(`belege/${id}`, { method: 'PUT', body: { [f]: v || null } });
      Object.assign(offene.find((x) => x.id === id), { [f]: v });
      if (f !== 'partner') ersetzeKarte(id);
    } catch (err) { fehler(err); }
  });
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-a]'); if (!btn) return;
    const id = Number(btn.closest('[data-id]').dataset.id);
    const x = offene.find((o) => o.id === id);
    try {
      if (btn.dataset.a === 'lesen') {
        btn.disabled = true; btn.textContent = 'lese …';
        const r = await auslesen(x, (p) => { btn.textContent = `lese … ${p} %`; });
        const upd = { ocr_text: r.text.slice(0, 20000) };
        if (r.datum) upd.datum = r.datum;
        if (r.betrag) upd.betrag = -Math.abs(r.betrag);
        if (r.lieferant && !x.partner) upd.partner = r.lieferant.slice(0, 80);
        if (r.uid) upd.uid = r.uid;
        if (r.rechnungsnr) upd.rechnungsnr = r.rechnungsnr;
        await api(`belege/${id}`, { method: 'PUT', body: upd });
        Object.assign(x, upd);
        ersetzeKarte(id);
        toast(r.betrag ? `Erkannt: ${fmt(Math.abs(r.betrag))}${r.ust_saetze.length ? ` · USt ${r.ust_saetze.join('/')} %` : ''} – bitte prüfen` : 'Kein Betrag erkannt – bitte manuell eingeben', r.betrag ? 'ok' : 'warn');
      }
      if (btn.dataset.a === 'zu') {
        await api(`belege/${id}`, { method: 'PUT', body: { buchung_id: Number(btn.dataset.b) } });
        toast('Beleg zugeordnet');
        await ladeBuchungen(true); await ladeState(); neuRendern();
      }
      if (btn.dataset.a === 'buchung') {
        const kassa = S.konten.find((k) => k.art === 'kassa' && k.aktiv);
        const res = await bearbeiten({ datum: x.datum || undefined, betrag: x.betrag || undefined, partner: x.partner || '', text: x.rechnungsnr ? `Re-Nr. ${x.rechnungsnr}` : '', konto_id: kassa?.id }, { belegId: id });
        if (res) { await ladeState(); neuRendern(); }
      }
      if (btn.dataset.a === 'weg') {
        if (!(await bestaetigen('Beleg endgültig löschen?', 'Löschen'))) return;
        await api(`belege/${id}`, { method: 'DELETE' });
        await ladeState(); neuRendern();
      }
    } catch (err) { fehler(err); btn.disabled = false; btn.textContent = '🔍 Auslesen'; }
  });
}

function ersetzeKarte(id) {
  const el = document.querySelector(`.beleg-karte[data-id="${id}"]`);
  if (el) el.outerHTML = karte(offene.find((x) => x.id === id));
}
