/* ═══════════════════════════════════════════════════════════════════════════
   PALETTE — the two colours the whole archive is made of, and the card that
   changes them.

   ── WHAT A PALETTE IS ──────────────────────────────────────────────────────

   TWO COLOURS, ONE DARK AND ONE LIGHT, AND THEY SWAP WITH THE PHONE. That is
   the entire setting. In dark mode the dark one is the page and the light one
   is the ink; in light mode they trade places. Nothing else is stored and
   nothing else needs to be.

   That swap is the whole design of this feature. The archive shipped as pure
   black and pure white in either order, following light and dark mode — so a
   palette that stopped following it would have been a downgrade dressed as an
   option: pick a colour on Tuesday afternoon and the archive is still bright
   cream at midnight. Making a palette a PAIR rather than a direction keeps the
   one behaviour the app already had and hands over the two colours it uses.

   And it means the shipped surface is not a special case any more. Auto is a
   palette like the others — pure black and pure white — and it is the one you
   get by not having chosen. Everything below treats them identically.

   Everything else the app draws — the four steps of ink below full, the
   outlines, the pressed wash, the grain, the scrim — is these two colours put
   through the step table in tokens.css, which is where it stays. This file
   computes nothing about how the archive looks; it only says what its two ends
   are. That is why the design survives being recoloured: the doctrine was
   never "black and white", it was "two colours and the distance between them".
   A lit formatting mark still inverts, a card's affirmative is still the ink
   filled solid, a folder word is still the only full-strength thing on the
   home screen.

   ── NO HEX FIELDS ──────────────────────────────────────────────────────────

   There were two, and they are gone. A pair of colours that has to work as a
   page AND as an ink, in both directions, at four steps of transparency, over
   two hundred photographs, is not a thing you get right by typing six digits
   into a phone — every pair in the list below was chosen against the app. The
   card is a list of finished palettes, which is what the rest of the app's
   cards are: a question with named answers.

   ── WHERE IT IS APPLIED ────────────────────────────────────────────────────

   Two CSS custom properties, inline on <html>, which beat every rule in every
   stylesheet — plus data-page, which follows the phone and tells tokens.css
   which of its two step tables applies. See the Surface blocks there.

   Both resolved styles are stored ALONGSIDE the two colours, one per mode, for
   the boot script in index.html: it must run before the first paint, so it
   cannot wait for this module, and duplicating the derivation into a <script>
   tag would be two copies of the same reasoning drifting apart. Instead it
   picks one of two finished strings this file wrote on the previous launch —
   and this file recomputes and rewrites them on every launch, so a change made
   here reaches the boot script one load later and never disagrees with it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readPalette, writePalette, selectionTick } from './platform.js';
import { card, el, toast } from './ui.js';

/* ── The palettes ───────────────────────────────────────────────────────────
   Each is a dark colour and a light one. Which becomes the page and which
   becomes the ink is decided by the phone, every launch, in both directions.

   AUTO IS FIRST AND IT IS PURE BLACK AND PURE WHITE — the archive as it ships,
   and the only one stored as nothing at all. Choosing it removes the key
   rather than writing black and white into it, so "no palette" and "the black
   and white palette" are the same state and cannot come apart. Everything
   below it is a real pair and is kept exactly as given.

   FOUR OF THEM, AND IT WAS SIX. Oxblood, Blueprint and Manila are gone —
   three pairs that were each a tint of a neutral, which is what you get when
   you fill a list by generating variations instead of choosing. Held next to
   Newsprint they were the same idea at three different hues, and a list of
   near-identical answers is a worse question than a short one. What is left is
   a RANGE: black and white, then one that is nearly black and white, then two
   that are not remotely.

   BONDI is the 1998 iMac — deep Bondi Blue against the translucent grey-white
   of the shell it was moulded in. Worth being straight about the date, since
   the archive cares: Bondi Blue was the ONLY colour the iMac came in in 1998.
   The five fruit flavours — Strawberry, Blueberry, Lime, Grape, Tangerine —
   are the 5-flavour revision of January 1999. So there is one '98 iMac pair
   here rather than five, because there was one '98 iMac.

   BRAT is the lime the app icon used to be drawn in, at the album's own green.
   It is the only pair here where the LIGHT colour is the loud one — in light
   mode the whole page goes lime and the type goes black on it, which is either
   the best or the worst thing in this list depending on the hour, and that is
   a decision for the person holding the phone. */

const PRESETS = [
  { name: 'Auto',      dark: '#000000', light: '#ffffff', ships: true },
  { name: 'Newsprint', dark: '#141414', light: '#f2efe7' },
  { name: 'Bondi',     dark: '#004e61', light: '#dfeeed' },
  { name: 'Brat',      dark: '#000000', light: '#8ace00' },
];

/* ── Colour ─────────────────────────────────────────────────────────────────
   Arithmetic on two hex strings. Nothing here is a design value; the design
   values are all in tokens.css and the colours are all in the list above. */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Which way round the two colours go, right now. */
const modeNow = () =>
  (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

/** The page colour for a pair in a given mode. The ink is the other one. */
const pageOf = (pair, mode) => (mode === 'light' ? pair.light : pair.dark);
const inkOf  = (pair, mode) => (mode === 'light' ? pair.dark : pair.light);

const cssFor = (pair, mode) =>
  `--void:${pageOf(pair, mode)};--ink-rgb:${rgb(inkOf(pair, mode)).join(',')}`;

/* ONE NAME CHANGED, AND A STORED PALETTE IS THE ONE PIECE OF STATE IN THIS
   APP THAT SURVIVES A DEPLOY. Acid became Brat and its green moved to the
   album's own #8ACE00, so a phone with Acid selected would come back on a
   colour that is no longer in the list, with no row lit to say which one it
   was on. Migrated on read — boot re-saves whatever this returns, so the old
   name is gone from storage one launch later and this map could be deleted a
   long way down the line. Anything not in here is kept exactly as stored. */
const RENAMED = { Acid: 'Brat' };

/* The pair that means "no palette" — see the header. Compared on both colours
   rather than by name, so a preset that happens to BE black and white would
   store nothing too, and there is exactly one representation of that state. */
const isShipped = (pair) =>
  pair.dark.toLowerCase() === '#000000' && pair.light.toLowerCase() === '#ffffff';

/* ── Applying ───────────────────────────────────────────────────────────── */

const root = document.documentElement;

/** The two theme-color metas — what a browser tints its own chrome with. */
function paintStatusBar(page) {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.removeAttribute('media');
    m.setAttribute('content', page);
  }
}

/* Restoring auto has to put the scoped metas back exactly, and by then a
   palette has overwritten both. So the shipped markup is captured once, at
   module load, before anything here has touched it. */
const SHIPPED_METAS = [...document.querySelectorAll('meta[name="theme-color"]')]
  .map((m) => ({ media: m.getAttribute('media'), content: m.getAttribute('content') }));

function restoreShippedMetas() {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m, i) => {
    const shipped = SHIPPED_METAS[i];
    if (!shipped) return;
    if (shipped.media) m.setAttribute('media', shipped.media);
    m.setAttribute('content', shipped.content);
  });
}

/** Put a pair on the screen, the right way round for the phone. Null is auto. */
function apply(pair) {
  const mode = modeNow();
  root.setAttribute('data-page', mode);

  if (pair) {
    root.style.cssText = cssFor(pair, mode);
    paintStatusBar(pageOf(pair, mode));
  } else {
    // Nothing inline at all: tokens.css already IS black and white in either
    // order, so auto is the app with this file keeping its hands off it.
    root.removeAttribute('style');
    restoreShippedMetas();
  }
}

/** The stored pair, or null when the archive is on the palette it ships with. */
export function current() {
  const saved = readPalette();
  if (!saved || !saved.dark || !saved.light) return null;
  const renamed = PRESETS.find((p) => p.name === RENAMED[saved.name]);
  const pair = renamed
    ? { name: renamed.name, dark: renamed.dark, light: renamed.light }
    : { name: saved.name, dark: saved.dark, light: saved.light };
  return isShipped(pair) ? null : pair;
}

/** Set the archive's two colours. Pure black and white clears the setting. */
export function set(pair) {
  if (isShipped(pair)) {
    writePalette(null);
    apply(null);
    return null;
  }
  // Both modes resolved, for the boot script. See the header.
  writePalette({
    name: pair.name,
    dark: pair.dark,
    light: pair.light,
    css: { dark: cssFor(pair, 'dark'), light: cssFor(pair, 'light') },
  });
  apply(pair);
  return pair;
}

/* ── Boot ───────────────────────────────────────────────────────────────────
   Re-derive from the two stored colours and re-apply, which is what keeps the
   boot script's cached CSS honest: change the derivation above and every phone
   corrects itself on the launch after next.

   The listener is not optional and it is not only for auto any more. EVERY
   palette follows light and dark mode now, so the phone changing its mind at
   sunset has to turn every pair around, not just the black and white one. */

const live = current();
if (live) set(live); else apply(null);

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  apply(current());
});

/* ── The card ───────────────────────────────────────────────────────────────
   The same object every other question in the app is asked in: a list of rows,
   one of which is already true. Which is most of the argument for putting the
   palette in here — there is nothing to learn, it is the ⋯ card with swatches.

   Tapping a row commits and closes, like every other row in every other card.
   There is no affirmative at the bottom because there is nothing to confirm:
   the change is instant, it is the whole screen, and the way to undo it is the
   row above or below the one you just pressed.

   NO COLOUR WHEEL, and not for want of one being easy — <input type="color">
   is two lines and opens the system picker. It also opens a full-screen iOS
   sheet with a spectrum, sliders and an eyedropper over the top of the archive
   you are trying to judge the colour against, which is the one thing this
   control cannot afford: you pick a palette by looking at the app in it. */

export function paletteCard() {
  const now = current();
  const mode = modeNow();
  const c = card('Palette');

  for (const p of PRESETS) {
    const isLive = now ? now.name === p.name : !!p.ships;

    /* The swatch is drawn IN THE ORDER THE PHONE WILL USE IT — ink first, page
       second, the same way round as the screen behind the card. A fixed
       dark-then-light order would have every row in the list disagreeing with
       the app in one of the two modes, which is a swatch lying about the thing
       it is a swatch of. */
    const swatch = el('span.swatch', {},
      el('i', { style: `background:${inkOf(p, mode)}` }),
      el('i', { style: `background:${pageOf(p, mode)}` }));

    const row = el('button.card__row', {
      onclick: () => {
        selectionTick();
        set(p);
        c.close();
        toast(p.name);
      },
    }, el('span.card__name', { text: p.name }), swatch);

    if (isLive) row.classList.add('card__row--live');
    c.rowNode(row);
  }

  c.present();
}
