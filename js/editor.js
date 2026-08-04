/* ═══════════════════════════════════════════════════════════════════════════
   EDITOR — writing.

   Full screen, no header. This is a LIVE editor: the body is the reader's own
   `.prose` block, made editable. A heading is 20px and bold the moment you
   make it, a quote grows its rule as you type into it, a dash becomes a
   bullet under the caret, and bold is bold. There is no preview mode because
   there is nothing left to preview — the page you are writing on is the
   page.

   It is also where a grocery list lives, which is why there are checkboxes in
   an essay editor. A note and an essay are the same object here; the only
   thing that separates them is which folder you publish to, and a notes app
   that couldn't hold a list would just mean keeping the list somewhere else.

   A note has no reading screen of its own any more, either. It used to be
   read in entries.js — plain HTML with a click handler bolted on, which
   navigated here the moment you tapped it. That worked, but the tap that
   should have put a caret on a word instead spent itself on a screen change:
   plain HTML can't take a caret or raise a keyboard, so the editor opened a
   beat later with nothing focused, over a formatting row that was already
   sitting there, fully built, on a screen you hadn't touched yet. Now a
   braindumps/ path lands straight here — the redirect lives in app.js — and
   "reading" a note is just this screen before you've touched it: the marks
   row collapsed to nothing, no caret on screen, the same contenteditable
   surface underneath either way. So the first tap IS a real tap on real
   editable text, and the browser places the caret and raises the keyboard
   itself, exactly where you touched — the thing the old click handler was
   only ever trying to fake by navigating. The marks row grows in along with
   it rather than arriving already built; see the note by markRow below. An
   essay keeps its separate reader — publishing is the line where a piece
   stops being something you idly tap into and becomes one you finished, and
   that line is worth a screen of its own. A note never really crosses it the
   same way; it's still just a page you write on.

   Two things are happening at once and they are not the same thing:

     SAVING is automatic and constant. A keystroke is a local file write, which
     costs nothing here, so there is no Save button and no unsaved state to
     lose. Closing the app mid-sentence is safe.

     PUBLISHING is a decision you make once, with a button, and it is only
     about the date. Until you make it the piece is a draft: it's in the tree,
     it opens, it's yours — it just isn't dated, because the date an essay
     carries should be the day you decided it was finished, not the day you
     opened a blank one. Which folder it lives in was settled before the first
     keystroke, by the row in the tree you started from.

   ── What a live editor costs, and how it's paid ────────────────────────────

   This used to be a textarea holding markdown, and the argument for that was
   that a contenteditable lets the outside world paste a colour or a font into
   the archive. That argument is answered here rather than avoided:

     1. Nothing reaches the document except through `rebuild`. Paste is
        intercepted and re-inserted as plain text; on save the DOM is rebuilt
        node by node from an allowlist, so a <span style="color:red"> is
        unwrapped to its text and a <font> never survives contact. What gets
        stored is the same small vocabulary of tags the migrated essays use.

     2. Every edit goes through execCommand, deprecated and all, because it is
        the only thing that writes into the browser's own undo stack. The
        textarea got undo for free and a writing app cannot quietly lose it.

   The gain is not just fidelity of preview. The old editor round-tripped an
   essay through markdown to open it, which meant a migrated piece lost its
   links, its lists and its images the moment you touched a typo in it. Now the
   essay's real HTML is what you edit.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import { toSrc, fromSrc } from './media.js';
import { el, icon, body, page, toast, card, confirm } from './ui.js';
import { tick, selectionTick } from './platform.js';
import { borrowComposer } from './app.js';

const AUTOSAVE_MS = 700;

/* How far into a checklist item counts as tapping its box rather than its
   words. Matches the list indent in app.css — the box is drawn in that gutter
   and the hit area is the gutter, so it can't drift from what you can see. */
const CHECK_HIT = 32;

const slugify = (s) => (s || '').toLowerCase()
  .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
  .replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

/* Local date, not toISOString(): west of UTC, writing anything after early
   evening would stamp it with tomorrow. Same trap fmtDate() sidesteps at the
   other end. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ── The vocabulary ─────────────────────────────────────────────────────────
   Every tag the archive is allowed to contain, and what each one becomes.
   Anything not named here is unwrapped to its contents on the way in AND on
   the way out — so a paste, a native keyboard's own bold, and a migrated
   essay all end up speaking the same handful of words.

   H1 and H3 collapse to H2 because the reader only styles one heading level;
   B and I collapse to STRONG and EM because those are what .prose knows.

   Two attributes survive the filter, and only on the tags that mean anything
   by them: `data-check` on a UL makes it a checklist, `data-done` on an LI
   ticks the box. Attributes rather than a class because a class is the only
   thing a paste could plausibly arrive carrying, and the whole argument for
   this allowlist is that nothing from outside can dress itself up as
   something the archive already understands. See ATTRS below. */

const BLOCKS = {
  P: 'p', DIV: 'p',
  H1: 'h2', H2: 'h2', H3: 'h2', H4: 'h2', H5: 'h2', H6: 'h2',
  BLOCKQUOTE: 'blockquote',
  UL: 'ul', OL: 'ol', LI: 'li',
  FIGURE: 'figure', FIGCAPTION: 'figcaption',
};

const INLINES = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', A: 'a' };

/* What counts as a top-level block when loose text has to be gathered up. LI
   and FIGCAPTION are missing on purpose — they're only ever legal inside their
   own parent, so at the top level they're treated as stray inline content. */
const TOP = new Set(['P', 'H2', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'HR']);

/** Everything that is a block wherever it appears, not only at the top. */
const BLOCKISH = new Set([...TOP, 'LI', 'FIGCAPTION']);

/* The one attribute each of two tags is allowed to keep. Everything else is
   dropped, including style, class and id. */
const ATTRS = { UL: 'data-check', LI: 'data-done' };

/* A styled span is the shape a native keyboard's own bold arrives in when the
   engine ignores styleWithCSS. Read the intent, drop the style. */
function implied(node) {
  const s = node.getAttribute('style');
  if (!s) return null;
  if (/font-weight:\s*(bold|[6-9]00)/i.test(s)) return 'strong';
  if (/font-style:\s*italic/i.test(s)) return 'em';
  return null;
}

/** Copy `src`'s children into `dst`, keeping only what the archive allows. */
function rebuild(src, dst) {
  for (const n of src.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.nodeValue) dst.append(document.createTextNode(n.nodeValue));
      continue;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) continue;

    const name = n.nodeName;

    if (name === 'BR' || name === 'HR') {
      dst.append(document.createElement(name.toLowerCase()));
      continue;
    }

    if (name === 'IMG') {
      const src0 = n.getAttribute('src');
      if (!src0) continue;
      const img = document.createElement('img');
      img.setAttribute('src', fromSrc(src0));
      const alt = n.getAttribute('alt');
      if (alt) img.setAttribute('alt', alt);
      dst.append(img);
      continue;
    }

    const tag = BLOCKS[name] || INLINES[name] || implied(n);

    // Unknown, or a span carrying nothing but decoration: keep the words,
    // discard the wrapper. This is the line that makes a paste safe.
    if (!tag) { rebuild(n, dst); continue; }

    if (tag === 'a') {
      const href = n.getAttribute('href') || '';
      // Anything that isn't plainly a web address is treated as decoration —
      // javascript: and data: never make it into the archive.
      if (!/^(https?:|mailto:)/i.test(href)) { rebuild(n, dst); continue; }
      const a = document.createElement('a');
      a.setAttribute('href', href);
      rebuild(n, a);
      dst.append(a);
      continue;
    }

    const out = document.createElement(tag);
    const keep = ATTRS[out.nodeName];
    if (keep && n.hasAttribute(keep)) out.setAttribute(keep, '');
    rebuild(n, out);
    dst.append(out);
  }
}

/* One of the migrated essays contains `<b><ol>…</ol></b>` — an inline mark
   wrapped around a whole block. A browser renders it without complaint, but it
   cannot be written back out: serialise that inside a <p> and the HTML parser
   tears it apart on the next load, so the essay changes shape a little every
   time it's opened. The mark is dropped rather than pushed down into each item
   — a bolded list was never the emphasis <strong> means in this app.

   Deepest-first, so `<strong><em><ol>` is resolved in one pass: unwrapping the
   <em> leaves the <ol> as a direct child of the <strong>, which is then seen
   by the same loop. */
function unwrapAroundBlocks(box) {
  for (const n of [...box.querySelectorAll('strong, em, a')].reverse()) {
    if ([...n.children].some((c) => BLOCKISH.has(c.nodeName))) {
      n.replaceWith(...n.childNodes);
    }
  }
}

/* A block that is only ever allowed to hold words.

   This is the same failure as unwrapAroundBlocks above, one level up, and it is
   the more dangerous one. A DOM assembled by hand — which is what a run of
   execCommands in a webview leaves behind — will happily hold `<p><h2>…</h2></p>`
   or `<p>text<ul><li>…</li></ul></p>`. Nothing complains, it renders, and it
   serialises to a string. Then the HTML PARSER reads that string back on the
   next load, applies the content model the DOM never enforced, and closes the
   <p> before the block it illegally contained — so one paragraph becomes three,
   an <h2> jumps out of its wrapper, and a list is emptied into loose lines. The
   document changes shape every single time it is opened.

   That is the exact corruption an allowlist exists to prevent, and the allowlist
   was checking the wrong thing: rebuild() asks whether each TAG is permitted and
   never asks whether the tags are legally nested. So the offender is unwrapped
   and its children stand at the level they actually belong to.

   Deepest-first, for the same reason as above: unwrapping an inner block leaves
   its children in the outer one, which is then seen by the same loop. */
function unwrapNestedBlocks(box) {
  for (const n of [...box.querySelectorAll('p, h2, figcaption')].reverse()) {
    if ([...n.children].some((c) => BLOCKISH.has(c.nodeName))) {
      n.replaceWith(...n.childNodes);
    }
  }
}

/* Loose text at the top level becomes a paragraph, and blocks carrying nothing
   are dropped — see the note on the second loop for why. */
function normalise(box) {
  unwrapAroundBlocks(box);
  unwrapNestedBlocks(box);

  const out = document.createElement('div');
  let para = null;

  for (const n of [...box.childNodes]) {
    if (n.nodeType === Node.ELEMENT_NODE && TOP.has(n.nodeName)) {
      para = null;
      out.append(n);
    } else {
      if (!para) { para = document.createElement('p'); out.append(para); }
      para.append(n);
    }
  }

  /* Blocks carrying nothing are dropped, because .prose spaces its children
     with `> * + *` and an empty <p> is invisible but still pushes the next one
     down by 36px — which is how a document slowly grows holes in it.

     Three exceptions, all of them things whose emptiness is the content: a
     rule, a figure holding a photo and no words, and a checklist you've
     started but not filled in yet. A grocery list with nothing on it is a
     grocery list, and losing it on the first autosave would be the app
     deleting the thing you just made. */
  for (const n of [...out.children]) {
    if (n.nodeName === 'HR' || n.querySelector('img')) continue;
    if (n.nodeName === 'UL' && n.hasAttribute('data-check')) continue;
    if (!n.textContent.trim()) n.remove();
  }

  return out;
}

/** The editable DOM -> the HTML shape the reader and the index both use. */
function serialise(host) {
  const box = document.createElement('div');
  rebuild(host, box);
  return normalise(box).innerHTML;
}

/** Stored HTML -> the editable DOM, through exactly the same filter. */
function hydrate(host, html) {
  const raw = document.createElement('div');
  raw.innerHTML = html || '';

  const clean = document.createElement('div');
  rebuild(raw, clean);
  const doc = normalise(clean);

  for (const img of doc.querySelectorAll('img')) {
    img.setAttribute('src', toSrc(img.getAttribute('src')));
    img.setAttribute('decoding', 'async');
  }

  host.replaceChildren(...doc.childNodes);
  if (!host.firstChild) host.append(blank());
  host.classList.toggle('is-empty', isEmpty(host));
}

/* An empty document is still a paragraph — an editable div with no element in
   it puts the caret nowhere in particular and the first keystroke lands in a
   bare text node the browser then has to guess how to wrap. */
function blank() {
  const p = document.createElement('p');
  p.append(document.createElement('br'));
  return p;
}

const isEmpty = (host) =>
  !host.textContent.trim() && !host.querySelector('img, hr, ul[data-check]');

/* ── The marks ──────────────────────────────────────────────────────────────
   Six marks, and the two hard parts of a formatting button are both here.

   KNOWING WHETHER A MARK IS ON. Two sources, because neither is sufficient:

     The DOM. Walk up from the caret and look for a <strong> or an <h2>. This
     is the only thing that works for a selection spanning several nodes, and
     it's the only thing that knows about the blocks.

     queryCommandState. A collapsed caret carries a "typing style" that exists
     inside the engine and nowhere in the markup: put the caret at the end of a
     bold word, press Bold, and the document does not change even though the
     next character you type will not be bold. Only the engine knows that.

   Reading just one of them is what makes a formatting button lie about its own
   state, and then toggle the wrong way when you tap it. A mark is on if either
   says so.

   NOT LOSING THE SELECTION. Tapping a button is a tap outside the text, and
   the caret is the only thing the mark can be applied to. preventDefault on
   mousedown normally holds it, but it doesn't survive every route through a
   webview, so the last good range inside the body is remembered on every
   selection change and put back if it's gone by the time the tap lands.

   Everything is applied with execCommand. It is deprecated, WebKit still
   implements it, and it is the only route into the browser's native undo
   stack — which the textarea this replaced got for free and which a writing
   app is not allowed to quietly drop. */

/* Each mark shows what it makes rather than what it's called. Four of the six
   are a letter set in their own style — the B is the bold face, the H is the
   step up in size AND weight an <h2> now is, the “ is that mark at the size
   it lands — and the two that change the SHAPE of a paragraph rather than the
   look of a word are drawn instead.
   See the sprite in index.html.

   `label` survives as the aria-label: a glyph is a picture to anything that
   isn't looking at it.

   HEADING LEADS. The row is in the order you'd actually reach for it: a
   heading is the thing you reach for first, because it's what you type before
   the paragraph rather than to a word already in one. Everything after it
   works on writing that already exists — the two inline marks, then the two
   marks that turn a run of lines into a list, then the quote. */
const MARKS = [
  { label: 'Heading', glyph: 'H', at: 'h2',
    run: (host, on) => document.execCommand('formatBlock', false, on ? '<p>' : '<h2>') },
  { label: 'Bold',   glyph: 'B', cmd: 'bold',   at: 'strong, b' },
  { label: 'Italic', glyph: 'I', cmd: 'italic', at: 'em, i' },
  { label: 'List',  ic: 'list',  at: 'ul:not([data-check])', run: (host, on) => list(host, on, false) },
  { label: 'Checklist', ic: 'check', at: 'ul[data-check]',   run: (host, on) => list(host, on, true) },
  { label: 'Quote', glyph: '“', at: 'blockquote', run: quote },
];

/* One button for bullets and one for boxes, and they are the same list in two
   states — which is why neither of them just calls insertUnorderedList and
   stops. Four transitions, and only the first is what the browser gives you:

     nothing  -> list       make one
     list     -> nothing    unmake it (the browser's own toggle)
     bullets  -> boxes      the list stays; it grows an attribute
     boxes    -> bullets    the list stays; it loses one

   Converting between the two kinds without destroying and rebuilding the list
   is the whole point. `insertUnorderedList` twice would take a checked grocery
   list apart into paragraphs and put a fresh empty one back, and every tick in
   it would be gone. */
function list(host, on, check) {
  if (on) { document.execCommand('insertUnorderedList'); return; }

  let ul = ancestor(host, 'ul');
  if (!ul) {
    document.execCommand('insertUnorderedList');

    /* The item the caret is in, taken BEFORE the list is moved, because
       lift() is what loses it.

       WebKit does not keep the selection across `wrap.replaceWith(ul)`: the
       range's endpoints are inside the <ul>, the <ul> itself survives intact,
       and the caret is still simply gone — it lands back in `host` at the
       offset the old wrapper occupied, which is OUTSIDE the list. The first
       word you then typed became a bare text node sitting in front of the
       bullet, the next Enter wrapped that text and the list together in a
       fresh <p>, and every mark applied after it nested one more block inside
       another. That is the whole shape of the corruption this used to write,
       and it started here.

       So the <li> is held onto and the caret put back into it by hand. There
       is nothing else left to restore it from once the move has happened. */
    const li = ancestor(host, 'li') || ancestor(host, 'ul')?.firstElementChild;

    ul = detach(host, lift(host, ancestor(host, 'ul')), check);
    if (li && li.isConnected) caretAtEnd(li);
  }
  ul?.toggleAttribute('data-check', check);
}

/* Blink builds the list INSIDE the paragraph it was made from, and hands back
   `<p><ul><li>…</li></ul></p>`. A <ul> is not allowed in a <p>, so the moment
   that shape is serialised and read back the parser tears it apart and the
   list arrives on the next load as loose paragraphs — which is exactly the
   kind of quiet corruption an allowlist exists to prevent.

   So the list is lifted out of any wrapper that contains nothing but it. The
   node is MOVED rather than rebuilt, which is what keeps the caret: a range
   whose endpoints are inside the subtree survives the parent changing. */
function lift(host, ul) {
  while (ul && ul.parentElement && ul.parentElement !== host) {
    const wrap = ul.parentElement;
    if (wrap.childNodes.length !== 1) break;
    wrap.replaceWith(ul);
  }
  return ul;
}

/* Two adjacent lists are one list, as far as the engine is concerned: start a
   checklist on the line under a bullet list and insertUnorderedList quietly
   appends the new item to the list above instead of making one. Harmless until
   the next line stamps data-check on what it thinks is its own new list — and
   the bullets you wrote a minute ago all grow boxes.

   So a list that arrives already holding items of the other kind is split at
   the caret, and the tail becomes a list of its own.

   The new list is put into the document BEFORE anything is moved into it. Fill
   it first and the item holding the caret spends a moment outside the document
   entirely, the selection collapses, and the next word you type lands at the
   end of the previous line — which is a far stranger bug than the one this is
   fixing. */
function detach(host, ul, check) {
  if (!ul || ul.hasAttribute('data-check') === check) return ul;

  const li = ancestor(host, 'li');
  if (!li || ul.children.length < 2) return ul;

  const fresh = document.createElement('ul');
  ul.after(fresh);
  for (let n = li, next; n; n = next) {
    next = n.nextElementSibling;
    fresh.append(n);
  }

  /* Moving a node is a remove followed by an insert, and the selection does
     not survive the gap: the item holding the caret leaves the document for an
     instant and the caret is simply gone by the time it comes back. Which
     shows up as the next word you type appearing at the end of the previous
     line. Put it back. */
  caretAtEnd(li);
  return fresh;
}

/* The caret sitting in a bare text node directly inside the editable is the
   state every serious editing bug in this file has started from: it is what a
   lifted list used to leave behind, and it is what WebKit's own `outdent`
   leaves when it takes a <blockquote> away without putting a paragraph back.
   Nothing is visibly wrong — the words are on screen — but the next Enter
   wraps the loose text AND whatever block follows it in one fresh <p>, and
   from there the document is nesting blocks inside blocks.

   So the run of loose inline nodes around the caret is gathered into a <p>.
   The nodes are MOVED rather than rebuilt, so the text node the selection is
   anchored in is the same object afterwards and the exact offset survives. */
function blockifyCaret(host) {
  const sel = document.getSelection();
  if (!caretIn(host)) return;

  const { anchorNode, anchorOffset } = sel;

  // The top-level node the caret is inside.
  let top = anchorNode === host
    ? (host.childNodes[anchorOffset] ?? host.lastChild)
    : anchorNode;
  while (top && top.parentNode && top.parentNode !== host) top = top.parentNode;
  if (!top || top.parentNode !== host) return;

  const loose = (n) => n && !(n.nodeType === Node.ELEMENT_NODE && TOP.has(n.nodeName));
  if (!loose(top)) return;

  let first = top;
  let last = top;
  while (loose(first.previousSibling)) first = first.previousSibling;
  while (loose(last.nextSibling)) last = last.nextSibling;

  const p = document.createElement('p');
  host.insertBefore(p, first);
  for (let n = first, next; n; n = next) {
    next = n === last ? null : n.nextSibling;
    p.append(n);
  }

  if (anchorNode.isConnected) {
    const r = document.createRange();
    r.setStart(anchorNode, anchorOffset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    caretAtEnd(p);
  }
}

/** Collapse the caret to the end of `node`'s contents. */
function caretAtEnd(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function queryState(cmd) {
  // Throws rather than returning false in some engines when the command is
  // unavailable, which would take the whole tap handler down with it.
  try { return document.queryCommandState(cmd); } catch (e) { return false; }
}

/** Is this mark in force at the caret — in the markup, or only in the engine? */
function isOn(host, m) {
  if (m.cmd && queryState(m.cmd)) return true;
  return !!ancestor(host, m.at);
}

function quote(host, on) {
  if (!on) {
    document.execCommand('formatBlock', false, '<blockquote>');
    // WebKit's formatBlock accepts blockquote; some engines quietly decline it
    // and only produce one through indent. Ask the DOM which happened.
    if (!ancestor(host, 'blockquote')) document.execCommand('indent');
    return;
  }

  /* GETTING BACK OUT OF A QUOTE, and `outdent` is not how.

     outdent is the documented way and in WebKit — the engine this app actually
     ships on — it DESTROYS THE TEXT. On `<blockquote>a quote</blockquote>`,
     which is exactly the shape the line above produces, it leaves `<p><br></p>`
     and the words are simply gone, off the undo stack and out of the document.
     Press Quote twice and the sentence you quoted no longer exists.

     It was invisible for as long as the editor was corrupting its own markup:
     the blockquote used to end up wrapped in a paragraph, and on THAT shape
     outdent behaves. Fixing the nesting is what exposed this.

     formatBlock is the one that's safe here, and it is tried first because it
     is the one that writes to the browser's undo stack. It handles the shape
     this editor makes, and quietly declines the shape a paste or a migrated
     essay can bring — `<blockquote><p>…</p></blockquote>` — so the DOM is asked
     which happened, and the hand-unwrap below finishes the job when it did
     nothing. Between them both shapes come out as a paragraph, and neither of
     them can lose a word. */
  document.execCommand('formatBlock', false, '<p>');

  const bq = ancestor(host, 'blockquote');
  // formatBlock took it. It may have left the text loose in the editable rather
  // than in a paragraph, which is the state everything else here goes wrong
  // from — give it a block.
  if (!bq) { blockifyCaret(host); return; }

  const kids = [...bq.childNodes];
  const loose = kids.some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim());
  let landing;

  if (loose) {
    landing = document.createElement('p');
    landing.append(...kids);
    bq.replaceWith(landing);
  } else {
    landing = kids[kids.length - 1] || null;
    bq.replaceWith(...kids);
  }

  if (!landing) return;
  const r = document.createRange();
  r.selectNodeContents(landing);
  r.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Does the caret currently sit inside `host`? */
function caretIn(host) {
  const sel = document.getSelection();
  return !!(sel && sel.rangeCount && sel.anchorNode && host.contains(sel.anchorNode));
}

/** The nearest matching element the caret sits inside, within the editor. */
function ancestor(host, selector) {
  if (!caretIn(host)) return null;
  const anchor = document.getSelection().anchorNode;
  const from = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
  const hit = from?.closest(selector);
  return hit && host.contains(hit) ? hit : null;
}

/* ── Autoformat ─────────────────────────────────────────────────────────────
   The six buttons are for reaching back into text you've already written.
   Nobody uses them on the way forward: writing a list means typing a dash,
   because that is what a list looks like when you write one by hand, and
   stopping to aim at a button between every item is not writing.

   So the shorthand is the primary interface and the buttons are the fallback.
   Each rule fires the moment its trigger is complete — the marker is deleted
   through execCommand so it lands on the undo stack, and one press of undo
   puts the literal characters back if the format wasn't what you meant.

   Only ever inside a plain paragraph. A line beginning "- " inside a
   blockquote is a dash, and inside a list it's the second bullet of a nested
   thing nobody asked for.

   And never during the keystroke itself — see queueAutoformat in render(). */

const SHORTHAND = [
  { re: /^[-*]\s$/,     run: (host) => list(host, false, false) },
  { re: /^\[\s?\]\s$/,  run: (host) => list(host, false, true) },
  { re: /^#\s$/,        run: () => document.execCommand('formatBlock', false, '<h2>') },
  { re: /^>\s$/,        run: (host) => quote(host, false) },
];

function autoformat(host) {
  const sel = document.getSelection();
  if (!sel || !sel.isCollapsed) return false;

  const block = ancestor(host, 'p');
  // A <p> nested in something is that something's business, not a fresh line.
  if (!block || block.parentElement !== host) return false;

  /* The whole paragraph, not the run in front of the caret. A range probe was
     the obvious way to ask "what has been typed so far" and it is not
     reliable: after an insertText the engine may report the collapsed caret as
     the paragraph itself at offset 0 rather than as a position in its text
     node, and the probe then measures nothing at all.

     Reading the block is both simpler and stricter. Every rule is anchored at
     both ends, so shorthand fires only when the line holds the marker and
     nothing else — which is also the only time it should. Typing "- " in the
     middle of a sentence is a dash. */
  const rule = SHORTHAND.find((r) => r.re.test(block.textContent));
  if (!rule) return false;

  // Clear the marker first, so the block is empty by the time the format is
  // applied and the shorthand doesn't end up inside its own bullet. Through
  // execCommand, so one undo puts the literal characters back.
  const kill = document.createRange();
  kill.selectNodeContents(block);
  sel.removeAllRanges();
  sel.addRange(kill);
  document.execCommand('delete');

  rule.run(host);
  return true;
}

/* Enter at the end of a ticked item makes the next one, and WebKit hands the
   new <li> its predecessor's attributes — so the item you haven't written yet
   arrives already crossed off. An empty item is never done. */
function tidyChecks(host) {
  for (const li of host.querySelectorAll('ul[data-check] > li[data-done]')) {
    if (!li.textContent.trim()) li.removeAttribute('data-done');
  }
}

/** The six marks: a rule under the title, and the marks standing on it. This
    is the head's meta slot — where the reader prints a date — but not the meta
    STYLE, which is 11px caps and would track a single letter off its own
    centre. .marks owns everything about this row — including, now, whether
    it's on screen at all: see the focus/blur pair below and .marks--in in
    app.css. Collapsed by default and grown open the moment `host` takes
    focus, closed again the moment it loses it, so the row tracks writing the
    same way a caret does — there the moment you're using it, gone the moment
    you're not, never jump-cutting into place because it never simply
    appears; it grows, on the same clock the rest of the app's motion runs on.
    This is what makes a dormant note and an active one the same screen: nothing
    else about the layout below the title differs between them. */
function markRow(host, onChange) {
  const row = el('div.marks');
  const buttons = [];

  // The last place the caret was seen inside the body, so a tap that costs us
  // the selection can hand it back before applying anything.
  let held = null;

  function hold() {
    if (caretIn(host)) held = document.getSelection().getRangeAt(0).cloneRange();
  }

  function restore() {
    if (caretIn(host)) return;
    host.focus();
    if (!held || !host.contains(held.startContainer)) return;
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(held);
  }

  for (const m of MARKS) {
    const b = el('button.marks__btn', {
      type: 'button',
      // The button is a picture of its result, so the name it goes by is only
      // ever spoken.
      'aria-label': m.label,
      'aria-pressed': 'false',
      // The body must not lose the caret when the button takes the tap, or
      // there is nothing left to apply the mark to.
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        selectionTick();
        restore();
        // Re-asserted per command: it decides whether bold arrives as <b> or
        // as a styled span, and anything could have flipped it in between.
        document.execCommand('styleWithCSS', false, false);

        const on = isOn(host, m);
        // bold and italic already toggle off whatever is on, so they're issued
        // rather than decided; only the block marks need to know which way.
        if (m.cmd) document.execCommand(m.cmd);
        else m.run(host, on);

        hold();
        sync();
        onChange();
      },
    }, m.ic
      ? icon(m.ic)
      : el(`span.marks__glyph.marks__glyph--${m.label.toLowerCase()}`,
           { text: m.glyph }));

    buttons.push([m, b]);
    row.append(b);
  }

  /** Light whichever marks are in force at the caret. */
  function sync() {
    const live = caretIn(host);
    if (live) hold();
    for (const [m, b] of buttons) {
      b.setAttribute('aria-pressed', String(live && isOn(host, m)));
    }
  }

  // Grown open on focus, collapsed on blur — see the doc comment above.
  // `host` is bodyEl, never the title: the marks act on the body's selection
  // and nowhere else (every `run` and `isOn` above takes `host`, not the
  // title), so naming a title character isn't "writing" as far as this row
  // is concerned and shouldn't summon tools that don't apply to it.
  host.addEventListener('focus', () => row.classList.add('marks--in'));
  host.addEventListener('blur', () => row.classList.remove('marks--in'));

  return { row, sync };
}

/* ── The screen ─────────────────────────────────────────────────────────────
 * @param path  an existing essay to edit, or null to start a new one
 * @param into  for a new one, the folder prefix it belongs to — the tree row
 *              you started from already knows, so nothing has to ask later
 */
export function render(path, nav, into = null) {
  const existing = path ? store.get(path) : null;
  const home = into || 'marginalia/';

  let currentPath = existing ? existing.path : null;
  let isDraft = existing ? !!existing.draft : true;
  let saveTimer = null;
  let dirty = false;

  // A note has no reader of its own to hang a ⋯ on any more — see the header
  // comment above. Changes what's offered in view.__chrome, below.
  const isNote = (existing ? existing.path : home).startsWith('braindumps/');

  // A published note opens dormant, per the header comment — and dormant means
  // there is nothing to decide, so Done has no reason to be on screen either.
  // It earns its place the moment the words are actually touched; see
  // activate() below. A draft is exempted: Publish is the one thing worth
  // reaching for on a draft you're merely reopening, without touching a
  // keystroke first. And a brand-new note is never dormant to begin with — it
  // gets the keyboard immediately, a few lines down.
  let dormant = isNote && existing && !existing.draft;

  const view = el('div.view.view--bare');

  /* The title is a contenteditable and not an <input>, which is the difference
     between looking like the reader and being it: the reader sets a long title
     over three centred lines, and an input would have scrolled it sideways in
     one. Nothing but text can get in — the value is read with textContent, so
     anything pasted is only ever its own words. */
  const title = el('h1.head__title.editor__title', {
    contenteditable: 'true',
    role: 'textbox',
    'aria-label': 'Title',
    'data-placeholder': 'Title',
    enterkeyhint: 'next', autocapitalize: 'words', spellcheck: 'true',
    text: existing ? (existing.title || '') : '',
  });

  // .prose is not a lookalike here, it is the reader's own rule. The editor
  // cannot drift from the page it's previewing because there is one stylesheet
  // for both, and a change to reading copy changes writing copy in the same
  // line of CSS.
  const bodyEl = el('div.prose.editor__body', {
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': 'Body',
    'data-placeholder': 'Begin.',
    spellcheck: 'true',
    autocapitalize: 'sentences',
  });

  const marks = markRow(bodyEl, () => schedule());

  /* The editor's whole layout, and it is the reader's: head over page, with the
     marks standing where the date goes. Nothing is stacked above or below
     that — the formatting has no strip of its own to push the writing down, and
     the word count that used to sit under the body is gone. It was the only
     number the app ever put on a piece of writing, it changed on every
     keystroke, and a live editor's argument is that the page shows you the
     piece rather than statistics about it.

     .body so the scroller inherits the same clearance under the notch and the
     same clearance under the composer that every other screen gets. */
  const wrap = body(
    el('header.head', {}, title, marks.row),
    page(bodyEl));

  view.append(wrap);

  view.__chrome = {
    back: true,
    // Withheld on a dormant note — see activate() below, which is what puts
    // it on screen once there's actually something to finish.
    ...(dormant ? {} : { main: { label: mainLabel(), onclick: onMain } }),
    // Essays don't get this — Delete is still behind the ⋯ on the page they
    // publish to. A note never leaves this screen, so this is its only ⋯,
    // and Edit has no place on it: tapping into the words already is that.
    ...(isNote ? { more: noteActionsCard } : {}),
  };

  // The first real touch wakes a dormant note up. One-way: once Done has a
  // reason to exist it stays on screen for the rest of this visit, rather
  // than chasing focus in and out with every blur — which would race the tap
  // on Done itself, since a mousedown there blurs the body a beat before the
  // click that reads `actions.main` arrives. Leaving is what tears this
  // screen down anyway, so there's nothing to put back.
  function activate() {
    if (!dormant) return;
    dormant = false;
    view.__chrome.main = { label: mainLabel(), onclick: onMain };
    borrowComposer(view.__chrome, false);
  }
  if (dormant) {
    title.addEventListener('focus', activate);
    bodyEl.addEventListener('focus', activate);
  }

  function mainLabel() {
    return isDraft ? 'Publish' : 'Done';
  }

  // New paragraphs are <p>, not <div>. Set per screen rather than at boot
  // because it's a document-wide flag and this is the only screen that has an
  // opinion about it.
  document.execCommand('defaultParagraphSeparator', false, 'p');
  document.execCommand('styleWithCSS', false, false);

  // Seed the body. The seeded file is fetched async; everything else is sync.
  // hydrate() sets the placeholder state itself, so a blank editor is blank on
  // the first paint rather than a frame later.
  hydrate(bodyEl, existing ? (existing.bodyInline || '') : '');

  if (existing && !existing.bodyInline && existing.body) {
    fetch(`seed/${existing.body}`)
      .then((r) => r.text())
      .then((html) => hydrate(bodyEl, html))
      .catch(() => {});
  }

  // Both placeholders, before the first paint. hydrate() has already answered
  // for the body; the title has never been asked.
  refreshEmpty();

  if (!existing) {
    // A new essay wants the keyboard immediately — that's the whole gesture.
    setTimeout(() => title.focus(), 350);
  }

  /* Both editables carry a placeholder, and both need it as a class rather
     than a selector, because a contenteditable is never :empty — see the note
     in app.css. */
  function refreshEmpty() {
    title.classList.toggle('is-empty', !title.textContent.trim());
    bodyEl.classList.toggle('is-empty', isEmpty(bodyEl));
  }

  function schedule() {
    dirty = true;
    refreshEmpty();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, AUTOSAVE_MS);
  }

  /* The autosave. A piece that has never been saved is created as a draft in
     the folder you started from — it has to live at some path to be saved at
     all, and that path is now the real answer rather than a placeholder, so
     publishing only has to date it. */
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;

    const t = title.textContent.trim();
    const b = isEmpty(bodyEl) ? '' : serialise(bodyEl);

    // Nothing typed yet — don't litter the archive with an empty entry.
    if (!t && !b) return;
    dirty = false;

    const patch = { title: t || 'Untitled', bodyInline: b };

    if (currentPath && store.get(currentPath)) {
      // Editing a migrated essay: the inline body now wins, so drop the
      // pointer to the seed file or the reader would show the stale one.
      await store.update(currentPath, { ...patch, body: undefined });
    } else {
      const node = await store.add({
        path: `${home}${slugify(t) || `untitled-${Date.now().toString(36)}`}`,
        kind: 'essay',
        date: today(),
        draft: true,
        ...patch,
      });
      currentPath = node.path;
      isDraft = true;
    }
  }

  /* ── Publish ──────────────────────────────────────────────────────────────
     Publishing asks nothing. It used to open a card — Essays or Notes? —
     because a piece started from a bare Write button had no
     folder until someone named one, and the end was the last chance to ask.
     Writing now starts from a folder in the tree, so the draft has been living
     in the right place all along and this is just the date going on.

     The slug is still rebuilt here rather than at first save, because the
     working title of a draft is rarely the one it ships with. */

  async function onMain() {
    await flush();

    // Already published — there is nothing to decide, so Done just closes the
    // editor. A NOTE stays right where it is: it was opened straight at
    // #/e/<path> and that IS its permanent screen, so Done re-renders it in
    // place (which is also what drops the keyboard and collapses the marks
    // row). An ESSAY only ever reaches this branch through #/write, which
    // entries.js only ever pushes from that exact essay's own reader — so the
    // entry one back is already #/e/<path>, about to show these same edits
    // once flush() lands. Replacing here instead of popping to it would leave
    // two history entries at that identical hash, and because the hash isn't
    // changing, the NEXT back press would silently do nothing before the one
    // after it actually left — which reads as the back button going back into
    // the editor. Popping avoids stacking that duplicate in the first place.
    if (!isDraft) {
      if (isNote) {
        if (currentPath) nav(`#/e/${encodeURIComponent(currentPath)}`, true);
        else history.back();
      } else {
        nav.back();
      }
      return;
    }

    if (!currentPath) {
      toast('Nothing to publish yet');
      return;
    }

    await publish();
  }

  async function publish() {
    const node = store.get(currentPath);
    if (!node) return;

    const prefix = currentPath.slice(0, currentPath.lastIndexOf('/') + 1);
    const slug = slugify(node.title) || currentPath.split('/').pop();
    const before = currentPath;

    // move() is the one that knows the final path: it declines a no-op rename
    // and suffixes a slug that's already taken, so the answer comes back from
    // it rather than being assumed here.
    const moved = await store.move(currentPath, `${prefix}${slug}`);
    currentPath = moved.path;

    await store.update(currentPath, { draft: false, date: today() });
    isDraft = false;

    tick('Medium');
    toast('Published');

    // A fresh draft started from #/new/ has no reader behind it — the entry
    // one back is the folder it was started from, a different hash, so it's
    // safe and necessary to replace this screen with the published piece.
    // But a DRAFT reopened for another pass through #/write already has its
    // own reader sitting one entry back, and if the title didn't change
    // enough to rename it, that reader is at this exact hash. Replacing in
    // that case would stack a second identical entry, and the same silent
    // double-back-press bug as onMain's Done branch above follows — so pop
    // to the existing reader instead of duplicating it.
    if (path && currentPath === before) nav.back();
    else nav(`#/e/${encodeURIComponent(currentPath)}`, true);
  }

  /* The only thing on a note's ⋯. See view.__chrome above for why it exists
     at all and why Edit isn't on it too. */
  function noteActionsCard() {
    const c = card();
    c.row('Delete', null, async () => {
      selectionTick();
      c.close();
      // Nothing has ever been saved — the confirmation would be asking
      // whether to delete a piece that doesn't exist yet. Just leave.
      if (!currentPath) { nav('#/', true); return; }
      const t = title.textContent.trim() || 'Untitled';
      if (!await confirm(`Delete “${t}”?`, 'Delete')) return;
      await store.remove(currentPath);
      tick('Medium');
      toast('Deleted');
      nav('#/', true);
    });
    c.present();
  }

  // The marks resync on input as well as on selection change: typing into the
  // front of a bold run moves you out of it without the caret going anywhere.
  title.addEventListener('input', schedule);
  bodyEl.addEventListener('input', () => {
    ensureBlock();
    // Cheap when the caret is already in a block, which is almost always. It
    // earns its place on the hot path by being the one guard that catches every
    // remaining way a webview can drop the caret into loose text.
    blockifyCaret(bodyEl);
    tidyChecks(bodyEl);
    schedule();
    marks.sync();
    queueAutoformat();
  });

  /* The shorthand runs on the next turn of the event loop, not in the handler
     that noticed it.

     Blink refuses every editing command while an input event is still being
     dispatched: execCommand returns false and the document is not touched. The
     failure is silent and it is not partial — the dash was selected ready to
     be replaced and then simply left selected, so the next character typed
     overwrote it and the list never appeared. Which looks exactly like the
     shorthand working and then losing the format.

     One timer at a time. Typing "- " fires input twice and only the second
     matches, but a burst of keystrokes must not queue a burst of passes. */
  let queued = null;

  function queueAutoformat() {
    if (queued) return;
    queued = setTimeout(() => {
      queued = null;
      if (!bodyEl.isConnected) return;
      if (autoformat(bodyEl)) { schedule(); marks.sync(); }
    }, 0);
  }

  /* Ticking a box. The gutter is the target and the words are not — a
     checklist item is still text you have to be able to put the caret into,
     and a tap anywhere on the line toggling it would make the list
     uneditable. Everything left of the first character is the box. */
  function checkboxAt(e) {
    const li = e.target.closest?.('ul[data-check] > li');
    if (!li || e.clientX - li.getBoundingClientRect().left > CHECK_HIT) return null;
    return li;
  }

  /* Ticking a box must not wake a dormant note up. Left unguarded, the tap
     would also do what any tap on editable text does: focus the body, drop a
     caret in the item, grow the marks row open — exactly wrong for a list
     you're using standing in a shop, where the ask is "tick milk," not "start
     writing." Blocked on mousedown, before the browser hands out focus, the
     same move the marks buttons above make to hold onto the caret through a
     tap outside the text. If the body was already focused from actual
     writing, this changes nothing — focus was already somewhere and stays
     there; only the ability to MOVE it here is what's withheld. */
  bodyEl.addEventListener('mousedown', (e) => {
    if (checkboxAt(e)) e.preventDefault();
  });

  bodyEl.addEventListener('click', (e) => {
    const li = checkboxAt(e);
    if (!li) return;
    e.preventDefault();
    selectionTick();
    li.toggleAttribute('data-done');
    schedule();
  });

  /* A title is one line, so Enter is the way out of it rather than a newline
     in it — and the caret lands at the top of the body, which is where you
     were going. Coming back the other way, backspace at the very start of the
     body returns to the end of the title, so the two editables behave like one
     document even though they are two elements and two saved fields. */
  title.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusBody();
  });

  bodyEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' || !atVeryStart()) return;
    e.preventDefault();
    caretToEnd(title);
  });

  function focusBody() {
    bodyEl.focus();
    const first = bodyEl.firstElementChild;
    if (!first) return;
    const r = document.createRange();
    r.setStart(first, 0);
    r.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function caretToEnd(host) {
    host.focus();
    caretAtEnd(host);
  }

  /** Is the caret collapsed at the very first position of the body? */
  function atVeryStart() {
    const sel = document.getSelection();
    if (!sel || !sel.isCollapsed || !caretIn(bodyEl)) return false;
    const probe = document.createRange();
    probe.selectNodeContents(bodyEl);
    probe.setEnd(sel.anchorNode, sel.anchorOffset);
    return probe.toString().length === 0;
  }

  /* Delete back through the last character and WebKit takes the paragraph with
     it, leaving the caret in a bare editable div where the next keystroke has
     no block to belong to. Put one back. */
  function ensureBlock() {
    if (bodyEl.firstElementChild) return;
    const p = blank();
    bodyEl.replaceChildren(p);
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* The two doors the outside world could come through, on both editables.
     Both are shut: a paste is re-entered as plain text so it inherits the block
     it lands in, and a drop — which arrives as full HTML from another app — is
     refused outright rather than sanitised, because nothing in this app has a
     reason to drag markup into an essay.

     The title takes the first line of a multi-line paste and nothing else. It
     is one line of a document, and a pasted paragraph in it would otherwise
     become a title with newlines the reader has no way to set. */
  for (const host of [title, bodyEl]) {
    host.addEventListener('paste', (e) => {
      e.preventDefault();
      let text = e.clipboardData?.getData('text/plain') || '';
      if (host === title) text = text.split('\n')[0].trim();
      if (text) document.execCommand('insertText', false, text);
    });
    host.addEventListener('drop', (e) => e.preventDefault());
  }

  /* Listeners on shared objects unhook themselves once the editor is off
     screen. The router swaps views by replacing the mount's children and tells
     nobody, and a replaceState navigation — which is how publishing leaves —
     never fires hashchange, so "remove it when we leave" has no single event
     to hang on. Asking whether we're still in the document does. */
  function whileMounted(target, type, fn) {
    const handler = (e) => {
      if (!bodyEl.isConnected) { target.removeEventListener(type, handler); return; }
      fn(e);
    };
    target.addEventListener(type, handler);
  }

  whileMounted(document, 'selectionchange', () => marks.sync());

  // Leaving by any route — back arrow, tab, app backgrounding — commits first.
  whileMounted(window, 'hashchange', flush);
  whileMounted(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return view;
}
