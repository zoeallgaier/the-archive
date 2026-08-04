/* ═══════════════════════════════════════════════════════════════════════════
   ENTRIES — the reader.

   There is no list screen here any more. Every folder's contents are already
   on the home screen, in the tree, in the same type — a route that reprinted
   the essays as a column of cards was a second answer to a question the
   contents page had already answered, and it cost a tap to reach the same
   words. What's left is the one screen the tree can't be: the piece itself.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import { el, icon, body, head, page, empty, card, label, fmtDate, toast, confirm } from './ui.js';
import { tick, selectionTick } from './platform.js';

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
     edge where the reading starts. Back and the ⋯ take the two ends of the
     composer instead — the same move the galleries make.

     TWO BUTTONS, NOT FOUR. This screen used to widen edit and delete into the
     row beside back, with the ＋ and the ⌕ in their usual corner, and that is
     four controls standing under a page you are trying to read — three of them
     about administering the piece rather than reading it, all four permanently
     lit, and every one of them reached for a hundred times less often than you
     scroll. They fold into one mark. What the ⋯ opens is below.

     The title itself comes from head(), which the galleries and the editor
     share — so an essay, a series and the draft of an essay all put their
     title in the same place, at the same size, over the same amount of air. */
  view.__chrome = { back: true, more: () => actionsCard(node, path, nav) };

  const meta = [node.author, node.date && fmtDate(node.date)].filter(Boolean).join(' · ');
  const article = page();

  // Two body origins, one renderer: migrated essays live as files in the seed,
  // essays written in the app live inline in the index. Read before anything is
  // appended, because whether the lead image belongs on the page at all is a
  // question only the body can answer — see below.
  const html = node.bodyInline
    || (node.body ? await fetch(`seed/${node.body}`).then((r) => r.text()).catch(() => '') : '');

  /* The lead image is the one the feed used as a thumbnail, and for most
     entries it's a picture the body doesn't contain. For an essay whose body
     already runs that photo in sequence — with a caption, in the place the
     writing put it — printing it again above the first paragraph shows the
     same image twice, the second time explaining itself. The copy inside the
     body is always the better one, so the lead stands down. */
  if (node.media && !(html || '').includes(node.media)) {
    const img = el('img.page__lead', {
      alt: node.title || '', decoding: 'async',
      src: media.resolveSync(node.media),
    });
    if (!img.getAttribute('src')) media.resolve(node.media).then((u) => { img.src = u; });
    article.append(img);
  }

  // Where there's a body, the note was only ever the feed teaser and the body
  // opens with the same thought — printing both just says it twice.
  if (node.note && !html) {
    article.append(el('div.prose', {}, el('p', { text: node.note })));
  }

  if (html) {
    const prose = el('div.prose', { html });
    prose.querySelectorAll('img').forEach((img) => {
      img.setAttribute('src', media.toSrc(img.getAttribute('src')));
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
    });
    prose.querySelectorAll('a[href^="http"]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });
    liveChecklist(prose, node);
    article.append(prose);
  }

  if (node.url) {
    const link = el('a.gotolink', { href: node.url, target: '_blank', rel: 'noopener' });
    link.append(el('span', { text: node.url.replace(/^https?:\/\//, '') }));
    link.append(icon('link'));
    article.append(link);
  }

  const scroller = body(head(label(node), meta), article);
  view.append(scroller);

  // Notes only — see wireTapToEdit. An essay keeps Edit behind the ⋯: it's a
  // finished piece, and turning the whole page into a button would make
  // reading one feel like standing on a trapdoor.
  if (node.kind === 'essay' && path.startsWith('braindumps/')) wireTapToEdit(scroller, path, nav);

  return view;
}

/* ── Notes: notes-app style ──────────────────────────────────────────────────
   A note has no separate reading mode: the page you scroll IS the page you'd
   edit, and a tap is the only thing that tells the two apart. Scrolling (and a
   tap that lands while the view is still coasting from one) must never fall
   into the editor — so this doesn't hand-roll a tap/drag threshold at all. It
   listens for `click`, and lets the webview's own gesture recognizer decide:
   WebKit already withholds `click` after a touch has dragged the scroller, and
   withholds it again when a touch lands only to stop a momentum scroll rather
   than to tap what's under it. That's the exact "leeway for accidental taps"
   asked for, for free — the same assumption liveChecklist already leans on a
   few lines up.

   Two things opt out of becoming an edit: a link, which has somewhere else to
   take you, and a checklist item, which already has a tap of its own — ticking
   the box. Selecting text is the third: closing the note out from under a
   tap meant to copy a sentence would be its own kind of accidental. */
function wireTapToEdit(scroller, path, nav) {
  scroller.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (e.target.closest('ul[data-check] > li')) return;
    if (document.getSelection().toString()) return;
    nav(`#/write/${encodeURIComponent(path)}`);
  });
}

/* ── What the ⋯ opens ───────────────────────────────────────────────────────
   The two verbs that belong to the piece you're looking at, as two lines of
   text. A card rather than a second row of icons: they're rare, they're worth
   naming, and the app already asks every one of its questions in this shape.

   EDIT AND DELETE, AND NOTHING ELSE. The ＋ was in this corner too and it is
   not in the card that replaced it: on a page, the corner is about the page.
   Starting something new from inside a piece you're reading is a different
   errand, and it is one back-swipe away on the contents screen, where the ＋
   is exactly where it always is.

   No title on the card either. Every other card in the app names the thing
   it's asking about — "Add to", "Finished reading" — and this one is standing
   on a page with the title set across the top of it in 38px.

   Delete goes last and is still a question after this one: the card names the
   verb, the confirmation names the piece. */

function actionsCard(node, path, nav) {
  const c = card();

  // Only an essay has a body to edit; a book is a record, not a document.
  if (node.kind === 'essay') {
    c.row('Edit', null, () => {
      selectionTick();
      c.close();
      nav(`#/write/${encodeURIComponent(path)}`);
    });
  }

  c.row('Delete', null, async () => {
    selectionTick();
    c.close();
    if (!await confirm(`Delete “${label(node)}”?`, 'Delete')) return;
    await store.remove(path);
    tick('Medium');
    toast('Deleted');
    nav('#/', true);
  });

  c.present();
}

/* ── Checklists, in the reader ──────────────────────────────────────────────
   A grocery list is not a document you read, it's a thing you use, and you use
   it standing in a shop with the app open on the page — not in the editor. So
   the boxes tick where they're printed.

   Only inline bodies are live. Checklists can only be made in this app, this
   app writes them inline, and a seeded essay has no boxes to tick — so a
   migrated piece is never rewritten by a stray tap. */

function liveChecklist(prose, node) {
  if (!node.bodyInline) return;
  const items = prose.querySelectorAll('ul[data-check] > li');
  if (!items.length) return;

  for (const li of items) {
    li.addEventListener('click', async (e) => {
      // Only the box, not a link the item happens to contain.
      if (e.target.closest('a')) return;
      selectionTick();
      li.toggleAttribute('data-done');
      await store.update(node.path, { bodyInline: serialise(prose) });
    });
  }
}

/** The reader's DOM back to the form it's stored in. */
function serialise(prose) {
  const copy = prose.cloneNode(true);
  for (const img of copy.querySelectorAll('img')) {
    img.setAttribute('src', media.fromSrc(img.getAttribute('src')));
    img.removeAttribute('loading');
    img.removeAttribute('decoding');
  }
  // Reading additions the store has no business keeping.
  for (const a of copy.querySelectorAll('a[target]')) {
    a.removeAttribute('target');
    a.removeAttribute('rel');
  }
  return copy.innerHTML;
}
