/* ═══════════════════════════════════════════════════════════════════════════
   ENTRIES — the marginalia and reads lists, and the reader.

   No tags, no filter bar, no kind badges. A date and a title, in reverse
   chronological order. An archive is not a feed and does not need to be
   sliced; if you're looking for something you know roughly when you wrote it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import { el, icon, topbar, body, empty, label, fmtDate, toast, confirm } from './ui.js';
import { selectionTick, tick } from './platform.js';

/* ── List ───────────────────────────────────────────────────────────────── */

export function renderList(prefix, title, nav) {
  const view = el('div.view');
  view.append(topbar({ label: title, back: () => nav('#/') }));

  const items = store.children(prefix);
  const scroll = body();

  if (!items.length) {
    scroll.append(empty('Nothing here yet'));
  } else {
    for (const node of items) scroll.append(entry(node, nav));
  }

  view.append(scroll);
  return view;
}

function entry(node, nav) {
  const card = el('button.entry', {
    onclick: () => { selectionTick(); nav(`#/e/${encodeURIComponent(node.path)}`); },
  });

  if (node.date) card.append(el('span.entry__date', { text: fmtDate(node.date) }));
  card.append(el('div.entry__title', { text: label(node) }));
  if (node.author) card.append(el('div.entry__by', { text: node.author }));
  if (node.note) card.append(el('div.entry__note', { text: node.note }));

  if (node.media) {
    const img = el('img.entry__thumb', {
      loading: 'lazy', decoding: 'async', alt: node.title || '',
      src: media.resolveSync(node.thumb || node.media),
    });
    if (!img.getAttribute('src')) {
      media.resolve(node.thumb || node.media).then((u) => { img.src = u; });
    }
    card.append(img);
  }

  return card;
}

/* ── Reader ─────────────────────────────────────────────────────────────── */

export async function renderReader(path, nav) {
  const node = store.get(path);
  const view = el('div.view.view--bare');

  if (!node) {
    view.__chrome = { back: true };
    view.append(body(empty('That entry is gone')));
    return view;
  }

  /* No header. A bar over an essay can only repeat the title that's already
     the first thing on the page in 38px, and it costs a rule at exactly the
     edge where the reading starts. Back, edit and delete widen into the
     composer instead — the same move the galleries make. */
  view.__chrome = {
    back: true,
    // Write stays. It's the one thing in the row that isn't about the piece
    // you're looking at, and reading something you wrote is the most likely
    // moment to want to write the next one.
    main: { label: 'Write', onclick: () => nav('#/write') },
    // Only an essay has a body to edit; a book is a record, not a document.
    edit: node.kind === 'essay'
      ? () => nav(`#/write/${encodeURIComponent(path)}`)
      : null,
    trash: async () => {
      const ok = await confirm(`Delete “${label(node)}”?`, 'Delete');
      if (!ok) return;
      await store.remove(path);
      tick('Medium');
      toast('Deleted');
      nav('#/', true);
    },
  };

  const article = el('article.reader');
  article.append(el('h1.reader__title', { text: label(node) }));

  const meta = [node.author, node.date && fmtDate(node.date)].filter(Boolean).join(' · ');
  if (meta) article.append(el('div.reader__meta', { text: meta }));

  if (node.media) {
    const img = el('img', {
      alt: node.title || '', decoding: 'async',
      src: media.resolveSync(node.media),
      style: 'width:100%;margin-top:var(--stack-lg);border-radius:var(--r-1)',
    });
    if (!img.getAttribute('src')) media.resolve(node.media).then((u) => { img.src = u; });
    article.append(img);
  }

  // Two body origins, one renderer: migrated essays live as files in the seed,
  // essays written in the app live inline in the index.
  const html = node.bodyInline
    || (node.body ? await fetch(`seed/${node.body}`).then((r) => r.text()).catch(() => '') : '');

  // Where there's a body, the note was only ever the feed teaser and the body
  // opens with the same thought — printing both just says it twice.
  if (node.note && !html) {
    article.append(el('div.prose', {}, el('p', { text: node.note })));
  }

  if (html) {
    const prose = el('div.prose', { html });
    prose.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (src.startsWith('media/')) img.setAttribute('src', `seed/${src}`);
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
    prose.querySelectorAll('a[href^="http"]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
    article.append(prose);
  }

  if (node.url) {
    const link = el('a.gotolink', { href: node.url, target: '_blank', rel: 'noopener' });
    link.append(el('span', { text: node.url.replace(/^https?:\/\//, '') }));
    link.append(icon('link'));
    article.append(link);
  }

  view.append(body(article));
  return view;
}
