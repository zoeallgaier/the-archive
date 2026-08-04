/* ═══════════════════════════════════════════════════════════════════════════
   SERVICE WORKER — what makes the URL an app rather than a page.

   The archive used to ship a native iOS build that bundled every asset on the
   device, and this file is what took its place. Without it a homescreen icon is
   a bookmark: it shows a browser error on the underground while holding a
   manifest that promises a standalone app.

   So this is not an optimisation. It is the offline guarantee the whole
   delivery model now rests on, and there is no bundled fallback behind it.

   ── The two strategies, and which files get which ──────────────────────────

   The rule is what a file's URL PROMISES about its contents.

     NETWORK FIRST — the app itself, and the index.

       index.html, the CSS, the modules, seed/index.json. These paths never
       change and their contents change on every deploy, so a cache-first
       strategy would pin a phone to whatever version it first saw and no
       amount of reloading would ever move it. That is the failure mode worth
       designing against here: a stale app is not merely old, it is unfixable
       from the outside, and this is the sandbox the whole review workflow runs
       through. So the network is asked first and the cache is the fallback for
       when there isn't one.

     CACHE FIRST — everything whose bytes are settled.

       Fonts, icons, and seed media. A photograph at seed/media/moodboard/<hash>
       is named after its own contents; it cannot change without changing its
       URL. There is no version to be stale about, and these are the files worth
       having offline — 200 photographs is the archive, and re-fetching them to
       confirm they're the same photographs is the whole cost of the page.

   Media is cached AS IT IS ASKED FOR rather than precached. Precaching the
   moodboard would mean pulling ~40MB on first visit, most of it images that
   are below the fold of a screen nobody has opened yet.

   ── Updating ───────────────────────────────────────────────────────────────

   skipWaiting and clients.claim, deliberately: this is a private archive with
   one reader, there is no cross-tab consistency problem worth protecting, and
   the thing that matters is that a deploy lands on the phone at the next launch
   without a dance. Bump VERSION to drop every cached byte and start again.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = 'v3';
const CACHE = `archive-${VERSION}`;

/* The app, and the one file it cannot start without. Small enough to fetch in
   one go on first visit, and the whole of it is needed before anything renders,
   so there is nothing to be gained by fetching it lazily. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/base.css',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/tree.js',
  'js/entries.js',
  'js/gallery.js',
  'js/editor.js',
  'js/create.js',
  'js/search.js',
  'js/media.js',
  'js/platform.js',
  'js/palette.js',
  'js/ui.js',
  'fonts/oxygen-300.woff2',
  'fonts/oxygen-300-ext.woff2',
  'fonts/oxygen-700.woff2',
  'fonts/oxygen-700-ext.woff2',
  'fonts/ripoff-thin.woff2',
  'fonts/ripoff-normal.woff2',
  'seed/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually rather than cache.addAll: addAll rejects as a unit, so one
    // file 404ing during a half-finished deploy would leave the app with no
    // offline copy of anything at all.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n === CACHE ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

/* Named after their contents, or shipped once and never touched. */
const immutable = (url) =>
  /\/(fonts|icons)\//.test(url.pathname)
  || /\/seed\/(media|thumbs|essays)\//.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Someone else's server is not this app's to cache or to answer for.
  if (url.origin !== self.location.origin) return;

  e.respondWith(immutable(url) ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    /* A navigation to any route has to land on the app. Routes are hashes, so
       every one of them IS index.html as far as the server is concerned — but
       a cold offline start on a deep link still arrives here with nothing
       matching, and answering with a browser error page would be the app
       failing to open rather than opening on the wrong screen. */
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}
