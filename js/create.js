/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — everything you add, and the one control that offers it.

   THE ＋ IS THE FRONT DOOR, and what it opens is the tree: one row per folder,
   in the tree's order, named in the tree's words. That is the whole idea — the
   archive has five places things can go, so adding has five answers, and
   picking one says WHAT you're making and WHERE it goes in the same tap. The
   old ＋ asked "add what?" and then had to ask "where?" anyway; this one can't,
   because "Library" is already both answers.

   IT IS A CARD, like every other question in the app. It used to be a dial: an
   arc of five round buttons swept out of the ＋ on spokes, each carrying its
   folder's mark instead of its name, laid on a radius sized to a right thumb.
   It was aimed rather than read, and that was the argument for it — but it was
   also the only menu in the app with its own geometry, its own ground, its own
   animation and its own five drawings, and the thing it was a menu OF is a
   list of five words. The card was already there, holding every other choice
   the app offers, in the same place at the bottom of the screen. So this is
   five rows of text, and the reason the mark could be dropped from the home
   screen is that this was the last place one had a job.

   Below it, the two things that then actually get made. Writing isn't one of
   them — a new piece is a plain route to the editor, which holds its own state
   and publishes itself.

   A book is here and not in the editor because it isn't a document. It's a
   title, an author and the fact that you read it — three fields and a tap,
   which is a card, not a screen. Making it a screen would mean opening the
   editor to type two words into it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import { card, toast } from './ui.js';
import { pickImages, tick, selectionTick } from './platform.js';

/* What "add" means in each folder — see FOLDERS in store.js for which is
   which. Every one of these already knows its destination by the time it runs,
   which is the entire point of choosing from the tree. */
const MAKE = {
  photos: (folder, nav, done) => photos(folder.prefix, done),
  pieces: (folder, nav, done) => intoWork(done),
  book:   (folder, nav, done) => book(done),
  write:  (folder, nav) => nav(`#/new/${encodeURIComponent(folder.prefix)}`),
};

/* The ＋, opened. Every folder that can be added to, in the order the home
   screen lists them — so the menu reads top to bottom exactly as the tree
   does, and the word you tap here is the word you'll go looking under.

   No counts on these rows. `card.row` will set one, and the tree does, but
   this card is about where a thing is going rather than what is already there;
   a number beside a destination is answering a question nobody asked while
   they were adding. */
export function add(nav, onSaved) {
  const c = card('Add to');

  for (const folder of store.FOLDERS.filter((f) => f.add)) {
    c.row(folder.name, null, () => {
      selectionTick();
      c.close();
      MAKE[folder.add](folder, nav, onSaved);
    });
  }

  c.present();
}

/* ── Photos ─────────────────────────────────────────────────────────────────
   Where they land is settled before the picker opens now, by the row you
   tapped in the ＋ card or by the gallery you were already standing in. It used
   to be asked after picking, on the theory that you decide what an image is
   once you're looking at it — but that was a card in front of every single
   import, answering a question the tap that started it had usually already
   answered. */

export async function photos(into, onSaved) {
  const picked = await pickImages(20);
  if (!picked.length) return;
  await saveImages(picked, into);
  onSaved?.();
}

/* Artwork is the one folder whose name isn't a destination: it holds works,
   and a photograph goes into one of them rather than into the folder.
   So it's the only row in the ＋ card that asks a second question — and it
   asks it before the picker, so the answer is still one card either way. */
function intoWork(onSaved) {
  const works = store.all().filter((n) => n.kind === 'work');
  if (!works.length) { toast('No artwork yet'); return; }

  const c = card('Add to which');
  for (const work of works) {
    c.row(work.title, store.count(`${work.path}/`), () => {
      selectionTick();
      c.close();
      photos(`${work.path}/`, onSaved);
    });
  }
  c.present();
}

async function saveImages(picked, prefix) {
  toast('Saving…');
  let n = 0;

  for (const dataURL of picked) {
    try {
      const m = await media.importImage(dataURL);
      const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await store.add({
        path: `${prefix}${stamp}`,
        kind: 'image',
        media: m.media,
        thumb: m.thumb,
        w: m.w,
        h: m.h,
      });
      n++;
    } catch (e) {
      console.error(e);
    }
  }

  tick('Medium');
  toast(n === picked.length ? `${n} added` : `${n} of ${picked.length} added`);
}

/* ── A book ─────────────────────────────────────────────────────────────────
   Dated today, because the date on a book in this archive is the day you
   finished it — the year it was published is a separate field the migrated
   entries carry and this form doesn't ask for. You just read it; that's the
   fact being recorded. */

const slugify = (s) => (s || '').toLowerCase()
  .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
  .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function book(onSaved) {
  const c = card('Finished reading');

  const title = c.field('Title', { autocapitalize: 'words', enterkeyhint: 'next' });
  const author = c.field('Author', { autocapitalize: 'words', enterkeyhint: 'done' });

  const go = c.action('Add to Library', async () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }

    c.close();
    await store.add({
      path: `reads/${slugify(t) || Date.now().toString(36)}`,
      kind: 'book',
      title: t,
      author: author.value.trim() || undefined,
      date: today(),
    });

    tick('Medium');
    toast('Added');
    onSaved?.();
  });

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); author.focus(); }
  });
  author.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go.click(); }
  });

  c.present();
  setTimeout(() => title.focus(), 320);
}
