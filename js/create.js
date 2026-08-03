/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — the ＋.

   Writing doesn't come through here. The Write pill is a plain route to the
   editor, which holds its own state and publishes itself. What's left is the
   two things you add rather than compose: images, and books you've finished.

   A book is here and not in the editor because it isn't a document. It's a
   title, an author and the fact that you read it — three fields and a tap,
   which is a card, not a screen. Making it a screen would mean opening the
   editor to type two words into it.

   Every question below is asked in a card at the bottom edge, in the composer's
   own type and blur, because the ＋ you tapped is right there and the answer
   should look like it came out of it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import * as media from './media.js';
import { card, toast } from './ui.js';
import { pickImages, tick, selectionTick } from './platform.js';

/** The ＋. Two things you can add; the card asks which. */
export function something(onSaved) {
  const c = card('Add');
  c.row('Photos', null, () => { c.close(); photos(onSaved); });
  c.row('Book', null, () => { c.close(); book(onSaved); });
  c.present();
}

/* ── Photos ─────────────────────────────────────────────────────────────────
   Where they land is asked AFTER they're picked, because you decide what an
   image is once you're looking at it. */

export async function photos(onSaved) {
  const picked = await pickImages(20);
  if (!picked.length) return;

  const c = card(`${picked.length} ${picked.length === 1 ? 'image' : 'images'} — where?`);
  for (const target of store.PHOTO_TARGETS()) {
    c.row(target.label, store.count(target.prefix), async () => {
      selectionTick();
      c.close();
      await saveImages(picked, target.prefix);
      onSaved?.();
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
