# The Archive

A personal archive — moodboard, artwork, books read, essays, notes.

A static web app, installed to the iPhone homescreen from its URL. **That is
the only target.** There is no native build, no App Store, no Xcode.

No build step. No framework. No bundler. **No dependencies at all** — there is
no `package.json` and nothing to install. ES modules, three stylesheets, and one
JSON index, served straight off disk. `index.html` is the whole entry point.

---

## Who you're working with

**Zoe is a designer.** She owns the visual and interaction decisions and is
sharp about them — the doctrine in `tokens.css` is hers and it is coherent.

She does not necessarily read the storage, routing, or build layers the way she
reads the CSS, and should not have to. So:

- **Lead with the consequence, not the mechanism.** Not "IndexedDB is
  origin-scoped" — *"photos added in Chrome will not appear on your phone,
  ever."* Not "the service worker is network-first" — *"a push reaches your
  phone on the next launch."*
- **Say what a technical choice costs her in the product.** Storage limits,
  offline behaviour, what happens if a phone is lost, what breaks if she taps
  the wrong thing. Those are design constraints; she'll weigh them well once
  they're in those terms.
- **Never let a backend decision quietly narrow the design.** If something
  can't be built the way she drew it, say so plainly and say what *can* be —
  don't silently ship the easier interaction.
- **Don't ask her to arbitrate implementation detail.** Pick the sound option,
  say which you picked in a sentence, move on. Ask when the answer is a
  product or taste decision — that's hers.
- Explaining the reasoning is welcome; assuming she already knows the jargon is
  not. She's said as much directly.

---

## The workflow

**Claude builds. Zoe reviews the deployed site. Claude does not screenshot every
change.**

1. Make the change locally.
2. Sanity-check it headlessly if the change has behaviour (see *Testing*).
3. Commit and push to `main`.
4. GitHub Pages redeploys `main` in ~30–60s.
5. Zoe reviews at **https://zoeallgaier.github.io/the-archive/** — on the Mac,
   or on the phone, whichever is nearer.

The deployed site is the sandbox, the review surface, and the backup. Do not
burn credits screenshotting what Zoe is about to look at anyway. Screenshots are
for when *you* need to see something to debug it, not to present finished work.

There is nothing to build before pushing. What is in the repo is what ships.

### Deploying

```sh
git add -A && git commit -m "…" && git push
```

That is the deploy — the whole of it. Pages serves the repo root from `main`.
`.nojekyll` is present so directories beginning with `_` are not swallowed.

### Getting it onto the phone

Safari → the URL → Share → **Add to Home Screen**. Once. After that a push
reaches the phone on the next launch, because `sw.js` is network-first for the
app itself.

If a change appears not to land: the service worker serves the cache only when
the network fails, so a stale screen means the request failed, not that the
cache is stuck. Bumping `VERSION` in `sw.js` drops every cached byte and is the
blunt instrument if one is ever needed.

---

## The delivery target, and what it cost

**Decided and done: the homescreen web app is the only target.** The native
Capacitor/iOS build was deleted — `ios/`, `www/`, `capacitor.config.json`,
`ios-sync.sh`, `package.json`, `package-lock.json`, and the whole dependency
tree. **Do not reintroduce it**, and do not add a dependency without asking:
having none is a property of this app, not an accident.

The reason was the loop, not the result. Getting a change onto the phone meant
Xcode, a cable and a signing certificate that expires every seven days on a free
Apple account. Against `git push` and a relaunch. For an archive whose main
activity is design iteration, that difference *is* the product.

### What was given up, honestly

- **Haptics. Permanently.** iOS Safari implements no vibration API —
  `navigator.vibrate` does not exist in WebKit and there is no fallback. The
  tree tick and the selection tick are gone. `tick()` and `selectionTick()`
  survive in `platform.js` as documented no-ops so the *seams* are recorded;
  see the note there before deleting them.
- **Durable storage.** Data lives in `localStorage` + IndexedDB. iOS ages out
  script-writable storage, it is outside the device backup, and "Clear Website
  Data" takes it. **This is reasoning from documented WebKit behaviour, not a
  measurement on Zoe's phone** — treat it as a risk to design around, not a
  fact to quote at her.

So the rule until export exists: **the archive is safe to read and to review
design in. Anything written into it should be assumed temporary.** The seeded
289 nodes are fine regardless — they ship in the repo and re-download.

### The way out, and it closes two gaps at once

Build **export/import**, and shape the export like `seed/`.

Then a bundle exported from the phone is something Zoe drops into the repo and
commits — and the repo becomes the backup *and* the sync path in one move:
commit on the Mac, push, and the phone has it on next launch. It is the thing
she already described wanting the GitHub site to be.

That is the highest-value feature left in this app, and it is the precondition
for the archive being a safe place to author. `platform.js` already has
`writeDocument()` and `readMediaBase64()` sitting unused for exactly this.

---

## Architecture

```
index.html          entry point, the SVG icon sprite, SW registration
manifest.webmanifest  } together, these are what make the URL installable
icons/                }
sw.js               the offline guarantee — nothing else provides one
css/tokens.css      the entire visual language — every value lives here
css/base.css        reset, @font-face, the grain layer
css/app.css         every component
js/app.js           boot, hash routing, the composer, swipe-back
js/store.js         the node index, in memory, one JSON blob behind it
js/platform.js      storage, camera roll, feedback — the ONLY file that
                    touches localStorage, IndexedDB or a file input
js/media.js         image paths → renderable URLs; camera-roll import
js/ui.js            el(), card(), toast(), confirm(), the shared vocabulary
js/tree.js          home screen
js/entries.js       the reader
js/editor.js        the live editor  ← the subtle file, read its header
js/gallery.js       moodboard, artwork, lightbox
js/search.js        search results
js/create.js        everything you can add, and the ＋ card
seed/index.json     289 seeded nodes — the shipped content
seed/media|thumbs|essays
tools/migrate.py    regenerates seed/ from the source folders
```

### The data model

A node is **a path plus a kind**. That is the whole schema.

```js
{ path: 'marginalia/apathy', kind: 'essay', title, date, note, body|bodyInline, media, thumb, w, h }
```

Kinds: `image`, `book`, `essay`, `work`.

The folder tree is **derived from the paths**. There is no folder table — a new
folder is a new path prefix. `FOLDERS` in `store.js` maps a prefix to a display
name, and the two are allowed to disagree: `works/` is called *Artwork*,
`marginalia/` is *Essays*, `braindumps/` is *Notes*. Paths are identity and were
written into 289 nodes at migration; names are labels on a screen. **Never
rename a prefix to match a name.**

### Storage, and what "on device" means

| what | where | durable? |
|---|---|---|
| the index | `localStorage['archive.index']` | no — see above |
| media you add | IndexedDB blobs, object URLs | no |
| seeded content | ordinary files under `seed/`, cached by `sw.js` | yes, it's in the repo |

Everything goes through `platform.js`. No other file may reach for a storage
API directly — that rule is what kept the native build swappable, and it is
what will keep export/import from spraying across nine files.

**User data never leaves the browser it was created in.** The repo ships the
*seed*; anything added in the app is local to that one browser on that one
device. See *Sync* below.

### Re-seeding

`store.load()` reconciles the saved index against the bundled seed whenever
`seed.version` changes. Three things survive a re-seed: nodes you created
(`own: true`), seeded nodes you edited (`edited: true`), and the fact that you
deleted something (the `deleted` list). Everything else is replaced from the
seed. This is tested — see *Testing*.

---

## Design doctrine

`css/tokens.css` is the design system and the argument for it. Read its header
before changing anything visual. In short:

- **Two colours.** Pure black and pure white, swapped by `prefers-color-scheme`.
  No accent, ever. "This one" is said by **inverting** — ink ground,
  page-coloured mark — which is what the lit formatting mark, the ticked
  checkbox and the card's affirmative all do.
- **One face.** Oxygen Light. Oxygen Bold exists for exactly one selector,
  `.prose strong`. Hierarchy everywhere else is **size and ink**.
- **Every spatial value is a multiple of `--u` (4px).** No magic numbers, and no
  raw values outside `tokens.css`.
- **Two shapes:** a rounded pill with a sharp 1px outline filled with the page,
  or nothing. No blur, no shadow, no glass, no backdrop-filter.
- **No screen has a header.** All chrome is the bottom composer row, which
  morphs — buttons collapse to zero width rather than appearing and
  disappearing. A view declares what it needs by hanging `__chrome` off itself.
- **Every question is a card.** One shape for the ＋ menu, the ⋯ menu,
  confirmations, and short forms.

The source comments are unusually long and they are load-bearing: most of them
record a thing that was tried and rejected, and why. **Preserve that voice.**
When you change something these comments describe, update the comment to explain
the new reasoning — do not delete the history and do not leave it stale.

---

## Gotchas

Things that have already cost a debugging session. Do not re-learn them.

**`editor.js` is a live `contenteditable`, and webviews lie about it.**
- Nothing enters the document except through `rebuild()` — an allowlist of tags.
- Every edit goes through `execCommand`, deprecated and all, because it is the
  only route into the browser's native undo stack.
- **`execCommand('outdent')` DESTROYS the contents of a top-level
  `<blockquote>` in WebKit.** Un-quoting uses `formatBlock('<p>')` first and a
  hand-unwrap as fallback. Never reintroduce `outdent` here.
- **Moving a node loses the caret in WebKit** even when the selection's
  endpoints are inside the moved subtree. Anything that reparents must put the
  caret back by hand. This is what `blockifyCaret()` and the `li` capture in
  `list()` are for.
- **A DOM built by hand permits nesting the parser does not.** `<p><h2>…</h2></p>`
  serialises fine and is torn apart on the next load, so the document changes
  shape every time it is opened. `unwrapNestedBlocks()` in `normalise()` is the
  guard. Do not remove it.

**`contain-intrinsic-size` does not take percentages.** Tiles use
`aspect-ratio` from the node's stored `w`/`h`. This is what stops the gallery
reflowing under your thumb.

**Dates are parsed and formatted by hand.** `new Date('2026-02-09')` is
UTC-midnight and renders as the previous day west of UTC. See `fmtDate()` and
the two `today()` helpers.

**Derive counts, don't store them.** The seeded `work` nodes carry a stale
`count` field. The tree counts children live. Anything derivable should be
derived.

**`.gitignore` anchors matter.** `/moodboard/` with a leading slash. Unanchored,
it also swallows `seed/media/moodboard/` — 209 images the app cannot run
without, silently missing from the repo.

**A card and the lightbox both close on `popstate`.** Swipe-back is disabled
while either is up (`overlayUp()` in `app.js`).

---

## Testing

There is no test suite. There is Playwright + WebKit, which is the closest
available thing to the iOS webview, and it has found every real bug in this app.

```sh
python3 -m http.server 8777 --bind 127.0.0.1 &
node your-probe.mjs        # playwright, webkit, viewport 390×844, isMobile
```

Drive the real flows and read the DOM back. What to check after touching the
editor, in this order:

1. Type a title, Enter, a paragraph.
2. `- ` then two items — assert `ul` has **two** `li`, and that the text is
   *inside* them.
3. `[ ] ` then two items — same.
4. `# ` then a heading, then Enter and a paragraph.
5. Read `bodyInline` out of `localStorage` and re-parse it. **The re-parsed
   structure must equal the live DOM.** If it doesn't, the document is
   corrupting on save and everything else is cosmetic.
6. Reopen the same essay three times, typing one character each time. The stored
   HTML must be stable apart from that character.

For the rest of the app: expand a folder, open an essay, open the lightbox,
search, add a book, delete something, reload, and bump `seedVersion` to `STALE`
in localStorage to exercise reconciliation.

---

## Known gaps

Not bugs — things that genuinely do not exist yet.

- **No export/import.** `platform.js` has `writeDocument()` and
  `readMediaBase64()` and nothing calls them. **This is the next thing to
  build** — see *The delivery target* above for why it is load-bearing rather
  than nice to have.
- **No sync.** Content added on the phone is not on the Mac and vice versa. See
  below.
- **No haptics, and no way to get them back** on this platform. See
  *platform.js*.
- **Swipe-back is unverified on an installed homescreen app** — iOS may run its
  own edge gesture alongside this one and pop history twice. Flagged in the
  comment in `app.js`; needs a check on the actual phone.
- **No way to reorder or retitle images**, or to move one between folders.
- **Search is text only.** Images carry no words and are not indexed; the wall
  is how you find one. This is deliberate.

## Sync — read before promising anything

**The repo hosts the app and the seeded content. It does not host your data.**

- Everything in `seed/` is committed, so it appears identically on every device
  that opens the site. That is not sync, that is a shipped asset.
- Anything you add *in the app* — a photo, a note, a book — is written to that
  one browser's `localStorage`/IndexedDB and goes nowhere else.
- Chrome on the Mac and Safari on the phone are **two separate stores.** So are
  Safari and Chrome on the same Mac, and so is the homescreen app versus a
  Safari tab pointed at the same URL. None of them will ever see each other's
  content.
- Clearing website data wipes all of it, and none of it is in the iOS backup.

To make content real on both devices today, it has to go through `seed/` and be
committed. Anything else needs a sync backend, which this app deliberately does
not have.
