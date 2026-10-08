// Service Worker: App-Oberfläche offline verfügbar halten. Daten (API) immer live vom Server.
const VERSION = 'ea-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'ui.js', 'belegtools.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'core/money.js', 'core/dates.js', 'core/tax.js', 'core/afa.js', 'core/reports.js', 'core/csv.js', 'core/importers.js',
  'core/zip.js', 'core/xlsx.js', 'core/exporters.js', 'core/seed.js',
  'views/uebersicht.js', 'views/buchungen.js', 'views/import.js', 'views/belege.js', 'views/anlagen.js', 'views/auswertung.js', 'views/einstellungen.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Netzwerk zuerst (immer aktuelle Version), bei fehlender Verbindung aus dem Cache
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
