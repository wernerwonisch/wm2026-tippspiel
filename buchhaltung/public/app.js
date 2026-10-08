// App-Rahmen: Anmeldung, Zustand, Navigation.

import { api, $, esc, fehler, toast } from './ui.js';
import { warteschlangeSenden } from './belegtools.js';
import { byId } from './core/reports.js';
import * as uebersicht from './views/uebersicht.js';
import * as buchungen from './views/buchungen.js';
import * as importView from './views/import.js';
import * as belege from './views/belege.js';
import * as anlagen from './views/anlagen.js';
import * as auswertung from './views/auswertung.js';
import * as einstellungen from './views/einstellungen.js';

export const S = {
  settings: {}, kategorien: [], konten: [], regeln: [], anlagen: [], importprofile: [], jahre: [], offeneBelege: 0,
  jahr: Number(localStorage.getItem('ea-jahr')) || new Date().getFullYear(),
  buchungen: [], buchungenJahr: null,
  get kat() { return byId(this.kategorien); },
  get kto() { return byId(this.konten); },
};

const ROUTES = {
  '': { titel: 'Übersicht', view: uebersicht, icon: '◎' },
  buchungen: { titel: 'Buchungen', view: buchungen, icon: '☰' },
  belege: { titel: 'Belege', view: belege, icon: '📷' },
  import: { titel: 'Import', view: importView, icon: '⇩' },
  auswertung: { titel: 'Auswertung', view: auswertung, icon: '∑' },
  anlagen: { titel: 'Anlagen', view: anlagen, icon: '▣' },
  einstellungen: { titel: 'Einstellungen', view: einstellungen, icon: '⚙' },
};
const MOBIL_NAV = ['', 'buchungen', 'belege', 'auswertung', 'einstellungen'];

export async function ladeState() {
  Object.assign(S, await api('state'));
  if (!S.jahre.includes(String(S.jahr))) S.jahre = [...new Set([String(S.jahr), ...S.jahre])].sort().reverse();
}

/** Buchungen des gewählten Jahres (zwischengespeichert, mit force neu laden). */
export async function ladeBuchungen(force = false) {
  if (!force && S.buchungenJahr === S.jahr) return S.buchungen;
  S.buchungen = await api(`buchungen?von=${S.jahr}-01-01&bis=${S.jahr}-12-31`);
  S.buchungenJahr = S.jahr;
  return S.buchungen;
}

export function setJahr(j) {
  S.jahr = Number(j);
  try { localStorage.setItem('ea-jahr', S.jahr); } catch { /* privat */ }
  render();
}

export function jahrAuswahl() {
  const jahre = [...new Set([...S.jahre.map(Number), new Date().getFullYear(), S.jahr])].sort((a, b) => b - a);
  return `<select class="jahr" aria-label="Geschäftsjahr">${jahre.map((j) => `<option${j === S.jahr ? ' selected' : ''}>${j}</option>`).join('')}</select>`;
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: ROUTES[name] ? name : '', args: rest };
}

export function go(hash) { location.hash = hash; }

let renderNr = 0;
export async function render() {
  const nr = ++renderNr;
  const { name, args } = route();
  const r = ROUTES[name];
  document.title = `${r.titel} – E/A-Buchhaltung`;
  $('#titel').textContent = r.titel;
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('aktiv', a.dataset.r === name);
  const main = $('#main');
  main.setAttribute('aria-busy', 'true');
  try {
    const html = await r.view.render(args);
    if (nr !== renderNr) return;
    main.innerHTML = html;
    await r.view.mount?.(main, args);
  } catch (e) {
    if (e.status !== 401) { main.innerHTML = `<div class="karte fehler">${esc(e.message)}</div>`; fehler(e); }
  } finally {
    main.removeAttribute('aria-busy');
  }
}

function nav() {
  $('#nav-seite').innerHTML = Object.entries(ROUTES).map(([k, r]) => `<a href="#/${k}" data-r="${k}"><span>${r.icon}</span>${r.titel}</a>`).join('');
  $('#nav-mobil').innerHTML = MOBIL_NAV.map((k) => `<a href="#/${k}" data-r="${k}"><span>${ROUTES[k].icon}</span><small>${ROUTES[k].titel}</small></a>`).join('');
}

function loginMaske() {
  document.body.classList.add('login');
  $('#main').innerHTML = `
    <form class="karte login-form" id="login">
      <h2>Anmelden</h2>
      <label>Passwort<input type="password" name="passwort" autocomplete="current-password" required autofocus></label>
      <button class="prim">Anmelden</button>
      <p class="klein">Die Anmeldung bleibt auf diesem Gerät 90 Tage gespeichert.</p>
    </form>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('login', { method: 'POST', body: { passwort: e.target.passwort.value, geraet: navigator.userAgent } });
      document.body.classList.remove('login');
      await start();
    } catch (err) { fehler(err); }
  };
}

async function start() {
  try {
    await ladeState();
  } catch (e) {
    if (e.status === 401) return loginMaske();
    $('#main').innerHTML = `<div class="karte fehler">${esc(e.message)}</div>`;
    return;
  }
  nav();
  await render();
  warteschlangeSenden();
}

window.addEventListener('hashchange', render);
document.addEventListener('change', (e) => { if (e.target.matches('select.jahr')) setJahr(e.target.value); });
window.addEventListener('ea:logout', loginMaske);
window.addEventListener('online', () => { $('#offline').hidden = true; warteschlangeSenden(); });
window.addEventListener('offline', () => { $('#offline').hidden = false; });
window.ea = { setJahr, go, render };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
$('#offline').hidden = navigator.onLine;
start().catch(fehler);
export { toast };
