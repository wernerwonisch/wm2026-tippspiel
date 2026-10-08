// UI-Hilfen: API-Aufrufe, Escaping, Dialoge, Meldungen, Formulare.

import { parseAmount, fmtPlain } from './core/money.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method,
      headers: { 'X-Requested-With': 'ea', ...(body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server');
  }
  if (res.status === 401 && path !== 'login') { window.dispatchEvent(new Event('ea:logout')); throw new ApiError(401, 'Bitte anmelden'); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).fehler || msg; } catch { /* kein JSON */ }
    throw new ApiError(res.status, msg);
  }
  if (raw) return res;
  return res.json();
}

export function toast(msg, typ = 'ok', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${typ}`;
  el.textContent = msg;
  $('#toasts').append(el);
  const alle = $('#toasts').querySelectorAll('.toast:not(.regel)');
  if (alle.length > 3) alle[0].remove();
  setTimeout(() => el.classList.add('weg'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function fehler(e) {
  console.error(e);
  toast(e?.message || String(e), 'err', 6000);
}

/** Modaler Dialog. render(el, close) befüllt den Inhalt; Rückgabe: Promise mit dem close()-Wert. */
export function dialog(titel, render, { breit = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = breit ? 'breit' : '';
    d.innerHTML = `<header><h2>${esc(titel)}</h2><button class="icon" data-x aria-label="Schließen">✕</button></header><div class="dlg-body"></div>`;
    document.body.append(d);
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-x]').onclick = () => close(null);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    render(d.querySelector('.dlg-body'), close);
    d.showModal();
  });
}

export async function bestaetigen(text, ok = 'OK') {
  return dialog('Bitte bestätigen', (el, close) => {
    el.innerHTML = `<p>${esc(text)}</p><div class="aktionen"><button class="sek" data-n>Abbrechen</button><button class="prim" data-j>${esc(ok)}</button></div>`;
    el.querySelector('[data-n]').onclick = () => close(false);
    el.querySelector('[data-j]').onclick = () => close(true);
  });
}

/** Liest ein Formular in ein Objekt; data-typ="cent" wandelt Beträge, "int"/"bool" entsprechend. */
export function formDaten(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    const t = el.dataset.typ;
    if (el.type === 'checkbox') o[el.name] = el.checked ? 1 : 0;
    else if (t === 'cent') o[el.name] = el.value.trim() === '' ? null : parseAmount(el.value);
    else if (t === 'int') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

export const centInput = (cents) => (cents === null || cents === undefined ? '' : fmtPlain(cents));

export function options(list, selected, { leer } = {}) {
  return (leer !== undefined ? `<option value="">${esc(leer)}</option>` : '') +
    list.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

export function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
