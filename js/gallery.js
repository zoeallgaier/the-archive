/* ═══════════════════════════════════════════════════════════════════════════
   GALLERY — the moodboard, the works, and the lightbox they share.

   The packing is done by CSS columns, not JavaScript. There's nothing to
   recompute on rotate, nothing to desync from the DOM, and no measure pass on
   145 tiles at boot. What makes it scroll cleanly in a webview is upstream of
   the layout: 400px thumbnails, real width/height on every <img> so nothing
   reflows as images arrive, and content-visibility so off-screen tiles skip
   paint entirely.

   None of these screens has a top bar. A caption over a wall of images is
   telling you what you can see, and the bar was costing 52px plus a hairline
   at the exact edge where the pictures want to start. `view--bare` moves the
   back button into the floating composer instead — see app.js.

   A gallery's own title is centred, and it's the only centred type in the app.
   Everything else hangs off one left margin because it's a column of things
   you scan; a gallery has exactly one title and then it stops being text, so
   there's no column for it to belong to. Left-aligned it read as the first
   item in a list that never arrived.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import { el, icon, body, empty, toast, confirm } from './ui.js';
import { tick } from './platform.js';

/* ── Moodboard ──────────────────────────────────────────────────────────── */

export function renderBoard(nav) {
  const images = store.children('moodboard/');
  const view = el('div.view.view--bare');
  view.__chrome = { back: true, add: true,
    main: { label: 'Write', onclick: () => nav('#/write') } };
  // Re-enter the same route after a delete, so the grid reflows without the
  // removed tile and the scroll position is preserved by the router.
  const refresh = () => nav(location.hash || '#/moodboard', true);

  const scroll = body();
  scroll.append(images.length ? grid(images, refresh) : empty('No images yet'));
  view.append(scroll);
  return view;
}

/* ── A work ─────────────────────────────────────────────────────────────── */

export function renderWork(slug, nav) {
  const work = store.get(`works/${slug}`);
  const pieces = store.children(`works/${slug}/`);
  const view = el('div.view.view--bare');
  view.__chrome = { back: true, add: true,
    main: { label: 'Write', onclick: () => nav('#/write') } };
  const refresh = () => nav(location.hash, true);

  if (!work) {
    view.append(body(empty('No such work')));
    return view;
  }

  const scroll = body();
  scroll.append(el('header.workhead', {},
    el('h1.workhead__title', { text: work.title }),
    el('div.t-micro.workhead__meta', {
      text: [work.date, `${pieces.length} pieces`].filter(Boolean).join(' · '),
    })));

  scroll.append(pieces.length ? grid(pieces, refresh) : empty('Nothing in here yet'));
  view.append(scroll);
  return view;
}

/* ── Works index — including the literal room for more ──────────────────── */

export function renderWorks(nav) {
  const works = store.children('works/');
  const view = el('div.view.view--bare');
  view.__chrome = { back: true, add: true,
    main: { label: 'Write', onclick: () => nav('#/write') } };

  const scroll = body();
  for (const w of works) {
    const card = el('button.entry', { onclick: () => nav(`#/w/${w.path.split('/').pop()}`) });
    card.append(el('span.entry__date', {
      text: [w.date, `${w.count ?? 0} pieces`].filter(Boolean).join(' · '),
    }));
    card.append(el('div.entry__title', { text: w.title }));
    if (w.thumb) {
      card.append(el('img.entry__thumb', {
        src: media.resolveSync(w.thumb), loading: 'lazy', decoding: 'async', alt: w.title,
      }));
    }
    scroll.append(card);
  }

  // Not a placeholder waiting to be filled — the open slot is part of the
  // design, and it stays after the next series lands.
  const slot = el('div.slot');
  slot.append(icon('plus'));
  slot.append(el('span.t-micro', { text: 'Room for more' }));
  scroll.append(slot);

  view.append(scroll);
  return view;
}

/* ── Grid ───────────────────────────────────────────────────────────────── */

function grid(nodes, onChange) {
  const board = el('div.board');

  for (const node of nodes) {
    const tile = el('button.tile', { onclick: () => openLightbox(node, onChange) });

    // An intrinsic size per tile, from the real aspect ratio, so the scrollbar
    // is honest before a single image has decoded.
    if (node.w && node.h) {
      tile.style.containIntrinsicSize = `auto ${Math.round((node.h / node.w) * 100)}%`;
    }

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
   viewer would just be a place for the two to disagree. */

async function openLightbox(node, onChange) {
  tick();

  const box = el('div.lightbox');
  const img = el('img', { alt: node.title || '', src: await media.resolve(node.media) });
  box.append(img);

  const close = () => {
    box.classList.remove('lightbox--in');
    setTimeout(() => box.remove(), 160);
    window.removeEventListener('popstate', close);
  };

  box.append(el('div.lightbox__bar', {},
    el('button', { 'aria-label': 'Close', onclick: close }, icon('close')),
    el('button', {
      'aria-label': 'Delete',
      onclick: async (e) => {
        e.stopPropagation();
        if (!await confirm('Delete this image?')) return;
        await store.remove(node.path);
        tick('Medium');
        toast('Deleted');
        close();
        onChange?.();
      },
    }, icon('trash'))));

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
