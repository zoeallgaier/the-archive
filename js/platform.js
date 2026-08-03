/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM — the one place that knows whether we're in the app or a browser.

   Everything else in the app talks to these functions and never touches
   Capacitor directly. That's what lets the whole thing run in a desktop
   browser (`python3 -m http.server`) for fast design iteration, and then run
   unchanged on the phone with real native storage underneath.
   ═══════════════════════════════════════════════════════════════════════════ */

const Cap = window.Capacitor;

export const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

const plugin = (name) => (Cap && Cap.Plugins ? Cap.Plugins[name] : null);

/* ── Haptics ────────────────────────────────────────────────────────────────
   The tree tick. Silently absent in the browser, which is correct — there is
   nothing to fake. */

export function tick(style = 'Light') {
  if (!NATIVE) return;
  const h = plugin('Haptics');
  if (h) h.impact({ style }).catch(() => {});
}

export function selectionTick() {
  if (!NATIVE) return;
  const h = plugin('Haptics');
  if (h) h.selectionChanged().catch(() => {});
}

/* ── Key/value store — the content index ────────────────────────────────────
   Native: a real file in the app's Data directory, which is what iOS device
   backup picks up. Browser: localStorage, purely so dev works. */

const INDEX_FILE = 'archive.json';

export async function readIndex() {
  if (!NATIVE) {
    const raw = localStorage.getItem('archive.index');
    return raw ? JSON.parse(raw) : null;
  }
  const fs = plugin('Filesystem');
  try {
    const res = await fs.readFile({
      path: INDEX_FILE, directory: 'DATA', encoding: 'utf8',
    });
    return JSON.parse(res.data);
  } catch (e) {
    return null;          // not written yet — first launch
  }
}

export async function writeIndex(data) {
  const json = JSON.stringify(data);
  if (!NATIVE) {
    localStorage.setItem('archive.index', json);
    return;
  }
  const fs = plugin('Filesystem');
  await fs.writeFile({
    path: INDEX_FILE, directory: 'DATA', data: json,
    encoding: 'utf8', recursive: true,
  });
}

/* ── Binary media ───────────────────────────────────────────────────────────
   Native: files under Data/media/, addressed through convertFileSrc — a raw
   file:// URI will not load in the webview, which is the single easiest way
   to break image display here.
   Browser: IndexedDB blobs behind object URLs. */

const DB_NAME = 'archive-media';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function idb(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** Write a base64 payload. `path` is relative, e.g. "media/user/x.jpg". */
export async function writeMedia(path, base64) {
  if (!NATIVE) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await idb('readwrite', (s) => s.put(new Blob([bytes], { type: 'image/jpeg' }), path));
    return;
  }
  const fs = plugin('Filesystem');
  await fs.writeFile({ path, directory: 'DATA', data: base64, recursive: true });
}

/** A URL the webview can actually render. */
export async function mediaURL(path) {
  if (!NATIVE) {
    const blob = await idb('readonly', (s) => s.get(path));
    return blob ? URL.createObjectURL(blob) : '';
  }
  const fs = plugin('Filesystem');
  const { uri } = await fs.getUri({ path, directory: 'DATA' });
  return Cap.convertFileSrc(uri);
}

export async function deleteMedia(path) {
  if (!NATIVE) {
    await idb('readwrite', (s) => s.delete(path));
    return;
  }
  const fs = plugin('Filesystem');
  try {
    await fs.deleteFile({ path, directory: 'DATA' });
  } catch (e) { /* already gone */ }
}

export async function readMediaBase64(path) {
  if (!NATIVE) {
    const blob = await idb('readonly', (s) => s.get(path));
    if (!blob) return null;
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
  }
  const fs = plugin('Filesystem');
  try {
    const res = await fs.readFile({ path, directory: 'DATA' });
    return res.data;
  } catch (e) {
    return null;
  }
}

/* ── Camera roll ────────────────────────────────────────────────────────────
   The native multi-picker on device; a plain file input in the browser. Both
   resolve to the same shape: a list of data URLs. */

export async function pickImages(limit = 12) {
  if (NATIVE) {
    const cam = plugin('Camera');
    const res = await cam.pickImages({ quality: 90, limit });
    const out = [];
    for (const p of res.photos || []) {
      const blob = await fetch(p.webPath).then((r) => r.blob());
      out.push(await blobToDataURL(blob));
    }
    return out;
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = limit > 1;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      resolve(await Promise.all(files.map(blobToDataURL)));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

/* ── Share sheet — used by Export ───────────────────────────────────────── */

export async function shareFile(uriOrBlobName, title) {
  if (!NATIVE) return false;
  const sh = plugin('Share');
  if (!sh) return false;
  await sh.share({ title, url: uriOrBlobName });
  return true;
}

/** Write a file to Documents (visible in the Files app) and hand back its URI. */
export async function writeDocument(path, data, encoding) {
  if (!NATIVE) {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = path.split('/').pop();
    a.click();
    return null;
  }
  const fs = plugin('Filesystem');
  const opts = { path, directory: 'DOCUMENTS', data, recursive: true };
  if (encoding) opts.encoding = encoding;
  await fs.writeFile(opts);
  const { uri } = await fs.getUri({ path, directory: 'DOCUMENTS' });
  return uri;
}
