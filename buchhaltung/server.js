// E/A-Buchhaltung – Server ohne externe Abhängigkeiten (Node.js ≥ 22.13, eingebautes SQLite).
// Start: APP_PASSWORD=geheim node server.js   (Port: PORT, Datenordner: DATA_DIR)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { KATEGORIEN, KONTEN, REGELN, SETTINGS } from './public/core/seed.js';
import { createZip } from './public/core/zip.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const BELEGE = path.join(DATA, 'belege');
const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.APP_PASSWORD || '';
const MAX_UPLOAD = 25 * 1024 * 1024;
const SESSION_TAGE = 90;

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Bitte APP_PASSWORD mit mindestens 8 Zeichen setzen.');
  process.exit(1);
}
fs.mkdirSync(BELEGE, { recursive: true });

// --- Datenbank -----------------------------------------------------------------

const db = new DatabaseSync(path.join(DATA, 'buchhaltung.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, geraet TEXT);
CREATE TABLE IF NOT EXISTS konten (id INTEGER PRIMARY KEY, name TEXT NOT NULL, art TEXT DEFAULT 'bank', iban TEXT, sachkonto TEXT,
  anfangssaldo INTEGER DEFAULT 0, anfangssaldo_datum TEXT, aktiv INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS kategorien (id INTEGER PRIMARY KEY, name TEXT NOT NULL, typ TEXT NOT NULL, kz TEXT, steuercode TEXT DEFAULT '0',
  vst_abzug INTEGER DEFAULT 1, abzug_prozent INTEGER DEFAULT 100, konto TEXT, aktiv INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS regeln (id INTEGER PRIMARY KEY, muster TEXT NOT NULL, feld TEXT DEFAULT 'alle', richtung TEXT DEFAULT '',
  kategorie_id INTEGER REFERENCES kategorien(id) ON DELETE CASCADE, steuercode TEXT, privat_prozent INTEGER, prioritaet INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS buchungen (id INTEGER PRIMARY KEY, datum TEXT NOT NULL, betrag INTEGER NOT NULL,
  konto_id INTEGER REFERENCES konten(id), kategorie_id INTEGER REFERENCES kategorien(id), steuercode TEXT, privat_prozent INTEGER DEFAULT 0,
  text TEXT, partner TEXT, iban TEXT, referenz TEXT, beleg_nr TEXT, notiz TEXT, quelle TEXT, import_hash TEXT, geprueft INTEGER DEFAULT 0,
  eigenbeleg TEXT, erstellt TEXT DEFAULT (datetime('now')), geaendert TEXT, geloescht TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_buchungen_hash ON buchungen(import_hash) WHERE import_hash IS NOT NULL AND geloescht IS NULL;
CREATE INDEX IF NOT EXISTS ix_buchungen_datum ON buchungen(datum);
CREATE TABLE IF NOT EXISTS belege (id INTEGER PRIMARY KEY, buchung_id INTEGER REFERENCES buchungen(id) ON DELETE SET NULL,
  dateiname TEXT, mime TEXT, groesse INTEGER, pfad TEXT NOT NULL, sha256 TEXT, hochgeladen TEXT DEFAULT (datetime('now')),
  datum TEXT, betrag INTEGER, partner TEXT, rechnungsnr TEXT, uid TEXT, ocr_text TEXT, notiz TEXT);
CREATE TABLE IF NOT EXISTS anlagen (id INTEGER PRIMARY KEY, bezeichnung TEXT NOT NULL, datum TEXT NOT NULL, ak INTEGER NOT NULL,
  nutzungsdauer INTEGER NOT NULL, gwg INTEGER DEFAULT 0, abgang_datum TEXT, abgang_erloes INTEGER, privat_prozent INTEGER DEFAULT 0,
  buchung_id INTEGER REFERENCES buchungen(id) ON DELETE SET NULL, notiz TEXT);
CREATE TABLE IF NOT EXISTS importprofile (id INTEGER PRIMARY KEY, signatur TEXT UNIQUE, name TEXT, mapping TEXT, quelle TEXT, konto_id INTEGER);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, ts TEXT DEFAULT (datetime('now')), tabelle TEXT, datensatz INTEGER,
  aktion TEXT, alt TEXT, neu TEXT);
`);

function seed() {
  const n = db.prepare('SELECT COUNT(*) n FROM kategorien').get().n;
  if (n) return;
  const insK = db.prepare('INSERT INTO kategorien (name, typ, kz, steuercode, vst_abzug, abzug_prozent, sort) VALUES (?,?,?,?,?,?,?)');
  KATEGORIEN.forEach((k, i) => insK.run(k.name, k.typ, k.kz, k.steuercode, k.vst_abzug ?? 1, k.abzug_prozent ?? 100, i));
  const insKo = db.prepare('INSERT INTO konten (name, art) VALUES (?,?)');
  KONTEN.forEach((k) => insKo.run(k.name, k.art));
  const katId = (name) => db.prepare('SELECT id FROM kategorien WHERE name = ?').get(name)?.id;
  const insR = db.prepare('INSERT INTO regeln (muster, feld, richtung, kategorie_id) VALUES (?,?,?,?)');
  REGELN.forEach(([m, k, r]) => insR.run(m, 'alle', r, katId(k)));
  const insS = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
  for (const [k, v] of Object.entries(SETTINGS)) insS.run(k, JSON.stringify(v));
}
seed();

const TABLES = {
  kategorien: ['name', 'typ', 'kz', 'steuercode', 'vst_abzug', 'abzug_prozent', 'konto', 'aktiv', 'sort'],
  konten: ['name', 'art', 'iban', 'sachkonto', 'anfangssaldo', 'anfangssaldo_datum', 'aktiv'],
  regeln: ['muster', 'feld', 'richtung', 'kategorie_id', 'steuercode', 'privat_prozent', 'prioritaet'],
  anlagen: ['bezeichnung', 'datum', 'ak', 'nutzungsdauer', 'gwg', 'abgang_datum', 'abgang_erloes', 'privat_prozent', 'buchung_id', 'notiz'],
  buchungen: ['datum', 'betrag', 'konto_id', 'kategorie_id', 'steuercode', 'privat_prozent', 'text', 'partner', 'iban', 'referenz',
    'beleg_nr', 'notiz', 'quelle', 'import_hash', 'geprueft', 'eigenbeleg'],
  belege: ['buchung_id', 'datum', 'betrag', 'partner', 'rechnungsnr', 'uid', 'ocr_text', 'notiz'],
  importprofile: ['signatur', 'name', 'mapping', 'quelle', 'konto_id'],
};
const JSON_FIELDS = new Set(['eigenbeleg', 'mapping']);
const ORDER = { kategorien: 'sort, name', konten: 'id', regeln: 'prioritaet DESC, id', anlagen: 'datum', importprofile: 'id', belege: 'id DESC' };

function getSettings() {
  const s = { ...SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = JSON.parse(r.value);
  return s;
}

const outRow = (r) => {
  if (!r) return r;
  const o = { ...r };
  for (const f of JSON_FIELDS) if (typeof o[f] === 'string' && o[f]) { try { o[f] = JSON.parse(o[f]); } catch { /* Text belassen */ } }
  return o;
};

function clean(table, body) {
  const o = {};
  for (const c of TABLES[table]) {
    if (!(c in body)) continue;
    let v = body[c];
    if (v === '' && /(_id|betrag|ak|prozent|saldo|erloes|nutzungsdauer)$/.test(c)) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (JSON_FIELDS.has(c) && v && typeof v === 'object') v = JSON.stringify(v);
    o[c] = v;
  }
  return o;
}

function audit(tabelle, id, aktion, alt, neu) {
  db.prepare('INSERT INTO audit (tabelle, datensatz, aktion, alt, neu) VALUES (?,?,?,?,?)')
    .run(tabelle, id, aktion, alt ? JSON.stringify(alt) : null, neu ? JSON.stringify(neu) : null);
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function pruefeFestschreibung(...daten) {
  const fb = getSettings().festgeschrieben_bis;
  if (!fb) return;
  for (const d of daten) if (d && d <= fb) throw new HttpError(423, `Zeitraum bis ${fb} ist festgeschrieben (z. B. nach UVA-Abgabe). Änderung nur nach Aufhebung in den Einstellungen.`);
}

function naechsteBelegNr(datum) {
  const jahr = String(datum).slice(0, 4);
  const pref = `${getSettings().beleg_praefix || 'B'}${jahr}-`;
  const rows = db.prepare('SELECT beleg_nr FROM buchungen WHERE beleg_nr LIKE ?').all(pref + '%');
  const max = rows.reduce((m, r) => Math.max(m, Number(r.beleg_nr.slice(pref.length)) || 0), 0);
  return pref + String(max + 1).padStart(4, '0');
}

function insert(table, body) {
  const o = clean(table, body);
  if (table === 'buchungen') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.datum || '') || !Number.isInteger(Number(o.betrag))) throw new HttpError(400, 'Datum und Betrag (Cent) erforderlich');
    pruefeFestschreibung(o.datum);
    if (!o.beleg_nr) o.beleg_nr = naechsteBelegNr(o.datum);
  }
  const cols = Object.keys(o);
  if (!cols.length) throw new HttpError(400, 'Keine Daten');
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const r = db.prepare(sql).run(...cols.map((c) => o[c] ?? null));
  const id = Number(r.lastInsertRowid);
  if (table === 'buchungen' || table === 'anlagen') audit(table, id, 'neu', null, o);
  return outRow(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}

function update(table, id, body) {
  const alt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!alt) throw new HttpError(404, 'Nicht gefunden');
  const o = clean(table, body);
  if (table === 'buchungen') pruefeFestschreibung(alt.datum, o.datum);
  const cols = Object.keys(o);
  if (cols.length) {
    const extra = table === 'buchungen' ? ", geaendert = datetime('now')" : '';
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}${extra} WHERE id = ?`).run(...cols.map((c) => o[c] ?? null), id);
    if (table === 'buchungen' || table === 'anlagen') audit(table, id, 'aendern', alt, o);
  }
  return outRow(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}

function remove(table, id) {
  const alt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!alt) throw new HttpError(404, 'Nicht gefunden');
  if (table === 'buchungen') {
    pruefeFestschreibung(alt.datum);
    db.prepare("UPDATE buchungen SET geloescht = datetime('now') WHERE id = ?").run(id);
    db.prepare('UPDATE belege SET buchung_id = NULL WHERE buchung_id = ?').run(id);
    audit(table, id, 'loeschen', alt, null);
    return { ok: true };
  }
  if (table === 'belege') {
    fs.rmSync(path.join(BELEGE, alt.pfad), { force: true });
  }
  if (table === 'kategorien') {
    const n = db.prepare('SELECT COUNT(*) n FROM buchungen WHERE kategorie_id = ? AND geloescht IS NULL').get(id).n;
    if (n) throw new HttpError(409, `Kategorie wird in ${n} Buchungen verwendet – stattdessen deaktivieren.`);
  }
  if (table === 'konten') {
    const n = db.prepare('SELECT COUNT(*) n FROM buchungen WHERE konto_id = ? AND geloescht IS NULL').get(id).n;
    if (n) throw new HttpError(409, `Konto hat ${n} Buchungen – stattdessen deaktivieren.`);
  }
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (table === 'anlagen') audit(table, id, 'loeschen', alt, null);
  return { ok: true };
}

function bulkBuchungen(list) {
  let neu = 0, doppelt = 0;
  const ids = [];
  db.exec('BEGIN');
  try {
    for (const b of list) {
      if (b.import_hash && db.prepare('SELECT 1 FROM buchungen WHERE import_hash = ? AND geloescht IS NULL').get(b.import_hash)) { doppelt++; continue; }
      ids.push(insert('buchungen', b).id); neu++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { neu, doppelt, ids };
}

// --- HTTP-Hilfen ---------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic',
};

function send(res, status, body, headers = {}) {
  const isBuf = body instanceof Uint8Array || Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Datei zu groß (max. 25 MB)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

function cookies(req) {
  const o = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return o;
}

function angemeldet(req) {
  const t = cookies(req).sid;
  if (!t) return false;
  const s = db.prepare('SELECT expires FROM sessions WHERE token = ?').get(crypto.createHash('sha256').update(t).digest('hex'));
  return !!s && s.expires > Date.now();
}

const fehlversuche = new Map();
function pruefePasswort(ip, pw) {
  const f = fehlversuche.get(ip) || { n: 0, bis: 0 };
  if (f.bis > Date.now()) throw new HttpError(429, 'Zu viele Versuche – bitte kurz warten.');
  const a = crypto.createHash('sha256').update(String(pw)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (crypto.timingSafeEqual(a, b)) { fehlversuche.delete(ip); return true; }
  f.n++; if (f.n >= 5) { f.bis = Date.now() + 60_000; f.n = 0; }
  fehlversuche.set(ip, f);
  return false;
}

const safeName = (s) => String(s || 'beleg').normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80);

// --- Routen --------------------------------------------------------------------

async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const m = req.method;

  if (p[0] === 'login' && m === 'POST') {
    const { passwort, geraet } = await readJson(req);
    if (!pruefePasswort(req.socket.remoteAddress, passwort)) throw new HttpError(401, 'Passwort falsch');
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token, expires, geraet) VALUES (?,?,?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), Date.now() + SESSION_TAGE * 86400000, String(geraet || '').slice(0, 100));
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TAGE * 86400}${secure}` });
  }
  if (!angemeldet(req)) throw new HttpError(401, 'Nicht angemeldet');

  if (p[0] === 'logout') {
    const t = cookies(req).sid;
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(crypto.createHash('sha256').update(t).digest('hex'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }

  if (p[0] === 'state' && m === 'GET') {
    const st = { settings: getSettings() };
    for (const t of ['kategorien', 'konten', 'regeln', 'anlagen', 'importprofile']) st[t] = db.prepare(`SELECT * FROM ${t} ORDER BY ${ORDER[t]}`).all().map(outRow);
    st.jahre = db.prepare("SELECT DISTINCT substr(datum,1,4) j FROM buchungen WHERE geloescht IS NULL ORDER BY j DESC").all().map((r) => r.j);
    st.offeneBelege = db.prepare('SELECT COUNT(*) n FROM belege WHERE buchung_id IS NULL').get().n;
    return send(res, 200, st);
  }

  if (p[0] === 'settings' && m === 'PUT') {
    const body = await readJson(req);
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(body)) if (k in SETTINGS) up.run(k, JSON.stringify(v));
    audit('settings', null, 'aendern', null, body);
    return send(res, 200, getSettings());
  }

  if (p[0] === 'buchungen' && m === 'GET' && !p[1]) {
    const von = url.searchParams.get('von') || '0000-01-01', bis = url.searchParams.get('bis') || '9999-12-31';
    const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM belege x WHERE x.buchung_id = b.id) AS belege
      FROM buchungen b WHERE geloescht IS NULL AND datum BETWEEN ? AND ? ORDER BY datum DESC, id DESC`).all(von, bis);
    return send(res, 200, rows.map(outRow));
  }
  if (p[0] === 'buchungen' && m === 'POST' && !p[1]) {
    const body = await readJson(req);
    if (Array.isArray(body)) return send(res, 200, bulkBuchungen(body));
    return send(res, 200, insert('buchungen', body));
  }
  if (p[0] === 'buchungen' && p[1] === 'massen' && m === 'PUT') {
    const { ids, aenderung } = await readJson(req);
    db.exec('BEGIN');
    try { for (const id of ids || []) update('buchungen', Number(id), aenderung || {}); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return send(res, 200, { ok: true, anzahl: (ids || []).length });
  }
  if (p[0] === 'hashes' && m === 'GET') {
    return send(res, 200, db.prepare('SELECT import_hash FROM buchungen WHERE import_hash IS NOT NULL AND geloescht IS NULL').all().map((r) => r.import_hash));
  }

  // Belege
  if (p[0] === 'belege' && m === 'POST' && !p[1]) {
    const buf = await readBody(req, MAX_UPLOAD);
    if (!buf.length) throw new HttpError(400, 'Leere Datei');
    const name = safeName(decodeURIComponent(req.headers['x-filename'] || 'beleg'));
    const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const dup = db.prepare('SELECT * FROM belege WHERE sha256 = ?').get(sha);
    if (dup) return send(res, 200, { ...dup, doppelt: true });
    const jahr = new Date().getFullYear();
    const rel = path.join(String(jahr), `${Date.now()}_${name}`);
    fs.mkdirSync(path.join(BELEGE, String(jahr)), { recursive: true });
    fs.writeFileSync(path.join(BELEGE, rel), buf);
    const buchungId = Number(req.headers['x-buchung-id']) || null;
    const r = db.prepare('INSERT INTO belege (buchung_id, dateiname, mime, groesse, pfad, sha256) VALUES (?,?,?,?,?,?)')
      .run(buchungId, name, mime, buf.length, rel, sha);
    return send(res, 200, db.prepare('SELECT * FROM belege WHERE id = ?').get(Number(r.lastInsertRowid)));
  }
  if (p[0] === 'belege' && m === 'GET' && !p[1]) {
    const q = url.searchParams;
    let rows;
    if (q.get('buchung')) rows = db.prepare('SELECT * FROM belege WHERE buchung_id = ? ORDER BY id').all(Number(q.get('buchung')));
    else if (q.get('offen')) rows = db.prepare('SELECT * FROM belege WHERE buchung_id IS NULL ORDER BY id DESC').all();
    else rows = db.prepare('SELECT * FROM belege ORDER BY id DESC LIMIT 500').all();
    return send(res, 200, rows);
  }
  if (p[0] === 'belege' && p[2] === 'datei' && m === 'GET') {
    const b = db.prepare('SELECT * FROM belege WHERE id = ?').get(Number(p[1]));
    if (!b) throw new HttpError(404, 'Nicht gefunden');
    const file = path.join(BELEGE, b.pfad);
    if (!file.startsWith(BELEGE)) throw new HttpError(400, 'Ungültiger Pfad');
    const inline = /^(image\/|application\/pdf)/.test(b.mime);
    return send(res, 200, fs.readFileSync(file), {
      'Content-Type': inline ? b.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${b.dateiname}"`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    });
  }

  // Export: alle Belege eines Jahres als ZIP, benannt nach Beleg-Nr.
  if (p[0] === 'export' && p[1] === 'belege' && m === 'GET') {
    const jahr = url.searchParams.get('jahr') || String(new Date().getFullYear());
    const rows = db.prepare(`SELECT x.*, b.beleg_nr, b.datum AS bdatum FROM belege x JOIN buchungen b ON b.id = x.buchung_id
      WHERE b.geloescht IS NULL AND substr(b.datum,1,4) = ? ORDER BY b.datum, b.id`).all(jahr);
    const files = rows.map((r) => ({ name: `${r.bdatum}_${safeName(r.beleg_nr || r.buchung_id)}_${r.dateiname}`, data: fs.readFileSync(path.join(BELEGE, r.pfad)) }));
    return send(res, 200, createZip(files), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="Belege_${jahr}.zip"` });
  }

  // Sicherung: Datenbank + alle Belege
  if (p[0] === 'backup' && m === 'GET') {
    const tmp = path.join(DATA, `backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const files = [{ name: 'buchhaltung.db', data: fs.readFileSync(tmp) }];
    fs.rmSync(tmp, { force: true });
    for (const r of db.prepare('SELECT pfad FROM belege').all()) {
      const f = path.join(BELEGE, r.pfad);
      if (fs.existsSync(f)) files.push({ name: 'belege/' + r.pfad.split(path.sep).join('/'), data: fs.readFileSync(f) });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return send(res, 200, createZip(files), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="Sicherung_${stamp}.zip"` });
  }

  if (p[0] === 'audit' && m === 'GET') {
    return send(res, 200, db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Number(url.searchParams.get('limit') || 200)));
  }

  // Generische Tabellen
  if (TABLES[p[0]]) {
    const t = p[0];
    const id = p[1] ? Number(p[1]) : null;
    if (m === 'GET' && !id) return send(res, 200, db.prepare(`SELECT * FROM ${t} ORDER BY ${ORDER[t] || 'id'}`).all().map(outRow));
    if (m === 'GET' && id) return send(res, 200, outRow(db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id)));
    if (m === 'POST' && !id) return send(res, 200, insert(t, await readJson(req)));
    if (m === 'PUT' && id) return send(res, 200, update(t, id, await readJson(req)));
    if (m === 'DELETE' && id) return send(res, 200, remove(t, id));
  }
  throw new HttpError(404, 'Unbekannte Anfrage');
}

function statisch(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Nicht gefunden');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net blob: 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com data: blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'ea') throw new HttpError(403, 'Ungültige Anfrage');
      return await api(req, res, url);
    }
    return statisch(req, res, url);
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { fehler: status === 500 ? 'Interner Fehler' : e.message });
  }
});

server.listen(PORT, () => console.log(`E/A-Buchhaltung läuft auf http://localhost:${PORT} (Daten: ${DATA})`));
