/* ═══════════════════════════════════════════════════════════════════════════
   TREE — the home screen.

   Five words in the middle of the screen. Everything else is a consequence of
   tapping one of them.

   No chevrons, no title over the top, AND NO MARKS. The signals are face,
   size, ink, air — and a number at the far right, which is the one piece of
   information a word can't carry: how much is in there. The archive should
   look like a table of contents, not a file browser.

   Each word used to carry its folder's icon in the left margin, the same
   drawing the ＋ spent to add to that folder. Both are gone. The ＋ opens a
   card of the same five names now, so there is no menu left anywhere in the
   app that had to fit a folder into a button too small for a word — and here
   there was a word already, at 30px, saying the same thing better. The icon
   beside it was a second name for something already named, it pushed the whole
   tree 36px off the margin to make a column for itself, and five little
   diagrams down the left of a contents page is the file-browser look this
   screen is against.

   So the words now start on --page-x, the same left edge as the type on every
   other screen in the app.

   The five words are the archive's own order, loosest to tightest: the things
   you look at without reading, then the work, then what you read, then what
   you finished writing, then what you didn't. See FOLDERS in store.js — the
   words on screen and the folders on disk are deliberately different things.

   Each folder and its children are wrapped in one <section.branch>, so the
   hairline between branches is a border on a single element rather than
   something the folder row and the kids box have to agree about. It also means
   an open folder can never be separated from its own contents by a rule.

   Folders start closed. The home screen's job is to show you the SHAPE of the
   archive; the contents are one tap away and shouldn't be shouting on arrival.

   "Fluid" means height is measured and animated rather than snapped, and
   children stagger in behind it. Nothing pops.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import { el, label, fmtDate, fmtYear } from './ui.js';
import { tick, selectionTick } from './platform.js';

/* Which folders are open survives navigation — coming back from an essay
   returns you to the shape you left. Empty at boot, by design. */
const open = new Set();

export function render(nav) {
  const view = el('div.view');

  const tree = el('nav.tree');
  for (const folder of store.FOLDERS) {
    tree.append(branch(folder, nav));
  }

  // margin:auto rather than justify-content:center — it centres a short tree
  // and still scrolls a tall one without clipping the top off.
  view.append(el('div.body.scroller.body--center', {}, tree));
  return view;
}

/* ── Folder rows ────────────────────────────────────────────────────────── */

/* The word, and how many things are in it. Direct children, not the whole
   subtree: works holds two works, and saying 22 because it also contains their
   pieces would be counting a different noun. */
function folderButton(folder, extra) {
  return el('button.folder', extra,
    el('span.folder__name', { text: folder.name }),
    el('span.folder__count', { text: String(store.children(folder.prefix).length) }));
}

function branch(folder, nav) {
  const box = el('section.branch');

  // A folder that opens rather than expands: same word, one tap straight into
  // the view that can actually show it.
  if (folder.mode === 'open') {
    const row = folderButton(folder);
    row.addEventListener('click', () => { tick(); nav(folder.route); });
    box.append(row);
    return box;
  }

  const kids = store.children(folder.prefix);
  const isOpen = open.has(folder.name);

  const row = folderButton(folder, { 'aria-expanded': String(isOpen) });
  if (isOpen) row.classList.add('folder--open');

  const kidsBox = el('div.kids');
  // An empty folder still opens. It says so, rather than looking broken —
  // Notes starts life with nothing in it and that's a normal state, and
  // the ＋ in the corner is how you change that from anywhere in the app.
  if (kids.length) {
    for (const node of kids) kidsBox.append(leaf(node, folder.treat, nav));
  } else {
    kidsBox.append(el('div.node.node--inert', {},
      el('span.node__name.node__name--void', { text: 'Nothing here yet' })));
  }

  if (isOpen) {
    kidsBox.classList.add('kids--open', 'kids--in');
    stagger(kidsBox);
  }

  row.addEventListener('click', () => {
    const nowOpen = !open.has(folder.name);
    if (nowOpen) open.add(folder.name); else open.delete(folder.name);
    row.classList.toggle('folder--open', nowOpen);
    row.setAttribute('aria-expanded', String(nowOpen));
    toggle(kidsBox, nowOpen);
    tick();
  });

  box.append(row, kidsBox);
  return box;
}

/* ── Leaves ─────────────────────────────────────────────────────────────────
   ONE SHAPE, five folders. Every leaf is a title at --t-row with one line of
   caps-micro under it, in that order, at that size, whatever it happens to be
   a leaf of. Essays used to break the pattern — a bigger title with its
   date standing above it, inherited from the feed this replaced — and the
   result was that opening the fourth folder changed the type size of the
   screen. The home screen is a contents page: its job is to make five
   different kinds of thing look like one list.

   So all that varies between folders is what the second line SAYS, and whether
   the row goes anywhere:

     essay  the date, or DRAFT
     work   the year, and how many pieces
     read   who wrote it, and the day you finished it

   Reads are inert on purpose. A book here is a record that it was read, not a
   document: there is no body, no images, no link — a page for one would be the
   same two lines you're already looking at, on a screen of their own. So the
   list IS the content, and the folder holds it.

   Which is exactly why the date belongs on that line. The record is *that you
   read it*, and a record of an event without its date is half a record. The
   date shown is the day you finished, not the year of publication: `year` is a
   fact about the book, `date` is the fact about you, and this is the second
   kind of list.

   An unpublished piece says DRAFT where its date would go. That's the whole
   difference: it's in the tree, it opens, it's yours — it just hasn't been
   dated yet, because the date an essay carries should be the day you decided
   it was finished, not the day you opened a blank one. */

const TREAT = {
  essay: { sub: (n) => (n.draft ? 'Draft' : fmtDate(n.date)) },
  read:  { inert: true, sub: (n) => [n.author, fmtDate(n.date)]
                                      .filter(Boolean).join(' · ') },
  work:  { sub: (n) => [fmtYear(n.date), n.count && `${n.count} pieces`]
                        .filter(Boolean).join(' · ') },
};

function leaf(node, treat, nav) {
  const t = TREAT[treat] || {};
  const text = t.sub ? t.sub(node) : '';

  const row = el(`${t.inert ? 'div' : 'button'}.node`
    + `${t.inert ? '.node--inert' : ''}${node.draft ? '.node--draft' : ''}`, {},
    el('span.node__name', { text: label(node) }),
    text ? el('span.node__sub', { text }) : null);

  if (!t.inert) {
    row.addEventListener('click', () => { selectionTick(); nav(routeFor(node)); });
  }
  return row;
}

export function routeFor(node) {
  // A work folder opens its gallery; a piece inside one opens the same
  // gallery, because the set is the unit, not the single image.
  if (node.path.startsWith('works/')) return `#/w/${node.path.split('/')[1]}`;
  if (node.path.startsWith('moodboard/')) return '#/moodboard';
  return `#/e/${encodeURIComponent(node.path)}`;
}

/* ── The expansion itself ───────────────────────────────────────────────────
   Height animates from a measured number, then is released to auto so the
   folder can grow later (a new essay) without being pinned to a stale pixel
   value. The stagger is applied as an inline transition-delay per child and
   cleared afterwards, so it only ever costs anything during the open. */

function toggle(box, opening) {
  const h = box.scrollHeight;

  if (opening) {
    box.classList.remove('kids--open');
    box.style.height = '0px';
    stagger(box);
    // Two frames: one to commit height:0, one to start the transition from it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      box.style.height = `${h}px`;
      box.classList.add('kids--in');
    }));
    once(box, () => {
      box.style.height = '';
      box.classList.add('kids--open');
      clearStagger(box);
    });
  } else {
    box.classList.remove('kids--open');
    box.style.height = `${h}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      box.style.height = '0px';
      box.classList.remove('kids--in');
    }));
    once(box, () => clearStagger(box));
  }
}

function stagger(box) {
  const kids = box.children;
  // Cap the ramp: 33 books at full stagger would take most of a second to
  // finish, and the last one would arrive after you'd stopped looking.
  const step = Math.min(22, 400 / Math.max(kids.length, 1));
  for (let i = 0; i < kids.length; i++) {
    kids[i].style.transitionDelay = `${Math.min(i * step, 260)}ms`;
  }
}

function clearStagger(box) {
  for (const kid of box.children) kid.style.transitionDelay = '';
}

/** Run once when this element's own height transition ends. */
function once(node, fn) {
  const handler = (e) => {
    if (e.target !== node || e.propertyName !== 'height') return;
    node.removeEventListener('transitionend', handler);
    fn();
  };
  node.addEventListener('transitionend', handler);
}
