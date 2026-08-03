/* ═══════════════════════════════════════════════════════════════════════════
   APP — boot, routing, view swapping.

   Routes are hashes so back/forward work for free in the webview, including
   the swipe-back gesture. The composer is not a route: it sits over whatever
   you're looking at, because deciding to make something shouldn't cost you
   your place — and because it is now the app's only chrome, it has to outlive
   every view swap. See dressComposer below.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as tree from './tree.js';
import * as entries from './entries.js';
import * as gallery from './gallery.js';
import * as editor from './editor.js';
import * as create from './create.js';
import { el } from './ui.js';
import { selectionTick } from './platform.js';

const mount = document.getElementById('view');

const pill = {
  back:  document.getElementById('composer-back'),
  edit:  document.getElementById('composer-edit'),
  trash: document.getElementById('composer-trash'),
  main:  document.getElementById('composer-main'),
  add:   document.getElementById('composer-add'),
};

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

/* ── Render ─────────────────────────────────────────────────────────────── */

async function render() {
  const hash = location.hash || '#/';

  const scroller = mount.querySelector('.scroller');
  if (currentRoute && scroller) scrollMemory.set(currentRoute, scroller.scrollTop);

  const view = await routeTo(hash);

  mount.replaceChildren(...view.childNodes);
  mount.className = view.className;
  currentRoute = hash;

  const next = mount.querySelector('.scroller');
  if (next) next.scrollTop = scrollMemory.get(hash) || 0;

  dressComposer(view.__chrome);
}

/* ── The composer's shape ───────────────────────────────────────────────────
   No screen in this app has a header, so every action that would have lived in
   one lives in the bottom row instead. A view says what it needs by hanging a
   __chrome object off itself:

     back    show the back pill
     edit    a function — show the edit pill and call it
     trash   a function — same, for delete
     add     show ＋
     main    { label, onclick } for the wide pill

   A property on the element rather than a route table here, because the screen
   is the thing that knows what it can do — and because a route table would
   have to be edited every time a view learned a new trick. Anything the view
   doesn't ask for collapses to zero width; see the morph in app.css. */

const HOME_CHROME = {
  add: true,
  main: { label: 'Write', onclick: () => nav('#/write') },
};

let actions = {};

function dressComposer(chrome) {
  const c = chrome || HOME_CHROME;
  actions = c;

  pill.back.toggleAttribute('data-on', !!c.back);
  pill.edit.toggleAttribute('data-on', !!c.edit);
  pill.trash.toggleAttribute('data-on', !!c.trash);
  pill.add.toggleAttribute('data-on', !!c.add);

  const main = c.main || null;
  pill.main.hidden = !main;
  if (main) pill.main.textContent = main.label;
}

async function routeTo(hash) {
  const [, head, arg] = hash.split('/');
  const decoded = arg ? decodeURIComponent(arg) : '';

  switch (head) {
    case '':
    case undefined:
      return tree.render(nav);

    case 'marginalia':
      return entries.renderList('marginalia/', 'Marginalia', nav);

    // No 'reads' route. A book here is a title and an author, which is exactly
    // what the tree already shows — see the note in tree.js.

    case 'e':
      return entries.renderReader(decoded, nav);

    case 'write':
      return editor.render(decoded || null, nav);

    case 'moodboard':
      return gallery.renderBoard(nav);

    case 'works':
      return gallery.renderWorks(nav);

    case 'w':
      return gallery.renderWork(decoded, nav);

    default:
      return tree.render(nav);
  }
}

/* Handlers are bound once, to the buttons, and read whatever the current
   screen put in `actions`. Rebinding on every render would leak a listener per
   navigation, and the buttons genuinely are the same five objects throughout
   the life of the app. */

pill.back.addEventListener('click', () => { selectionTick(); goBack(); });
pill.edit.addEventListener('click', () => { selectionTick(); actions.edit?.(); });
pill.trash.addEventListener('click', () => { actions.trash?.(); });
pill.add.addEventListener('click', () => { selectionTick(); create.something(() => render()); });
pill.main.addEventListener('click', () => { selectionTick(); actions.main?.onclick?.(); });

/* ── Boot ───────────────────────────────────────────────────────────────── */

window.addEventListener('hashchange', () => { moved = true; render(); });

store.load()
  .then(render)
  .catch((err) => {
    console.error(err);
    mount.replaceChildren(el('div.empty', {},
      el('span.t-micro', { text: 'Could not load the archive' })));
  });
