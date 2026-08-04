/* ═══════════════════════════════════════════════════════════════════════════
   STORE — the content index, in memory, backed by one file on disk.

   ~250 nodes. That's small enough that a single JSON document held in memory
   beats a database on every axis that matters here: no plugin, no schema, no
   query layer, and the whole archive is one object you can log. Revisit only
   if this ever reaches thousands of entries.

   A node is a path plus a kind. The file tree is DERIVED from those paths —
   the filesystem isn't a metaphor laid over the data, it IS the schema, so a
   new folder is just a new path prefix and nothing here needs to change.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readIndex, writeIndex, deleteMedia } from './platform.js';

let nodes = [];
let loaded = false;

/* The five top-level folders, in the order they appear on the home screen:
   images, then the work, then what was read, then the finished writing, then
   the unfinished kind. Loosest to tightest — the archive opens on the thing
   you look at without reading and ends on the thing nobody has read yet.

   `name` is the display word and `prefix` is the path, and they are allowed to
   disagree. A path is an identifier: it was written into 289 nodes at
   migration and renaming one would mean rewriting every one of them plus every
   route that points at them. A name is a label on a screen. So the folder
   whose contents live under `works/` is called Artwork, `marginalia/` is
   called Essays, `braindumps/` is called Notes, and nothing on disk moved for
   any of it — which is the point of the split. Three of the five names have
   been changed since migration and no node has ever been rewritten for one.

   `mode` is how the row behaves. Most folders expand in place, which is the
   point of a file tree. The Vibe opens instead: 200-odd filenames is not
   information, and the grid IS how you read that folder.

   `treat` is how the folder's contents are SET — see tree.js.

   `add` is what making a new one of these MEANS, and this list is therefore
   also the menu the ＋ opens — see create.add. That's the reason it is worth a
   field here rather than a switch over folder names somewhere else: the
   archive has five places a thing can go, so adding has five answers, and the
   tree and the ＋ card are two readings of the same five rows in the same
   order, printing the same five words.

   It is also why nothing here lists where a written piece may land any more. A
   new piece used to be published into a folder chosen at the end, because
   starting from a bare Write button there was no earlier moment to ask. Now
   you start from the folder, so the answer arrives with the question.

   There is no `icon` field any more. Each folder used to carry the name of a
   sprite, because the ＋ opened a dial of round buttons with no room for a
   word in them and the tree set the same drawings beside its own words. Both
   are lists of names now, and a row that has `name` doesn't need a picture of
   it — the five drawings went out of index.html with the field. */
export const FOLDERS = [
  { name: 'The Vibe', prefix: 'moodboard/',  mode: 'open',   route: '#/moodboard', add: 'photos' },
  { name: 'Artwork',  prefix: 'works/',      mode: 'expand', treat: 'work',  add: 'pieces' },
  { name: 'Library',  prefix: 'reads/',      mode: 'expand', treat: 'read',  add: 'book'   },
  { name: 'Essays',   prefix: 'marginalia/', mode: 'expand', treat: 'essay', add: 'write'  },
  { name: 'Notes',    prefix: 'braindumps/', mode: 'expand', treat: 'essay', add: 'write'  },
];

/** The display word for a path's folder, e.g. "reads/behave" -> "Library". */
export function folderName(path) {
  const f = FOLDERS.find((x) => path.startsWith(x.prefix));
  return f ? f.name : '';
}

/* ── Boot ───────────────────────────────────────────────────────────────────
   First launch seeds from seed/index.json. Only the INDEX is copied into local
   storage — seed media stays where it is and is addressed in place, served as
   ordinary files and held offline by the service worker. Duplicating 51MB into
   IndexedDB to own a second identical copy would be pure waste.

   After that, the saved index is authoritative — except when the seed changes
   underneath it. That happens every time the migration is re-run and pushed,
   and without the reconciliation below the app would keep showing the old
   content forever with no indication why.

   Reconciling has to be conservative in one specific direction: seeded
   content is regenerable and may be replaced freely, but anything you made or
   changed must survive untouched. So three things are carried across a
   re-seed — nodes you created, seeded nodes you edited, and the fact that you
   deleted something. */

let seedVersion = null;
let deleted = new Set();

export async function load() {
  if (loaded) return nodes;

  const seed = await fetch('seed/index.json').then((r) => r.json());
  const saved = await readIndex();

  if (!saved || !Array.isArray(saved.nodes)) {
    nodes = seed.nodes;
    seedVersion = seed.version;
    await persist();
  } else if (saved.seedVersion !== seed.version) {
    nodes = reconcile(seed, saved);
    seedVersion = seed.version;
    deleted = new Set(saved.deleted || []);
    await persist();
  } else {
    nodes = saved.nodes;
    seedVersion = saved.seedVersion;
    deleted = new Set(saved.deleted || []);
  }

  sort();
  loaded = true;
  return nodes;
}

function reconcile(seed, saved) {
  const savedByPath = new Map(saved.nodes.map((n) => [n.path, n]));
  const gone = new Set(saved.deleted || []);

  // Start from the new seed, minus anything deliberately deleted, preferring
  // the saved copy of any seeded entry that's been edited here.
  const out = seed.nodes
    .filter((n) => !gone.has(n.path))
    .map((n) => {
      const mine = savedByPath.get(n.path);
      return mine && mine.edited ? mine : n;
    });

  // Then everything created in the app, which the seed knows nothing about.
  const seedPaths = new Set(seed.nodes.map((n) => n.path));
  for (const n of saved.nodes) {
    if (n.own && !seedPaths.has(n.path)) out.push(n);
  }

  return out;
}

async function persist() {
  await writeIndex({
    version: 1,
    seedVersion,
    deleted: [...deleted],
    nodes,
  });
}

/* Newest first everywhere, with undated nodes (moodboard images) falling to
   their natural order at the end of their own folder. */
function sort() {
  nodes.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export const all = () => nodes;

export const get = (path) => nodes.find((n) => n.path === path);

/** Direct children of a folder prefix — one level down, not the whole subtree. */
export function children(prefix) {
  const depth = prefix.split('/').filter(Boolean).length;
  return nodes.filter((n) => {
    if (!n.path.startsWith(prefix)) return false;
    return n.path.split('/').filter(Boolean).length === depth + 1;
  });
}

/** Everything under a prefix, at any depth. */
export const subtree = (prefix) => nodes.filter((n) => n.path.startsWith(prefix));

export const count = (prefix) => subtree(prefix).length;

/* There are no tags. An image carries no words, so it isn't searchable, and
   that is the honest state of it — the alternative was a tagging mode, a
   vocabulary, chips in three places and an afternoon of labelling two hundred
   photographs before search returned a single one of them. The wall is how you
   find an image. Search is for text. */

/** The folder a node lives in, e.g. "marginalia/apathy" -> "marginalia". */
export const folderOf = (path) => path.split('/')[0];

/* ── Writes ─────────────────────────────────────────────────────────────── */

export async function add(node) {
  // Paths are identity here, so a collision would silently replace an entry.
  if (get(node.path)) {
    let i = 2;
    const base = node.path;
    while (get(`${base}-${i}`)) i++;
    node.path = `${base}-${i}`;
  }

  /* Newest first is the rule everywhere, and an image has no date to sort by —
     so it gets an order below everything already in its folder. Without this a
     photo you just took would land at tile 146, which is the same as losing
     it. Descending rather than renumbering the folder: nothing else has to be
     touched, and the seed's own order stays exactly as migrated. */
  if (node.order === undefined && !node.date) {
    const prefix = node.path.slice(0, node.path.lastIndexOf('/') + 1);
    const orders = children(prefix).map((n) => n.order ?? 0);
    node.order = orders.length ? Math.min(...orders) - 1 : 0;
  }

  node.own = true;               // yours — survives every future re-seed
  nodes.push(node);
  // Un-delete: making something at a path you'd previously cleared is an
  // explicit statement that you want it back.
  deleted.delete(node.path);
  sort();
  await persist();
  return node;
}

/* Change a node's path. Publishing is the only caller: a draft has to live
   somewhere to be saved at all, so it's created in marginalia/ and moved if you
   decide it was a braindump.

   The move is recorded as a deletion of the old path as well as a write of the
   new one. Nothing seeded is ever moved — only your own drafts are — but if
   that changed, a re-seed would otherwise resurrect the node at its old path
   and you'd have two of it. */
export async function move(from, to) {
  const n = get(from);
  if (!n || from === to) return n;

  let path = to;
  if (get(path)) {
    let i = 2;
    while (get(`${to}-${i}`)) i++;
    path = `${to}-${i}`;
  }

  n.path = path;
  n.edited = true;
  deleted.add(from);
  deleted.delete(path);
  sort();
  await persist();
  return n;
}

export async function update(path, patch) {
  const n = get(path);
  if (!n) return null;
  Object.assign(n, patch);
  n.edited = true;               // don't let a re-seed overwrite this
  sort();
  await persist();
  return n;
}

export async function remove(path) {
  const n = get(path);
  if (!n) return;
  // Only user media is ours to delete; seed media lives in the read-only bundle.
  for (const key of ['media', 'thumb']) {
    if (n[key] && n[key].startsWith('media/user/')) await deleteMedia(n[key]);
  }
  nodes = nodes.filter((x) => x.path !== path);
  // Remember the deletion. Without this, the next re-seed would cheerfully
  // resurrect anything you removed from the bundled content.
  deleted.add(path);
  await persist();
}
