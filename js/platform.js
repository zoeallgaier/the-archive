/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM — the device, and everything the app is not allowed to touch
   directly.

   Storage, the camera roll, and physical feedback. Four concerns that are the
   browser's rather than the archive's, behind functions the rest of the app
   calls without knowing what's underneath. Nothing else in this codebase
   reaches for localStorage, IndexedDB, or a file input.

   ── This used to be two implementations ────────────────────────────────────

   The archive shipped twice: as this web app, and as a native iOS app with
   Capacitor underneath it. Every function here forked on a NATIVE flag —
   Capacitor's Filesystem plugin on the phone, IndexedDB in the browser; the
   native photo picker on the phone, an <input type="file"> in the browser.

   The native build is gone, and the reason was the loop rather than the
   result: getting a change onto the phone meant Xcode, a cable and a signing
   certificate, against a `git push` and a relaunch for this one. For an
   archive whose main activity is design iteration, that difference is the
   whole product.

   What went with it is real and worth naming here rather than discovering:
   HAPTICS. iOS Safari implements no vibration API at all — navigator.vibrate
   does not exist — so the tick under a folder row is simply not available to a
   web app on this platform. See below.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Feedback ───────────────────────────────────────────────────────────────
   Both of these are deliberately empty.

   The tree tick, the selection tick as a row commits — those were real, they
   were part of how the app felt, and iOS Safari cannot do them. There is no
   web equivalent to fall back to: navigator.vibrate is unimplemented in
   WebKit, and the switch-element trick that gets passed around is a bug being
   exploited rather than an API.

   They stay as functions, called from all fifteen places they were called
   from, because they are the SEAMS where physical feedback belongs. Deleting
   the calls would scatter the loss across nine files and lose the record of
   where the app wanted to be felt. One file holds it instead, and if WebKit
   ever ships vibration these are the two functions that change. */

export function tick() { /* no haptics on the web — see above */ }
export function selectionTick() { /* likewise */ }

/* ── The content index ──────────────────────────────────────────────────────
   One JSON document under one key. ~290 nodes, a few hundred KB — well inside
   what localStorage holds, and it is read once at boot and written on change,
   which is the access pattern localStorage is actually good at.

   THIS IS NOT DURABLE STORAGE and the app should not pretend otherwise. iOS
   ages out script-writable storage, it is outside the device backup, and
   "Clear Website Data" takes it. The seeded content survives regardless — it
   ships in the repo and re-downloads. Anything written here does not, until
   there is an export. That is the next thing this app needs. */

const INDEX_KEY = 'archive.index';

export async function readIndex() {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return null;                 // first launch
  try {
    return JSON.parse(raw);
  } catch (e) {
    // A half-written or corrupted index would otherwise throw at boot and take
    // the whole app down with it. Re-seeding loses anything added; failing to
    // start loses that AND the archive.
    console.error('index unreadable, re-seeding', e);
    return null;
  }
}

export async function writeIndex(data) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(data));
  } catch (e) {
    // Quota, or private browsing. Silence here would mean a save that reports
    // success and isn't there after a reload.
    console.error('could not save the index', e);
    throw e;
  }
}

/* ── The palette ────────────────────────────────────────────────────────────
   Two colours and the two things derived from them, under one key. Tiny, read
   once at boot, written when it changes — and, unlike the index, it is read
   SYNCHRONOUSLY, because the alternative is the app painting one colour and
   then another while you watch. Hence no promise here.

   ABSENT MEANS AUTO. There is no "mode: auto" value to store: the archive
   following light and dark mode is the state of having no palette, so setting
   one back to pure black and white removes the key rather than writing black
   and white into it. See js/palette.js, which owns every decision about what
   the two colours mean; this only puts them somewhere.

   The boot script in index.html reads this same key directly, and that is the
   one place in the app allowed to go round this file — it has to run before
   any module does. It writes nothing. */

const PALETTE_KEY = 'archive.palette';

export function readPalette() {
  try {
    return JSON.parse(localStorage.getItem(PALETTE_KEY) || 'null');
  } catch (e) {
    // A palette that won't parse is a palette you can reset by opening the
    // card. Never worth throwing at boot over.
    return null;
  }
}

/** Null clears it, which is what returns the archive to following the phone. */
export function writePalette(pal) {
  try {
    if (pal) localStorage.setItem(PALETTE_KEY, JSON.stringify(pal));
    else localStorage.removeItem(PALETTE_KEY);
  } catch (e) {
    console.error('could not save the palette', e);
  }
}

/* ── Binary media ───────────────────────────────────────────────────────────
   Photographs you add, as blobs in IndexedDB behind object URLs. Not
   localStorage: that is a string store, base64 costs a third again in size,
   and a few hundred photographs would blow its quota on their own.

   Seeded media is not in here at all. It is served as ordinary files out of
   seed/ — the service worker caches it, so it is offline either way, and
   copying 51MB into IndexedDB to own a second identical copy would be waste.
   See media.js for which path goes where. */

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
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await idb('readwrite', (s) => s.put(new Blob([bytes], { type: 'image/jpeg' }), path));
}

/** A URL the page can actually render. */
export async function mediaURL(path) {
  const blob = await idb('readonly', (s) => s.get(path));
  return blob ? URL.createObjectURL(blob) : '';
}

export async function deleteMedia(path) {
  await idb('readwrite', (s) => s.delete(path));
}

export async function readMediaBase64(path) {
  const blob = await idb('readonly', (s) => s.get(path));
  if (!blob) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}

/* ── Camera roll ────────────────────────────────────────────────────────────
   A file input, which on iOS opens the system photo picker and hands back real
   files — so multi-select and the camera are both there without a plugin.

   Resolves to a list of data URLs, which is what media.importImage takes.
   Everything is re-encoded to JPEG on the way in anyway (see media.js), so a
   HEIC straight off an iPhone is handled downstream rather than here. */

export async function pickImages(limit = 12) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = limit > 1;

    input.onchange = async () => {
      const files = Array.from(input.files || []).slice(0, limit);
      resolve(await Promise.all(files.map(blobToDataURL)));
    };

    /* Not every engine fires `cancel`, and a picker dismissed without one would
       leave this promise pending forever — with the caller's "Saving…" toast
       still up. Whichever arrives first wins; a second resolve is a no-op. */
    input.oncancel = () => resolve([]);
    window.addEventListener('focus', () => {
      setTimeout(() => { if (!input.files?.length) resolve([]); }, 400);
    }, { once: true });

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

/* ── Getting things out ─────────────────────────────────────────────────────
   A download, which is the only export a web app has. Nothing calls this yet
   and it is the seam the archive's backup story hangs off: an export shaped
   like seed/ is something you commit to the repo, which makes the repo the
   backup and the sync path at once. See CLAUDE.md. */

export async function writeDocument(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.split('/').pop();
  a.click();
  // Revoked on a delay: revoking synchronously can beat the download starting.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
