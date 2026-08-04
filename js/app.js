/* ═══════════════════════════════════════════════════════════════════════════
   APP — boot, routing, view swapping.

   Routes are hashes so back/forward work for free in the webview, including
   the swipe-back gesture. The composer is not a route: it sits over whatever
   you're looking at, because deciding to make something shouldn't cost you
   your place — and because it is the app's only chrome, it has to outlive
   every view swap. See dressComposer below.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as tree from './tree.js';
import * as entries from './entries.js';
import * as gallery from './gallery.js';
import * as editor from './editor.js';
import * as create from './create.js';
import * as search from './search.js';
import { paletteCard } from './palette.js';
import { el } from './ui.js';
import { selectionTick } from './platform.js';
import { ensure as unlock } from './gate.js';

const mount = document.getElementById('view');
const composer = document.getElementById('composer');

const pill = {
  palette: document.getElementById('composer-palette'),
  back:   document.getElementById('composer-back'),
  trash:  document.getElementById('composer-trash'),
  add:    document.getElementById('composer-add'),
  more:   document.getElementById('composer-more'),
  main:   document.getElementById('composer-main'),
};

const searchShell = document.getElementById('composer-search-shell');
const searchField = document.getElementById('composer-search');

const SEARCH_ROUTE = '#/search';

/* Scroll position per route, so returning to a long list puts you back where
   you were rather than at the top. */
const scrollMemory = new Map();
let currentRoute = null;

/* Whether anything has been navigated to yet this session. Back needs it: on a
   cold launch straight into a deep route there is no history to pop, and
   history.back() would leave the webview sitting on the same screen. */
let moved = false;

function nav(route, replace = false) {
  if (replace) { history.replaceState(null, '', route); render(); }
  else location.hash = route.slice(1);
}

function goBack() {
  if (moved) history.back();
  else nav('#/', true);
}

// Handed to every screen alongside nav itself, so a view that needs to leave
// rather than go somewhere specific — the editor finishing an edit, not
// navigating to one — doesn't have to reach for the bare history.back() that
// goBack() exists to guard. See editor.js's onMain and publish().
nav.back = goBack;

/* ── Render ─────────────────────────────────────────────────────────────── */

async function render() {
  const hash = location.hash || '#/';

  const scroller = mount.querySelector('.scroller');
  if (currentRoute && scroller) scrollMemory.set(currentRoute, scroller.scrollTop);

  /* Leaving search empties the field. A query is a thing you're doing, not a
     setting you left on — coming back to the archive later and finding the
     bottom of every screen still holding a word you typed yesterday reads as
     the app being stuck. */
  if (currentRoute === SEARCH_ROUTE && hash !== SEARCH_ROUTE) {
    searchField.value = '';
    searchField.blur();
  }

  const view = await routeTo(hash);

  mount.replaceChildren(...view.childNodes);
  mount.className = view.className;
  // A swipe may have dragged the outgoing screen halfway off. The new one
  // arrives square, wherever the last one was left.
  mount.style.transition = '';
  mount.style.transform = '';
  currentRoute = hash;

  const next = mount.querySelector('.scroller');
  if (next) next.scrollTop = scrollMemory.get(hash) || 0;

  dressComposer(view.__chrome);
}

/* ── The composer's shape ───────────────────────────────────────────────────
   No screen in this app has a header, so every action that would have lived in
   one lives in the bottom row instead. A view says what it needs by hanging a
   __chrome object off itself:

     palette true to show the palette pill. The home screen only — see below
     back    show the back pill — true to pop history, or a function to run
             instead, for something that isn't a route to leave
     trash   a function — show the delete pill and call it. One caller: the
             lightbox. Everywhere else deleting is a row in the ⋯ card, which
             is where a verb goes once it has to share a screen with others
     add     true to show the ＋ and open the folder menu, or a function to
             run instead, for a screen that already knows where things go
     more    a function — show the ⋯ and call it. For a screen whose verbs are
             several and all belong to the one thing on it; the function opens
             a card that names them. See entries.js.
     search  true to put the live field in the wide slot
     main    { label, onclick } for the wide slot instead

   A property on the element rather than a route table here, because the screen
   is the thing that knows what it can do — and because a route table would
   have to be edited every time a view learned a new trick. Anything the view
   doesn't ask for collapses to zero width; see the morph in app.css.

   THE RIGHT CORNER IS ALWAYS OCCUPIED, and that's the point of the layout.
   Adding is not a property of a screen, it's a property of the archive: you
   can always put something in, so the ＋ sits in the bottom right, doesn't
   move between screens, and the thumb learns it once. The one thing that ever
   takes that spot instead is the ⋯, on a screen where the ＋ would be the
   fourth button under something you're trying to read — and the ⋯ offers it
   anyway, one tap further in. What varies is the left and the middle: back,
   and whatever the wide slot is holding.

   SEARCH IS NOT ON THIS LIST TWICE ANY MORE. There is the field, on the two
   screens that are about searching — the contents page and the results — and
   there is no button anywhere else that leads to it. Every other screen is one
   back-swipe from the contents page, which is where you go to look for
   something in the first place.

   The two screens with neither corner tenant are both doing one thing: the
   editor, where the slot is Publish and offering to start a second piece
   mid-sentence is the same mistake as a Write button on a page you're reading,
   and the lightbox, which borrows the row for back and delete only.

   A note's editor is the one exception, and it carries ⋯ alongside Publish
   rather than instead of it. Merging a note's reading screen into its editor
   (see editor.js) left Delete with nowhere else to live — an essay still has
   a published page to hang its ⋯ on, a note doesn't have a second screen at
   all any more. Two tenants on one screen, here, because the alternative was
   a note that could never be deleted.

   THE LEFT EDGE HAS A SECOND TENANT, ON ONE SCREEN. Left is leaving, and the
   home screen is the one place in the app with nothing to leave — so the slot
   back would occupy is empty there, permanently, and the palette takes it.
   That isn't a compromise with the rule; it is the one screen the rule has
   nothing to say about. Everywhere else the palette pill is collapsed to zero
   and back is exactly where it has always been, so the two never share the row
   and the right corner never moves.

   It is a pill and not a row in the ＋ card because the palette is the one
   control in the app whose effect you judge by looking at the screen behind
   it. A menu two taps deep is where you put something you use once; this is
   something you sit and turn until the archive looks right. */

const HOME_CHROME = { search: true, add: true, palette: true };

let actions = {};

function dressComposer(chrome) {
  const c = chrome || HOME_CHROME;
  actions = c;

  for (const key of ['palette', 'back', 'trash', 'add', 'more']) {
    pill[key].toggleAttribute('data-on', !!c[key]);
  }

  searchShell.toggleAttribute('data-off', !c.search);

  /* The wide slot keeps its width whether or not anything is in it — that's
     what holds back against the left margin and the right pair against the
     right. A screen with neither tenant is emptier, not rearranged. */
  const main = c.main || null;
  pill.main.toggleAttribute('data-off', !main);
  if (main) pill.main.textContent = main.label;
}

/* A screen can change its own mind without changing route. Two callers today:
   the lightbox, which covers everything without being a route and would
   otherwise have to draw a close button and a delete button of its own — back
   is back and trash is trash wherever you are, in the corners your thumb
   already knows; and editor.js's activate(), which puts Done on screen the
   moment a dormant note is actually touched, rather than the moment it's
   merely opened.

   The caller gets its previous shape back as a function to call on the way
   out. `over` lifts the row above a full-screen overlay for as long as it's
   lent out; a mode that stays inside its own view doesn't need it — the
   lightbox uses it, editor.js's dormant note doesn't. */
export function borrowComposer(chrome, over = true) {
  const previous = actions;
  composer.classList.toggle('composer--over', over);
  dressComposer(chrome);

  return () => {
    composer.classList.remove('composer--over');
    dressComposer(previous);
  };
}

async function routeTo(hash) {
  const [, head, arg] = hash.split('/');
  const decoded = arg ? decodeURIComponent(arg) : '';

  switch (head) {
    case 'search':
      return search.render(nav);

    case 'e': {
      // A note has no reading screen of its own any more — see the header
      // comment in editor.js. Every route that used to land on the read-only
      // reader for one opens the live editor instead, dormant until you tap
      // into it — so a tree row, a search result and editor.js's own post-
      // publish nav all still work without any of them having to know this.
      const node = store.get(decoded);
      if (node && node.kind === 'essay' && node.path.startsWith('braindumps/')) {
        return editor.render(decoded, nav);
      }
      return entries.renderReader(decoded, nav);
    }

    // Two doors into the same screen, and the difference is only what the
    // editor is told: `write` opens a piece that exists, `new` opens a blank
    // one belonging to the folder whose row you tapped.
    case 'write':
      return editor.render(decoded || null, nav);

    case 'new':
      return editor.render(null, nav, decoded || null);

    case 'moodboard':
      return gallery.renderBoard(nav);

    case 'w':
      return gallery.renderWork(decoded, nav);

    // No list routes. Every folder either expands in the tree — which is where
    // its contents already are, in the same type, one tap in — or opens
    // straight into the view that can show it. A screen that reprinted a
    // folder the home screen had just printed was a tap spent on nothing.

    default:
      return tree.render(nav);
  }
}

/* Handlers are bound once, to the buttons, and read whatever the current
   screen put in `actions`. Rebinding on every render would leak a listener per
   navigation, and the buttons genuinely are the same objects throughout the
   life of the app. */

pill.back.addEventListener('click', () => {
  selectionTick();
  if (typeof actions.back === 'function') actions.back();
  else goBack();
});
pill.trash.addEventListener('click', () => { actions.trash?.(); });

/* The palette. It takes no argument and belongs to no view — it changes the
   two colours the whole archive is made of, so the card is opened straight
   from here rather than handed down through a screen's chrome. */
pill.palette.addEventListener('click', () => { selectionTick(); paletteCard(); });
pill.main.addEventListener('click', () => { selectionTick(); actions.main?.onclick?.(); });

/* The ＋ is one button with two meanings, and the screen picks which. Off the
   galleries it asks which folder; on a gallery there is nothing to ask,
   because the folder you're standing in is the answer. */
pill.add.addEventListener('click', () => {
  selectionTick();
  if (typeof actions.add === 'function') actions.add();
  else create.add(nav, () => render());
});

/* The ⋯ opens whatever card the screen hung on `more` — the same shape the ＋
   opens, holding the verbs that belong to the one thing on the screen instead
   of the five places a new thing can go. */
pill.more.addEventListener('click', () => { selectionTick(); actions.more?.(); });

/* ── Search ─────────────────────────────────────────────────────────────────
   The field lives here and not in the search screen, which is the whole point
   of it: it is chrome, so it survives every view swap, and typing into it from
   anywhere in the app is what takes you to the results. The screen is a
   rendering of the field, not the other way round.

   Results are patched in place rather than routed on every keystroke — a
   navigation per character would rebuild the view, reset the scroller, and
   push a history entry for every letter of the word you were typing. */

function toSearch() {
  if (location.hash !== SEARCH_ROUTE) nav(SEARCH_ROUTE);
}

searchField.addEventListener('focus', toSearch);
searchField.addEventListener('input', () => {
  if (location.hash !== SEARCH_ROUTE) { toSearch(); return; }
  search.setQuery(searchField.value);
});

// The keyboard's own Search key. There is nothing to submit — results are
// already live — so it does the one useful thing left: gets out of the way.
searchField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); searchField.blur(); }
});

/* ── Swipe back ─────────────────────────────────────────────────────────────
   The system gesture, done in the page, so it works the same in a desktop
   browser — which is where the app is designed — as on the phone.

   ⚠ UNVERIFIED ON DEVICE. This was written against a native build, where the
   webview's own edge gesture could be and was turned off. A standalone
   homescreen web app is a different situation: iOS may offer its OWN edge
   swipe over the history, and every listener below is `passive: true`, so this
   handler cannot preventDefault its way out of a race. If both fire, one
   gesture pops twice and you land two screens back instead of one.

   Check it on the phone before trusting it. If it does double-fire, the fix is
   to notice that a popstate already arrived and skip the goBack() in
   endSwipe() — not to make the listeners non-passive, which would cost the
   scroll performance the whole gallery depends on.

   What sells it is that the screen tracks the finger. The old version of this
   was a swipe that did nothing until you let go, which reads as a dropped
   gesture rather than a gesture in progress.

   Nothing is drawn underneath the sliding view on purpose. iOS reveals the
   previous screen there; this app can't, but every screen's ground is --void
   and the space behind is --void, so what's exposed is the same black the next
   screen is about to be painted on. On an OLED panel there is nothing to see,
   which is exactly right.

   Overlays are skipped. The lightbox and a card both listen for popstate and
   close themselves, so a swipe over one of them should dismiss IT rather than
   drag the screen behind it sideways. */

const EDGE = 24;          // how far in from the left edge a drag may start
const SLOP = 8;           // movement before we commit to calling it a swipe
const COMMIT = 0.3;       // fraction of the width that counts as leaving

let swipe = null;

const overlayUp = () => !!document.querySelector('.lightbox, .card');

document.addEventListener('touchstart', (e) => {
  swipe = null;
  if (e.touches.length !== 1 || overlayUp()) return;
  const t = e.touches[0];
  if (t.clientX > EDGE) return;
  swipe = { x0: t.clientX, y0: t.clientY, live: false };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const dx = e.touches[0].clientX - swipe.x0;
  const dy = e.touches[0].clientY - swipe.y0;

  if (!swipe.live) {
    // Decide once what this gesture is. A drag that starts by going down the
    // screen is someone scrolling a list that happens to reach the left edge.
    if (Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (dx < SLOP) return;
    swipe.live = true;
    mount.style.transition = 'none';
  }

  mount.style.transform = `translateX(${Math.max(0, dx)}px)`;
  swipe.far = dx > window.innerWidth * COMMIT;
}, { passive: true });

function endSwipe(commit) {
  if (!swipe) return;
  const live = swipe.live;
  const far = swipe.far;
  swipe = null;
  if (!live) return;

  mount.style.transition = `transform var(--mid) var(--ease)`;

  if (commit && far) {
    // render() clears the transform as it swaps the view in, so the screen
    // doesn't finish sliding off — it's replaced. Which is what every other
    // route change in this app does.
    mount.style.transform = `translateX(100%)`;
    goBack();
    return;
  }

  mount.style.transform = '';
  setTimeout(() => { mount.style.transition = ''; }, 300);
}

document.addEventListener('touchend', () => endSwipe(true), { passive: true });
document.addEventListener('touchcancel', () => endSwipe(false), { passive: true });

/* ── Boot ───────────────────────────────────────────────────────────────── */

window.addEventListener('hashchange', () => { moved = true; render(); });

// Nothing below this line runs until the gate resolves — see js/gate.js.
unlock()
  .then(() => store.load())
  .then(render)
  .catch((err) => {
    console.error(err);
    mount.replaceChildren(el('div.empty', {},
      el('span.t-micro', { text: 'Could not load the archive' })));
  });
