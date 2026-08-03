#!/usr/bin/env python3
"""
Build seed/ — the content the app ships with.

The archive holds four folders. The paths are the schema and never change;
what the app calls them on screen is a label and lives in js/store.js:

  moodboard/   the images            — "The Vibe"
  works/       Metalheart, Recursia  — "Compositions"
  reads/       the books             — "Library"
  marginalia/  the essays            — "Marginalia"

The old feed's "finds" (external links) and personal photos are not part of an
editorial archive and are left out. The photos are not deleted — they're moved
to _source-photos/, because eight of them were posted from a phone and exist
nowhere else once the live /marginalia comes down.

Run once from the repo root:  python3 tools/migrate.py
Rebuilds seed/ from scratch; safe to re-run.
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO = Path("/Users/ty/Documents/_Personal/_ZoeAllgaierWebsite")
LIVE = "https://zoeallgaier.com"

# Metalheart comes out of the repo's own art/ folder, which is what .gitignore
# has always said this script reads from. It used to point at an external
# "metalheart is revived/compositions" directory that held an early four of the
# series, so the gallery shipped four pieces while art/metalheart/ held fifteen
# — including every finished composition made since. The repo is the source of
# truth for the work; a folder somewhere else on one machine can't be.
#
# Recursia still comes from the portfolio because the two candidate folders
# genuinely differ there: _assets/recursia holds fifteen cleanly named finished
# pieces, and art/recursia/ is the working directory behind them, full of
# version suffixes (Ouroboros_v2, algorithmica_v3, TheTide.jpg.png).
METALHEART = ROOT / "art" / "metalheart"

# The old feed is read straight out of the portfolio repo. The Archive keeps
# no copy of it — this app is the successor, not a fork of the feed.
SRC_CONTENT = PORTFOLIO / "marginalia" / "content.json"
SRC_POSTS = PORTFOLIO / "marginalia" / "posts"
SRC_ASSETS = PORTFOLIO / "_assets" / "marginalia"
SRC_MOODBOARD = ROOT / "moodboard"
SRC_RECURSIA = PORTFOLIO / "_assets" / "recursia"

SEED = ROOT / "seed"
MEDIA = SEED / "media"
THUMBS = SEED / "thumbs"
BODIES = SEED / "essays"
KEEP_PHOTOS = ROOT / "_source-photos"      # dropped from the app, kept on disk

THUMB_PX = 400
WORK_PX = 1600

SKIP_POSTS = {"example", "post-template"}

# Entries that were only ever a link out of the feed to something else on the
# old site. They have no body to migrate, and the thing they pointed at is
# coming down with /marginalia — so in here they'd be a title and a dead URL.
DROP = {"the-band-name-generator", "eidolon"}

warnings = []


# ── shell helpers ───────────────────────────────────────────────────────────

def sips_dims(paths):
    if not paths:
        return {}
    out = {}
    for i in range(0, len(paths), 200):
        chunk = [str(p) for p in paths[i:i + 200]]
        res = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight"] + chunk,
            capture_output=True, text=True,
        )
        cur = None
        for line in res.stdout.splitlines():
            if not line.startswith(" "):
                cur = line.rstrip(":").strip()
                out.setdefault(cur, [None, None])
            elif cur:
                if "pixelWidth:" in line:
                    out[cur][0] = int(line.split(":")[1])
                elif "pixelHeight:" in line:
                    out[cur][1] = int(line.split(":")[1])
    return {k: tuple(v) for k, v in out.items() if v[0] and v[1]}


def sips_resize(src, dest, max_px, quality=72):
    dest.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality),
         "-Z", str(max_px), str(src), "--out", str(dest)],
        capture_output=True, text=True,
    )
    if res.returncode != 0 or not dest.exists():
        warnings.append("resize failed: %s (%s)" % (src.name, res.stderr.strip()[:80]))
        return False
    return True


def slugify(text):
    s = re.sub(r"[^\w\s-]", "", (text or "").lower())
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    return re.sub(r"-{2,}", "-", s)


# ── post body extraction ────────────────────────────────────────────────────

class BodyExtractor(HTMLParser):
    """Inner HTML of <div class="post-body">, tracking div depth so we stop at
    the right closing tag. Also picks up the eyebrow."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.eyebrow = ""
        self._depth = 0
        self._in = False
        self._grab_eyebrow = False

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class", "")
        if not self._in and tag == "div" and "post-body" in cls:
            self._in = True
            self._depth = 0
            return
        if not self._in and "post-eyebrow" in cls:
            self._grab_eyebrow = True
            return
        if self._in:
            if tag == "div":
                self._depth += 1
            self.parts.append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        if self._in:
            self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if self._grab_eyebrow:
            self._grab_eyebrow = False
            return
        if not self._in:
            return
        if tag == "div":
            if self._depth == 0:
                self._in = False
                return
            self._depth -= 1
        self.parts.append("</%s>" % tag)

    def handle_data(self, data):
        if self._grab_eyebrow:
            self.eyebrow += data
        elif self._in:
            self.parts.append(data)

    def handle_entityref(self, name):
        if self._in:
            self.parts.append("&%s;" % name)

    def handle_charref(self, name):
        if self._in:
            self.parts.append("&#%s;" % name)

    def result(self):
        return "".join(self.parts).strip()


IMG_REF = re.compile(r'(?:src|href)="(/_assets/marginalia/([^"]+))"')


def extract_body(slug):
    f = SRC_POSTS / (slug + ".html")
    if not f.exists():
        warnings.append("no post file for '%s'" % slug)
        return None, "", set()

    p = BodyExtractor()
    p.feed(f.read_text(encoding="utf-8"))
    html = p.result()
    if not html:
        warnings.append("empty post-body in %s" % f.name)
        return None, "", set()

    refs = set(m.group(2) for m in IMG_REF.finditer(html))
    html = IMG_REF.sub(
        lambda m: m.group(0).replace(m.group(1), "media/essays/" + m.group(2)), html)
    return html, p.eyebrow.strip(), refs


def acquire(filename, dest_dir):
    """Portfolio copy if it exists, otherwise off the live server."""
    dest = dest_dir / filename
    if dest.exists() and dest.stat().st_size > 0:
        return True

    dest_dir.mkdir(parents=True, exist_ok=True)
    local = SRC_ASSETS / filename
    if local.exists():
        shutil.copy2(local, dest)
        return True

    url = "%s/_assets/marginalia/%s" % (LIVE, urllib.parse.quote(filename))
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            data = r.read()
        if not data:
            raise IOError("empty response")
        dest.write_bytes(data)
        print("      pulled from live: %s" % filename)
        return True
    except Exception as e:
        warnings.append("could not get %s — %s" % (filename, e))
        return False


# ── builders ────────────────────────────────────────────────────────────────

def strip_byline(title):
    """Library titles are written "Book — Author". Split so the app can set
    them at different sizes instead of printing one run-on line."""
    m = re.match(r"^(.*?)\s+[—–]\s+(.+)$", title or "")
    return (m.group(1), m.group(2)) if m else (title, "")


def build_from_feed():
    entries = json.loads(SRC_CONTENT.read_text(encoding="utf-8"))

    essays, books = [], []
    wanted = set()
    rescue = set()
    seen = {}

    for e in entries:
        kind = e.get("type")
        title = e.get("title", "")
        url = e.get("url", "")
        date = e.get("date", "")
        image = e.get("image", "")

        # Personal photos and external finds are not part of the archive, but
        # the photos are the only copy of themselves — keep the files.
        if kind in ("photo", "find"):
            if image:
                rescue.add(Path(image).name)
            continue

        if kind == "library":
            name, author = strip_byline(title)

            # The old feed hid the byline in the note field, written
            # "Author (Year)". In a list of reads the author isn't an
            # annotation, it's half the entry — so it gets promoted to its own
            # field and the note stops existing, because it never said
            # anything else.
            m = re.match(r"^\s*(.+?)\s*\((\d{4})\)\s*$", e.get("note") or "")
            year = ""
            if m:
                author, year = m.group(1), m.group(2)
            elif not author:
                author = (e.get("note") or "").strip()

            node = {"path": "reads/" + slugify(name), "kind": "book",
                    "title": name, "date": date}
            if author:
                node["author"] = author
            if year:
                node["year"] = year
            books.append(node)
            continue

        if kind != "post":
            continue

        m = re.match(r"^posts/(.+)\.html$", url or "")
        local_post = m.group(1) if m else None
        if local_post in SKIP_POSTS:
            continue

        slug = local_post or slugify(title) or slugify(date)
        if slug in DROP:
            continue
        if slug in seen:
            seen[slug] += 1
            slug = "%s-%d" % (slug, seen[slug])
        else:
            seen[slug] = 1

        node = {"path": "marginalia/" + slug, "kind": "essay",
                "title": title, "date": date}
        if e.get("note"):
            node["note"] = e["note"]

        if image:
            wanted.add(Path(image).name)
            node["media"] = "media/essays/" + Path(image).name

        if local_post:
            html, eyebrow, refs = extract_body(local_post)
            if html:
                BODIES.mkdir(parents=True, exist_ok=True)
                (BODIES / (slug + ".html")).write_text(html, encoding="utf-8")
                node["body"] = "essays/" + slug + ".html"
                wanted |= refs
            elif url:
                node["url"] = url
        elif url:
            node["url"] = url

        essays.append(node)

    print("Marginalia: %d essays" % len(essays))
    print("Reading: %d books" % len(books))

    for fn in sorted(wanted):
        acquire(fn, MEDIA / "essays")

    # Not in the app, not thrown away.
    print("Rescuing %d dropped photos to _source-photos/" % len(rescue))
    for fn in sorted(rescue):
        acquire(fn, KEEP_PHOTOS)

    dims = sips_dims([MEDIA / "essays" / Path(n["media"]).name
                      for n in essays if "media" in n])
    for n in essays:
        if "media" in n:
            key = str(MEDIA / "essays" / Path(n["media"]).name)
            if key in dims:
                n["w"], n["h"] = dims[key]

    return essays + books


def build_work(slug, title, date, sources):
    out_full = MEDIA / "works" / slug
    out_thumb = THUMBS / "works" / slug

    pieces = []
    for src in sources:
        name = slugify(src.stem)
        full = out_full / (name + ".jpg")
        thumb = out_thumb / (name + ".jpg")
        if not full.exists() and not sips_resize(src, full, WORK_PX, quality=80):
            continue
        if not thumb.exists():
            sips_resize(full, thumb, THUMB_PX)
        pieces.append((name, full, thumb, src.stem))

    dims = sips_dims([f for _, f, _, _ in pieces])
    nodes = []
    for i, (name, full, thumb, orig) in enumerate(pieces):
        node = {
            "path": "works/%s/%s" % (slug, name),
            "kind": "image",
            "title": orig.replace("-", " ").replace("_", " ").strip(),
            "media": "media/works/%s/%s.jpg" % (slug, name),
            "thumb": "thumbs/works/%s/%s.jpg" % (slug, name),
            "order": i,
        }
        w, h = dims.get(str(full), (None, None))
        if w and h:
            node["w"], node["h"] = w, h
        nodes.append(node)

    work = {"path": "works/" + slug, "kind": "work", "title": title,
            "date": date, "count": len(pieces)}
    if pieces:
        work["thumb"] = "thumbs/works/%s/%s.jpg" % (slug, pieces[0][0])
    print("  %s: %d pieces" % (title, len(pieces)))
    return [work] + nodes


def build_works():
    print("Works:")
    out = []

    recursia = sorted([p for p in SRC_RECURSIA.iterdir()
                       if p.suffix.lower() in (".jpg", ".jpeg", ".png")]) \
        if SRC_RECURSIA.exists() else []
    out += build_work("recursia", "Recursia", "2026", recursia)

    # Same piece exists as both .png and .jpg in places — dedupe by stem.
    mh = {}
    if METALHEART.exists():
        for p in sorted(METALHEART.iterdir()):
            if p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            if p.stem not in mh or p.suffix.lower() == ".png":
                mh[p.stem] = p
    out += build_work("metalheart", "Metalheart", "2025", [mh[k] for k in sorted(mh)])
    return out


def build_moodboard():
    files = sorted([p for p in SRC_MOODBOARD.iterdir()
                    if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    print("Moodboard: %d images" % len(files))

    out_full = MEDIA / "moodboard"
    out_thumb = THUMBS / "moodboard"
    out_full.mkdir(parents=True, exist_ok=True)
    out_thumb.mkdir(parents=True, exist_ok=True)

    for p in files:
        dest = out_full / p.name
        if not dest.exists():
            shutil.copy2(p, dest)

    dims = sips_dims([out_full / p.name for p in files])

    nodes = []
    for i, p in enumerate(files):
        if i and i % 40 == 0:
            print("  thumbnailing %d/%d…" % (i, len(files)))
        thumb = out_thumb / (p.stem + ".jpg")
        if not thumb.exists():
            sips_resize(out_full / p.name, thumb, THUMB_PX)

        node = {"path": "moodboard/" + p.stem, "kind": "image",
                "media": "media/moodboard/" + p.name,
                "thumb": "thumbs/moodboard/" + p.stem + ".jpg"}
        w, h = dims.get(str(out_full / p.name), (None, None))
        if w and h:
            node["w"], node["h"] = w, h
        else:
            warnings.append("no dimensions for moodboard/%s" % p.name)
        nodes.append(node)
    return nodes


def main():
    if not SRC_CONTENT.exists():
        sys.exit("Can't find %s" % SRC_CONTENT)

    for d in (MEDIA, THUMBS, BODIES):
        d.mkdir(parents=True, exist_ok=True)

    nodes = build_from_feed() + build_works() + build_moodboard()

    # A fingerprint of the seed's contents. The app stores this next to the
    # user's copy of the index and re-seeds whenever it changes, so editing
    # this script and re-running it actually reaches the phone instead of
    # being masked by the index already on disk.
    version = hashlib.sha1(
        json.dumps(nodes, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:12]

    (SEED / "index.json").write_text(
        json.dumps({"version": version, "nodes": nodes}, indent=1, ensure_ascii=False),
        encoding="utf-8")
    print("seed version %s" % version)

    print("\n%d nodes → seed/index.json" % len(nodes))
    size = sum(f.stat().st_size for f in SEED.rglob("*") if f.is_file())
    print("seed/ is %.1f MB" % (size / 1e6))

    if warnings:
        print("\n%d warning(s):" % len(warnings))
        for w in warnings:
            print("  ! " + w)
    else:
        print("\nNo warnings.")


if __name__ == "__main__":
    main()
