# The Archive

A personal archive — moodboard, artwork, books read, essays, notes — that runs
as a static web app and as a native iOS app from the same source.

No build step. No framework. No bundler. ES modules, three stylesheets, and one
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

That is the deploy. Pages serves the repo root from `main`. `.nojekyll` is
present so directories beginning with `_` are not swallowed.

### The iOS build

```sh
./ios-sync.sh          # mirrors web assets into www/, then npx cap sync ios
```

Then Run in Xcode. `www/` is generated on every sync and gitignored — **never
edit anything in `www/`**, edit the source and re-run. `sw.js` is deliberately
not mirrored: the native build already loads every asset off the device.

---

## Delivery target: homescreen shortcut vs native app

**Current answer: the Safari homescreen shortcut is the primary target, and the
native build stays as a secondary one. But browser storage is scratch until
export/import exists.**

The two builds are the same source and differ only in what is underneath
`platform.js`. What that difference actually costs:

| | Homescreen shortcut | Native (Capacitor) |
|---|---|---|
| Getting a change onto the phone | `git push`, next launch | Xcode, cable, re-sign |
| Offline | yes, via `sw.js` | yes, assets are on disk |
| Haptics | **none** | yes |
| Where data lives | localStorage + IndexedDB | files in the app container |
| In the iOS device backup | **no** | yes |
| Can iOS delete it | **yes** | no |
| Storage ceiling | a WebKit quota | free space |

The top row is why the shortcut wins for how this app is actually worked on:
design iteration is the main activity, and one of these has a thirty-second
loop while the other has Xcode in it.

The rows in bold are the price. Script-writable storage on iOS is *evictable* —
WebKit ages it out and reclaims it under pressure. Installed homescreen web apps
get more latitude than a plain Safari tab, but it is still storage the OS is
allowed to reclaim, it is not something you can point at in a backup, and
"Clear Website Data" reaches it. **This has not been tested on Zoe's device and
is reasoning about documented WebKit behaviour, not a measurement.** Treat it as
a risk to design around rather than a fact to quote at her.

So the rule until export exists: **the homescreen shortcut is for reading the
archive and reviewing design. Anything written into it should be assumed
temporary.** The seeded 289 nodes are safe regardless — they ship in the repo
and re-download.

### The way out, and it closes two gaps at once

Build **export/import**, and shape the export like `seed/`.

Then a bundle exported from the phone is something Zoe drops into the repo and
commits — and the repo becomes the backup *and* the sync path in one move:
commit on the Mac, push, and the phone has it on next launch. It is the thing
she already described wanting the GitHub site to be.

That is the highest-value feature left in this app, and it is the precondition
for the homescreen shortcut being a safe place to author. `platform.js` already
has `writeDocument()` and `shareFile()` sitting unused for exactly this.

Do not let the native build quietly become the "real" one. It has a signing
treadmill on a free Apple account and it breaks the review loop that the whole
workflow above is built on.

---

## Architecture

```
index.html          entry point, the SVG icon sprite, SW registration
manifest.webmanifest
sw.js               offline cache for the web build only
css/tokens.css      the entire visual language — every value lives here
css/base.css        reset, @font-face, the grain layer
css/app.css         every component
js/app.js           boot, hash routing, the composer, swipe-back
js/store.js         the node index, in memory, one JSON file behind it
js/platform.js      the ONLY file that knows native-vs-browser
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

| | Native iOS | Browser |
|---|---|---|
| index | file in app Data dir | `localStorage['archive.index']` |
| media | files under `Data/media/` | IndexedDB blobs |

Everything goes through `platform.js`. No other file may touch Capacitor.

**User data never leaves the device it was created on.** The repo ships the
*seed*; anything added in the app lives only in that browser's storage or that
phone's app container. See *Sync* below.

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

- **No export/import.** `platform.js` has `writeDocument()` and `shareFile()`
  and nothing calls them. **This is the next thing to build** — see *Delivery
  target* above for why it is load-bearing rather than nice to have.
- **No sync.** Content added on the phone is not on the Mac and vice versa. See
  below.
- **No way to reorder or retitle images**, or to move one between folders.
- **Search is text only.** Images carry no words and are not indexed; the wall
  is how you find one. This is deliberate.

## Sync — read before promising anything

**The repo hosts the app and the seeded content. It does not host your data.**

- Everything in `seed/` is committed, so it appears identically on every device
  that opens the site. That is not sync, that is a shipped asset.
- Anything you add *in the app* — a photo, a note, a book — is written to that
  browser's `localStorage`/IndexedDB, or to that phone's app container.
- Chrome on the Mac and Safari on the phone are **two separate stores.** So are
  Safari and Chrome on the same Mac. They will never see each other's content.
- Clearing site data wipes anything added in the browser. The native app's data
  is in the iOS backup; the browser's is not.

To make content real on both devices today, it has to go through `seed/` and be
committed. Anything else needs a sync backend, which this app deliberately does
not have.
