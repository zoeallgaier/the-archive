/* ═══════════════════════════════════════════════════════════════════════════
   SEARCH — one field, the whole archive.

   The field itself is not here. It lives in the composer, is bound once in
   app.js, and survives every view swap; this module is what that field looks
   like when it has something to say. Typing in it brings you here, and leaving
   empties it.

   It is only ON two screens, though — the contents page and this one — and no
   other screen carries a button leading here. Searching starts where you'd go
   to look for something anyway, and everywhere else is one back-swipe from it.

   ── What is searched ────────────────────────────────────────────────────────

   Text, and only text. Titles, authors, notes, the folder a thing lives in,
   and — for writing — the actual body text, including the fifteen migrated
   essays whose bodies are files in the seed rather than fields in the index.
   Those are fetched once, on the first search of the session, and held as
   plain text for the rest of it. Fifteen local files is a few milliseconds and
   it's the difference between searching an archive and searching its table of
   contents.

   Images are not in here, because an image has no words. The archive briefly
   grew a tagging mode to give them some, and it was a vocabulary to maintain,
   chips in three different screens, and two hundred photographs to label by
   hand before search would return even one of them. The wall is how you find
   an image; you recognise it in a tenth of a second and no query was going to
   beat that.

   ── The order of the results ────────────────────────────────────────────────

   Writing, then the library, then the artwork. Not by score: by kind, in
   the order that a thing you half-remember is likely to be. A global relevance
   ranking would interleave a book title with a paragraph of an essay, and
   three sentences into reading it you would still be working out which of the
   two you were looking at.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as create from './create.js';
import { el, body, empty, label, fmtDate } from './ui.js';
import { selectionTick } from './platform.js';

/* The screen currently on show, so a keystroke can patch the results without
   going through the router. Null whenever search isn't the visible view. */
let live = null;

/* ── The text of a node ──────────────────────────────────────────────────── */

/* Seed essay bodies, fetched once and kept. Safe to cache forever: a seed file
   is read-only, and the moment you edit one of those essays the editor writes
   an inline body onto the node and the file stops being consulted at all — by
   the reader and by this. */
const seedBodies = new Map();
let bodiesReady = null;

function stripHTML(html) {
  const box = document.createElement('div');
  box.innerHTML = html || '';
  return box.textContent || '';
}

function ensureBodies() {
  if (bodiesReady) return bodiesReady;

  const wanted = store.all().filter((n) => n.body && !n.bodyInline);
  bodiesReady = Promise.all(wanted.map((n) =>
    fetch(`seed/${n.body}`)
      .then((r) => r.text())
      .then((html) => seedBodies.set(n.path, stripHTML(html)))
      // A body that won't load makes that one essay findable by title only,
      // which is exactly what it was before. Not worth failing the search for.
      .catch(() => {})));

  return bodiesReady;
}

/* Everything about a node that is words, lowercased, in one string. Rebuilt
   per query rather than cached: it's a few hundred string joins, it is far
   cheaper than a cache that has to be told when you retitle something, and a
   search that shows stale titles is worse than one that takes a millisecond. */
function haystack(node) {
  return [
    label(node),
    node.author,
    node.note,
    node.year,
    store.folderName(node.path),
    node.path.split('/').pop().replace(/-/g, ' '),
    node.bodyInline ? stripHTML(node.bodyInline) : seedBodies.get(node.path),
  ].filter(Boolean).join(' \n ').toLowerCase();
}

/* Every word has to appear somewhere. AND rather than OR because two words is
   already someone narrowing down — "sapolsky behave" meaning "either of these"
   would return the whole library. */
function matches(node, terms) {
  const hay = haystack(node);
  return terms.every((t) => hay.includes(t));
}

const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

/* ── The screen ─────────────────────────────────────────────────────────── */

export async function render(nav) {
  await ensureBodies();

  const view = el('div.view.view--bare');
  // One of the two screens that holds the field — the other is the contents
  // page you got here from. The ＋ stays because finding nothing is a common
  // reason to go and make something.
  view.__chrome = { back: true, search: true, add: true };

  const results = el('div.results');
  view.append(body(results));

  live = { results, nav };
  // The field, not the value the router happened to hold when this started:
  // ensureBodies() is a real await on the first search of a session, and
  // anything typed during it would otherwise never reach the screen.
  paint(currentQuery());
  return view;
}

/** A keystroke in the composer's field. Only ever patches an on-screen list. */
export function setQuery(query) {
  if (live?.results.isConnected) paint(query);
  else live = null;
}

function paint(query) {
  const { results, nav } = live;
  const q = terms(query);

  // Nothing typed yet. It says what it searches rather than sitting blank,
  // because an empty screen under an open keyboard reads as a screen that
  // failed to load.
  if (!q.length) {
    results.replaceChildren(empty('Titles, authors, and every word written'));
    return;
  }

  /* Images are excluded before matching, not after. A moodboard photo has no
     text to match anyway, but a work's PIECES carry titles — and a piece and
     the work it belongs to open the same gallery, so a query that hit both
     would print the same answer twice. Excluding here rather than when
     grouping also keeps the "nothing for X" test honest: it asks whether there
     is anything to show, not whether anything matched. */
  const hits = store.all().filter((n) => n.kind !== 'image' && matches(n, q));
  if (!hits.length) {
    results.replaceChildren(empty(`Nothing for “${query.trim()}”`));
    return;
  }

  const of = (kind) => hits.filter((n) => n.kind === kind);
  const out = [];

  // Essays are split by which folder they landed in, because in this archive
  // that distinction is the whole difference between a piece and a note.
  push(out, 'Essays', of('essay').filter((n) => n.path.startsWith('marginalia/')), row, nav);
  push(out, 'Notes', of('essay').filter((n) => n.path.startsWith('braindumps/')), row, nav);
  push(out, 'Library', of('book'), row, nav);
  push(out, 'Artwork', of('work'), row, nav);

  results.replaceChildren(...out);
}

/** A titled group, or nothing at all if the group is empty. */
function push(out, title, nodes, make, nav) {
  if (!nodes.length) return;
  out.push(heading(title, nodes.length));
  for (const n of nodes) out.push(make(n, nav));
}

const heading = (title, count) => el('div.results__head', {},
  el('span.t-micro', { text: title }),
  el('span.t-micro.results__count', { text: String(count) }));

/* ── A result ───────────────────────────────────────────────────────────────
   One line of title over one line of context, and nothing else — no snippet
   with the match highlighted in it. A snippet is the right answer when results
   are pages on the open web and you're deciding which stranger's page to open;
   here every result is something you wrote or chose, the title is the thing
   you're trying to remember, and forty words of surrounding paragraph under
   each one turns a list you scan into a page you have to read. */

function row(node, nav) {
  const sub = [
    store.folderName(node.path),
    node.author,
    node.draft ? 'Draft' : fmtDate(node.date),
  ].filter(Boolean).join('  ·  ');

  // A book is a record, not a document — it has no page to open. It does have
  // two verbs, though, so the row opens the card that carries them rather than
  // doing nothing at all. Same rule the tree follows; see bookCard in create.js.
  const isBook = node.kind === 'book';

  const item = el('button.result', {},
    el('span.result__name', { text: label(node) }),
    el('span.result__sub', { text: sub }));

  item.addEventListener('click', () => {
    selectionTick();
    // Repaint from the field rather than re-render the view: the results are a
    // rendering of what's in the composer, and a deleted book should drop out
    // of the list you're looking at without the screen going anywhere.
    if (isBook) create.bookCard(node, () => paint(currentQuery()));
    else nav(routeFor(node));
  });
  return item;
}

function routeFor(node) {
  if (node.kind === 'work') return `#/w/${node.path.split('/').pop()}`;
  return `#/e/${encodeURIComponent(node.path)}`;
}

const currentQuery = () => document.getElementById('composer-search').value;
