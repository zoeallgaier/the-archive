/* ═══════════════════════════════════════════════════════════════════════════
   UI — the small shared vocabulary every view is built from.
   ═══════════════════════════════════════════════════════════════════════════ */

/** el('div.row', {...attrs}, ...children) */
export function el(spec, attrs, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }

  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/** An <svg><use> pointing at the sprite. */
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#ic-${name}`);
  svg.append(use);
  return svg;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-02-09" -> "FEB 9 2026". Parsed by hand: `new Date('2026-02-09')` is
    UTC-midnight and renders as the previous day in any negative timezone. */
export function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[+m[2] - 1]} ${+m[3]} ${m[1]}`;
}

export function fmtYear(iso) {
  const m = /^(\d{4})/.exec(iso || '');
  return m ? m[1] : '';
}

/** The last path segment, humanised: "notes/apathy-toward-nuance" -> the slug. */
export const leaf = (path) => path.split('/').pop();

/** A display name for a node — its title if it has one, else its slug. */
export const label = (node) => node.title || leaf(node.path);

/* There is no top bar. Every screen's chrome lives in the composer at the
   bottom edge instead — see dressComposer in app.js — and the last header in
   the app went when the essays list adopted the shared head below. */

/** A scrolling body region. */
export function body(...kids) {
  return el('div.body.scroller', {}, ...kids);
}

/* ── Page head ──────────────────────────────────────────────────────────────
   The head every titled screen shares: a centred display title and one line of
   caps-micro under it. An essay puts its date there, a gallery puts the number
   of pieces, and the editor puts the four formatting marks — same slot, same
   11px caps, so the three screens keep one rhythm and the editor can promise
   that what you write is what you'll read.

   `meta` may be a string or an element, which is the whole reason the editor
   can hang four buttons where the reader hangs a date. */
export function head(title, meta) {
  return el('header.head', {},
    el('h1.head__title', { text: title }),
    meta === null || meta === undefined || meta === ''
      ? null
      : (meta.nodeType ? meta : el('div.head__meta', { text: meta })));
}

/** The region a head introduces — the measure and the side margin live here. */
export function page(...kids) {
  return el('article.page', {}, ...kids);
}

export function empty(text) {
  return el('div.empty', {}, el('span.t-micro', { text }));
}

/* ── Card ───────────────────────────────────────────────────────────────────
   Every question the app asks is asked here, in one shape.

   It is the composer, expanded. Same blur, same tint, same hairline, same
   distance off the bottom edge — and while it's up the composer itself steps
   aside, so what you see is the row you just tapped having grown into the
   question it needed to ask. That's why this replaced the bottom sheet: a
   sheet is a second surface sliding over the app from somewhere else, and it
   made choosing a folder feel like leaving the screen to fill in a form.

   Built by calling rather than configuring — `.row()`, `.field()`, `.action()`
   in whatever order the caller needs, then `.present()`. Nothing half-built
   ever animates in. */

export function card(title, onClose) {
  const scrim = el('div.card-scrim');
  const wrap = el('div.card');
  const panel = el('div.card__panel');
  const list = el('div.card__list.scroller');

  let closed = false;
  const composer = document.getElementById('composer');

  // Every route out lands here — a choice, the scrim, Cancel, or a swipe back.
  // onClose therefore fires exactly once however the card went away, which is
  // what makes a confirmation built on this sound.
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('card--in');
    scrim.classList.remove('card-scrim--in');
    composer?.classList.remove('composer--away');
    window.removeEventListener('popstate', close);
    setTimeout(() => { wrap.remove(); scrim.remove(); }, 300);
    onClose?.();
  };

  if (title) panel.append(el('div.card__head', {}, el('span.t-micro', { text: title })));
  panel.append(list);
  wrap.append(panel);

  scrim.addEventListener('click', close);
  window.addEventListener('popstate', close);

  const api = {
    close,

    /** A choice. The label carries the row; the meta is the count beside it.
        Tested against null rather than for truth — an empty folder's count is
        0, and 0 is exactly the number worth showing. */
    row(label, meta, onclick) {
      list.append(el('button.card__row', { onclick },
        el('span.card__name', { text: label }),
        meta === null || meta === undefined
          ? null
          : el('span.card__meta', { text: String(meta) })));
      return api;
    },

    /** A line of text to fill in, set in the same type as the row above it. */
    field(placeholder, attrs) {
      const input = el('input.card__field', {
        type: 'text', placeholder, spellcheck: 'true', ...attrs,
      });
      list.append(input);
      return input;
    },

    /** A statement rather than a question — the body of a confirmation. */
    say(text) {
      list.append(el('p.card__say', { text }));
      return api;
    },

    /** The affirmative, always last, always the full width of the card. */
    action(label, onclick) {
      const b = el('button.card__go', { text: label, onclick });
      panel.append(b);
      return b;
    },

    present() {
      // The composer is the thing that opened this. It gets out of the way
      // rather than stacking, so there's only ever one row at the bottom edge.
      composer?.classList.add('composer--away');
      document.body.append(scrim, wrap);
      requestAnimationFrame(() => {
        scrim.classList.add('card-scrim--in');
        wrap.classList.add('card--in');
      });
    },
  };

  return api;
}

/** A destructive confirmation, as a card. Resolves true only if confirmed —
    every other way out (scrim, swipe, cancel) resolves false. */
export function confirm(question, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    let choice = false;
    const c = card(null, () => resolve(choice));
    const answer = (v) => { choice = v; c.close(); };

    c.say(question);
    c.row('Cancel', null, () => answer(false));
    c.action(confirmLabel, () => answer(true));
    c.present();
  });
}

/* ── Toast ──────────────────────────────────────────────────────────────── */

let toastTimer = null;

export function toast(text) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  clearTimeout(toastTimer);

  const t = el('div.toast', { text });
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('toast--in'));

  toastTimer = setTimeout(() => {
    t.classList.remove('toast--in');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}
