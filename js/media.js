/* ═══════════════════════════════════════════════════════════════════════════
   MEDIA — where an image path turns into something the page can render, and
   where a photo from the camera roll turns into a stored one.

   Two origins, one resolver:
     "media/user/…"  → added by you, a blob in IndexedDB behind an object URL
     anything else   → seeded, an ordinary file under seed/, cached by sw.js
   ═══════════════════════════════════════════════════════════════════════════ */

import { mediaURL, writeMedia } from './platform.js';

const FULL_PX = 1600;   // ceiling for a stored photo — matches the old publisher
const THUMB_PX = 400;   // grid tile; the full image is only ever for the lightbox

const cache = new Map();

/** Resolve a node's media/thumb path to a usable URL. */
export async function resolve(path) {
  if (!path) return '';
  if (cache.has(path)) return cache.get(path);

  const url = path.startsWith('media/user/')
    ? await mediaURL(path)
    : `seed/${path}`;

  cache.set(path, url);
  return url;
}

/** Synchronous resolve for seeded paths — lets the grid render without awaiting. */
export function resolveSync(path) {
  if (!path) return '';
  if (path.startsWith('media/user/')) return cache.get(path) || '';
  return `seed/${path}`;
}

/* ── Paths inside essay HTML ────────────────────────────────────────────────
   Different problem from the two above. An <img> inside a stored essay body
   carries a path relative to the seed folder, because that's where the
   migration put it; the reader renders it from the app root and the editor
   writes it back. Both directions have to agree exactly or an essay containing
   a photo grows a `seed/` on every save.

   Only seed media goes through here. Images can't be inserted into a body from
   inside the app, so a body never contains a media/user/ path — and if that
   ever changes, it needs mediaURL() and an await, not a string prefix. */

export const toSrc   = (s) => ((s || '').startsWith('media/') ? `seed/${s}` : (s || ''));
export const fromSrc = (s) => ((s || '').startsWith('seed/media/') ? s.slice(5) : (s || ''));

/* ── Import ─────────────────────────────────────────────────────────────────
   A data URL in, a stored pair of files out. Everything is re-encoded to JPEG:
   HEIC off an iPhone won't render in the webview, and the canvas round-trip
   converts it as a side effect of the resize. */

export async function importImage(dataURL) {
  const img = await loadImage(dataURL);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const full = draw(img, FULL_PX);
  const thumb = draw(img, THUMB_PX);

  const fullPath = `media/user/${stamp}.jpg`;
  const thumbPath = `media/user/${stamp}-t.jpg`;

  await writeMedia(fullPath, toBase64(full.canvas, 0.86));
  await writeMedia(thumbPath, toBase64(thumb.canvas, 0.72));

  // Prime the cache so the new image appears immediately, before any reload.
  cache.set(fullPath, await mediaURL(fullPath));
  cache.set(thumbPath, await mediaURL(thumbPath));

  return { media: fullPath, thumb: thumbPath, w: full.w, h: full.h };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/** Fit inside max on the longest side. Never upscales a small image. */
function draw(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

const toBase64 = (canvas, q) => canvas.toDataURL('image/jpeg', q).split(',')[1];
