/* ═══════════════════════════════════════════════════════════════════════════
   GALLERY — The Vibe, the artwork, and the lightbox they share.

   The packing is done by CSS columns, not JavaScript. There's nothing to
   recompute on rotate, nothing to desync from the DOM, and no measure pass on
   two hundred tiles at boot. What makes it scroll cleanly in a webview is
   upstream of the layout: 400px thumbnails, real width/height on every <img>
   so nothing reflows as images arrive, and content-visibility so off-screen
   tiles skip paint entirely.

   None of these screens has a top bar. A caption over a wall of images is
   telling you what you can see, and the bar was costing 52px plus a hairline
   at the exact edge where the pictures want to start. `view--bare` moves the
   back button into the floating composer instead — see app.js.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import * as create from './create.js';
import { el, body, head, empty, toast, confirm } from './ui.js';
import { tick } from './platform.js';
import { borrowComposer } from './app.js';

/* ── The Vibe ───────────────────────────────────────────────────────────── */

export function renderBoard(nav) {
  const images = store.children('moodboard/');
  const view = el('div.view.view--bare');
  // Re-enter the same route after a delete, so the grid reflows without the
  // removed tile and the scroll position is preserved by the router.
  const refresh = () => nav(location.hash || '#/moodboard', true);

  const scroll = body();
  view.append(scroll);

  /* The ＋ here doesn't ask which folder. On a gallery that question has
     already been answered by the screen you're standing on, so the button goes
     straight to the picker. */
  view.__chrome = {
    back: true,
    add: () => create.photos('moodboard/', refresh),
  };

  scroll.append(images.length ? grid(images, refresh) : empty('No images yet'));
  return view;
}

/* ── One work ───────────────────────────────────────────────────────────── */

export function renderWork(slug, nav) {
  const work = store.get(`works/${slug}`);
  const pieces = store.children(`works/${slug}/`);
  const view = el('div.view.view--bare');
  const refresh = () => nav(location.hash, true);

  if (!work) {
    view.__chrome = { back: true, add: true };
    view.append(body(empty('No such work')));
    return view;
  }

  const scroll = body();
  scroll.append(head(work.title,
    [work.date, `${pieces.length} pieces`].filter(Boolean).join(' · ')));
  view.append(scroll);

  view.__chrome = {
    back: true,
    add: () => create.photos(`${work.path}/`, refresh),
  };

  scroll.append(pieces.length ? grid(pieces, refresh) : empty('Nothing in here yet'));
  return view;
}

/* ── Grid ───────────────────────────────────────────────────────────────── */

function grid(nodes, onChange) {
  const board = el('div.board');

  for (const node of nodes) {
    const tile = el('button.tile', {
      onclick: () => openLightbox(node, { onDelete: onChange }),
    });

    /* The tile's real shape, so it occupies its final height before a single
       image has decoded and the wall doesn't reflow under the thumb.

       This was `contain-intrinsic-size: auto <n>%` and it did nothing at all:
       that property takes lengths, a percentage is not a valid value, and the
       declaration was dropped on the floor by every engine. Which left every
       off-screen tile — the ones content-visibility skips — reserving the flat
       300px fallback in app.css regardless of whether the photo was a portrait
       or a panorama, so the scrollbar lied and the grid jumped as you scrolled.

       aspect-ratio is the property that actually says this, it needs no
       fallback, and it holds whether or not the image has arrived. */
    if (node.w && node.h) tile.style.aspectRatio = `${node.w} / ${node.h}`;

    const img = el('img', {
      alt: node.title || '',
      loading: 'lazy',
      decoding: 'async',
      width: node.w || null,
      height: node.h || null,
      src: media.resolveSync(node.thumb || node.media),
    });
    if (!img.getAttribute('src')) {
      media.resolve(node.thumb || node.media).then((u) => { img.src = u; });
    }

    tile.append(img);
    board.append(tile);
  }

  return board;
}

/* ── Lightbox ───────────────────────────────────────────────────────────────
   Full image, swipe down to dismiss. Deliberately not a carousel: the grid is
   the way you move between images, and a second navigation model inside the
   viewer would just be a place for the two to disagree.

   It has no chrome of its own either. Back and delete are the same pills as
   everywhere else, borrowed for as long as the image is up — a viewer with its
   own close button in the top corner was a second set of controls for verbs
   the bottom row already had. */

export async function openLightbox(node, { onDelete } = {}) {
  tick();

  const box = el('div.lightbox');
  const img = el('img', { alt: node.title || '', src: await media.resolve(node.media) });
  box.append(img);

  let release = null;
  const close = () => {
    release?.();
    release = null;
    box.classList.remove('lightbox--in');
    setTimeout(() => box.remove(), 160);
    window.removeEventListener('popstate', close);
  };

  // Back and delete, and nothing else. The ＋ and the ⌕ are on every screen in
  // the app; they are not on this one, because it isn't a screen — it's one
  // photograph, full bleed, and the only two things you can do to it from here
  // are put it down and get rid of it.
  release = borrowComposer({
    back: close,
    trash: async () => {
      if (!await confirm('Delete this image?')) return;
      await store.remove(node.path);
      tick('Medium');
      toast('Deleted');
      close();
      onDelete?.();
    },
  });

  // A swipe back leaves the screen underneath, so the image can't stay up over
  // whatever the router landed on.
  window.addEventListener('popstate', close);

  box.addEventListener('click', (e) => { if (e.target === box || e.target === img) close(); });

  // Swipe down to dismiss, tracking the finger so it feels attached.
  let y0 = null;
  box.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) {
      img.style.transform = `translateY(${dy}px) scale(${Math.max(0.85, 1 - dy / 1200)})`;
      box.style.opacity = String(Math.max(0.3, 1 - dy / 500));
    }
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    const dy = (e.changedTouches[0]?.clientY ?? 0) - (y0 ?? 0);
    y0 = null;
    if (dy > 110) { close(); return; }
    img.style.transition = 'transform var(--fast) var(--ease)';
    img.style.transform = '';
    box.style.opacity = '';
    setTimeout(() => { img.style.transition = ''; }, 180);
  });

  document.body.append(box);
  requestAnimationFrame(() => box.classList.add('lightbox--in'));
}
