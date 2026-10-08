// Belege: Upload (Bild verkleinern, Offline-Warteschlange), Text auslesen (OCR für Fotos, Textebene bei PDFs).
// OCR- und PDF-Bibliotheken werden erst bei Bedarf geladen (jsDelivr). Ohne Internet funktioniert alles außer dem Auslesen.

import { api, toast } from './ui.js';
import { belegAusText } from './core/importers.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

/** Fotos größer 1,5 MB auf max. 2400 px Kantenlänge (JPEG 85 %) verkleinern – bleibt gut lesbar. */
async function verkleinern(file) {
  if (!file.type.startsWith('image/') || file.size < 1.5 * 1024 * 1024 || file.type === 'image/heic') return file;
  try {
    const bmp = await createImageBitmap(file);
    const f = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function hochladen(file, buchungId) {
  const f = await verkleinern(file);
  const headers = { 'X-Filename': encodeURIComponent(f.name || 'beleg'), 'Content-Type': f.type || 'application/octet-stream' };
  if (buchungId) headers['X-Buchung-Id'] = String(buchungId);
  try {
    return await api('belege', { method: 'POST', body: f, headers });
  } catch (e) {
    if (e.status === 0) {
      await queue.add({ name: f.name, type: f.type, blob: f, buchungId });
      toast('Offline – Beleg wird hochgeladen, sobald wieder Verbindung besteht.', 'warn', 6000);
      return null;
    }
    throw e;
  }
}

// --- Offline-Warteschlange (IndexedDB) ------------------------------------------

const queue = {
  db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ea-queue', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('uploads', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction('uploads', mode);
      const out = fn(t.objectStore('uploads'));
      t.oncomplete = () => res(out?.result ?? out);
      t.onerror = () => rej(t.error);
    });
  },
  add(item) { return this.tx('readwrite', (s) => s.add(item)); },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
};

export async function warteschlangeSenden() {
  let items;
  try { items = await queue.all(); } catch { return 0; }
  let n = 0;
  for (const it of items || []) {
    try {
      const file = new File([it.blob], it.name, { type: it.type });
      await api('belege', { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(it.name), 'Content-Type': it.type, ...(it.buchungId ? { 'X-Buchung-Id': String(it.buchungId) } : {}) } });
      await queue.del(it.id); n++;
    } catch { break; }
  }
  if (n) toast(`${n} Beleg(e) aus der Warteschlange hochgeladen.`);
  return n;
}

// --- Auslesen ----------------------------------------------------------------------

function ladeScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Bibliothek konnte nicht geladen werden (Internet nötig)'));
    document.head.append(s);
  });
}

let tessWorker = null;
async function ocrBild(blob, fortschritt) {
  await ladeScript(TESSERACT);
  if (!tessWorker) {
    tessWorker = await window.Tesseract.createWorker('deu', 1, { logger: (m) => m.status === 'recognizing text' && fortschritt?.(Math.round(m.progress * 100)) });
  }
  const { data } = await tessWorker.recognize(blob);
  return data.text;
}

async function pdfText(blob) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    let lastY = null;
    for (const it of c.items) {
      const y = it.transform?.[5];
      text += (lastY !== null && Math.abs(y - lastY) > 2 ? '\n' : ' ') + it.str;
      lastY = y;
    }
    text += '\n';
  }
  return text;
}

/** Liest Datum, Betrag, USt-Satz, UID, Rechnungsnummer aus einem Beleg. */
export async function auslesen(beleg, fortschritt) {
  const res = await api(`belege/${beleg.id}/datei`, { raw: true });
  const blob = await res.blob();
  let text = '';
  if (beleg.mime === 'application/pdf') {
    text = await pdfText(blob);
    if (text.replace(/\s/g, '').length < 20) throw new Error('PDF enthält keinen Text (Scan) – bitte als Foto hochladen oder Werte manuell eingeben.');
  } else if (beleg.mime?.startsWith('image/')) {
    text = await ocrBild(blob, fortschritt);
  } else {
    throw new Error('Dateityp kann nicht ausgelesen werden');
  }
  return { text, ...belegAusText(text) };
}
