/* ═══════════════════════════════════════════════════════════════════════════
   EDITOR — writing.

   Full screen, no header. The title and body are set in exactly the type the
   reader uses, so what you write looks like what you'll read.

   Two things are happening at once and they are not the same thing:

     SAVING is automatic and constant. A keystroke is a local file write, which
     costs nothing here, so there is no Save button and no unsaved state to
     lose. Closing the app mid-sentence is safe.

     PUBLISHING is a decision you make once, with a button. Until you make it
     the piece is a draft: it's in the tree, it opens, it's yours — it just
     isn't dated, because the date an essay carries should be the day you
     decided it was finished, not the day you opened a blank one. Publishing is
     also where the piece finds out which folder it lives in, since you often
     don't know whether you were writing marginalia or a braindump until you've
     stopped writing.

   The formatting row under the title is the whole of the app's formatting. It
   writes markdown into the textarea rather than styling a contenteditable —
   the text stays text, the autosave stays a string comparison, and nothing can
   paste a colour or a font into the archive.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as store from './store.js';
import { el, card, toast } from './ui.js';
import { tick, selectionTick } from './platform.js';

const AUTOSAVE_MS = 700;

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

/* ── Markdown, the four marks the app has ───────────────────────────────────
   Deliberately not a markdown parser. Four marks exist because four buttons
   exist, and anything the buttons can't produce isn't supported: `**bold**`,
   `*italic*`, a `## ` heading and a `> ` quote. Links, lists and images come
   through from the migrated essays and are preserved on the way out, but you
   can't type new ones, which is the correct amount of formatting for a phone.

   Note bold renders as <strong>, and <strong> in this app is a step up in INK,
   not in weight — see the doctrine in tokens.css. */

const escapeHTML = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineHTML(s) {
  return escapeHTML(s)
    // Bold first: once the pairs are consumed, every asterisk left is italic.
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>');
}

/** The textarea's text -> the same HTML shape the migrated essays use. */
function toHTML(text) {
  return text.split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^#{1,3}\s+/.test(block)) {
        return `<h2>${inlineHTML(block.replace(/^#{1,3}\s+/, ''))}</h2>`;
      }
      if (/^>\s?/.test(block)) {
        const inner = block.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n');
        return `<blockquote><p>${inlineHTML(inner).replace(/\n/g, '<br>')}</p></blockquote>`;
      }
      return `<p>${inlineHTML(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/* ...and back again, so reopening an essay gives you text you can edit rather
   than markup. Walked as a DOM tree instead of regexed, because the migrated
   bodies are real HTML with nesting and attributes, and a regex over those
   would eventually eat something it shouldn't. */

function inlineText(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeName === 'STRONG' || n.nodeName === 'B') out += `**${inlineText(n)}**`;
    else if (n.nodeName === 'EM' || n.nodeName === 'I') out += `*${inlineText(n)}*`;
    else out += inlineText(n);
  }
  return out;
}

function toText(html) {
  if (!html) return '';
  const box = document.createElement('div');
  box.innerHTML = html;

  const blocks = box.children.length ? [...box.children] : [box];
  return blocks.map((n) => {
    switch (n.nodeName) {
      case 'H1': case 'H2': case 'H3':
        return `## ${inlineText(n)}`;
      case 'BLOCKQUOTE':
        return inlineText(n).trim().split('\n').map((l) => `> ${l}`).join('\n');
      case 'UL': case 'OL':
        return [...n.children].map((li) => `• ${inlineText(li)}`).join('\n');
      default:
        return inlineText(n);
    }
  }).map((s) => s.trim()).filter(Boolean).join('\n\n');
}

/* ── The formatting row ─────────────────────────────────────────────────────
   Two shapes of mark, so two shapes of button. `wrap` puts a mark on either
   side of the selection and takes it off again if it's already there; `lead`
   puts one at the head of the line the caret is in, and toggles the same way.
   Both restore the selection afterwards, so you can hit bold and keep typing
   inside it, which is the only way a formatting button is worth having. */

const MARKS = [
  { label: 'Bold',    kind: 'wrap', mark: '**' },
  { label: 'Italic',  kind: 'wrap', mark: '*'  },
  { label: 'Heading', kind: 'lead', mark: '## ' },
  { label: 'Quote',   kind: 'lead', mark: '> '  },
];

function applyWrap(ta, mark) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const sel = v.slice(a, b);
  const m = mark.length;

  // Already wrapped, either inside the selection or just outside it — take it
  // off. Without this the button only ever adds, and a mis-tap is unfixable
  // without hunting for the asterisks by hand.
  if (sel.length > 2 * m && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(m, -m);
    ta.setRangeText(inner, a, b, 'select');
  } else if (v.slice(a - m, a) === mark && v.slice(b, b + m) === mark) {
    ta.setRangeText(sel, a - m, b + m, 'select');
  } else {
    ta.setRangeText(`${mark}${sel}${mark}`, a, b, 'select');
    // Empty selection: put the caret between the marks so typing lands inside.
    if (!sel) ta.setSelectionRange(a + m, a + m);
  }
}

function applyLead(ta, mark) {
  const { selectionStart: a, value: v } = ta;
  const start = v.lastIndexOf('\n', a - 1) + 1;
  const line = v.slice(start, v.indexOf('\n', a) === -1 ? v.length : v.indexOf('\n', a));

  if (line.startsWith(mark)) {
    ta.setRangeText('', start, start + mark.length, 'end');
    ta.setSelectionRange(a - mark.length, a - mark.length);
  } else {
    // One lead mark per line — swapping heading for quote shouldn't stack them.
    const had = MARKS.filter((x) => x.kind === 'lead').find((x) => line.startsWith(x.mark));
    const drop = had ? had.mark.length : 0;
    ta.setRangeText(mark, start, start + drop, 'end');
    ta.setSelectionRange(a + mark.length - drop, a + mark.length - drop);
  }
}

function styleRow(ta, onChange) {
  const row = el('div.styles');

  for (const m of MARKS) {
    row.append(el('button.styles__btn', {
      type: 'button',
      text: m.label,
      // The textarea must not lose the caret when the button takes the tap, or
      // there is nothing left to apply the mark to.
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        selectionTick();
        if (m.kind === 'wrap') applyWrap(ta, m.mark);
        else applyLead(ta, m.mark);
        ta.focus();
        onChange();
      },
    }));
  }

  return row;
}

/* ── The screen ─────────────────────────────────────────────────────────────
 * @param path  an existing essay to edit, or null to start a new one
 */
export function render(path, nav) {
  const existing = path ? store.get(path) : null;

  let currentPath = existing ? existing.path : null;
  let isDraft = existing ? !!existing.draft : true;
  let saveTimer = null;
  let dirty = false;

  const view = el('div.view.view--bare.view--write');

  // .body so it inherits the same top clearance under the notch and the same
  // bottom clearance under the composer that every other scroller gets.
  const wrap = el('div.body.scroller.editor');
  const title = el('input.editor__title', {
    type: 'text', placeholder: 'Title', value: existing ? (existing.title || '') : '',
    enterkeyhint: 'next', autocapitalize: 'words', spellcheck: 'true',
  });
  const bodyEl = el('textarea.editor__body', {
    placeholder: 'Begin.', spellcheck: 'true', autocapitalize: 'sentences',
  });
  const count = el('div.editor__count', { text: '' });

  // The formatting row sits directly under the title, above the body: it
  // belongs to the thing it acts on, and putting it at the bottom would have
  // put it under the composer, where the publish button already lives.
  wrap.append(title, styleRow(bodyEl, () => schedule()), bodyEl, count);
  view.append(wrap);

  view.__chrome = {
    back: true,
    main: { label: mainLabel(), onclick: onMain },
  };

  function mainLabel() {
    return isDraft ? 'Publish' : 'Done';
  }

  // Seed the body. The seeded file is fetched async; everything else is sync.
  if (existing) {
    if (existing.bodyInline) {
      bodyEl.value = toText(existing.bodyInline);
      updateCount();
    } else if (existing.body) {
      fetch(`seed/${existing.body}`)
        .then((r) => r.text())
        .then((html) => { bodyEl.value = toText(html); updateCount(); })
        .catch(() => {});
    }
  } else {
    // A new essay wants the keyboard immediately — that's the whole gesture.
    setTimeout(() => title.focus(), 350);
  }

  function updateCount() {
    const words = bodyEl.value.trim().split(/\s+/).filter(Boolean).length;
    count.textContent = words ? `${words} ${words === 1 ? 'word' : 'words'}` : '';
    grow();
  }

  /* The textarea is as tall as its own text, and the page scrolls. A textarea
     that scrolls internally fights the webview's scrolling on iOS and can
     leave the caret behind the keyboard with no way to reach it; this trades
     one reflow per keystroke — on a field of at most a few thousand
     characters — for a caret the browser can always scroll into view. */
  function grow() {
    bodyEl.style.height = 'auto';
    bodyEl.style.height = `${bodyEl.scrollHeight}px`;
  }

  function schedule() {
    dirty = true;
    updateCount();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, AUTOSAVE_MS);
  }

  /* The main pill is a live label, not a fixed one: it says Publish while the
     piece is a draft and Done once it isn't, and publishing has to be able to
     change it without a re-render. */
  function refreshMain() {
    view.__chrome.main.label = mainLabel();
    document.getElementById('composer-main').textContent = mainLabel();
  }

  /* The autosave. A piece that has never been saved is created as a draft in
     marginalia/ — it has to live at some path to be saved at all, and that's
     the folder it's most likely to end up in. Publishing may move it. */
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;

    const t = title.value.trim();
    const b = bodyEl.value.trim();

    // Nothing typed yet — don't litter the archive with an empty entry.
    if (!t && !b) return;
    dirty = false;

    const patch = { title: t || 'Untitled', bodyInline: toHTML(b) };

    if (currentPath && store.get(currentPath)) {
      // Editing a migrated essay: the inline body now wins, so drop the
      // pointer to the seed file or the reader would show the stale one.
      await store.update(currentPath, { ...patch, body: undefined });
    } else {
      const node = await store.add({
        path: `marginalia/${slugify(t) || `untitled-${Date.now().toString(36)}`}`,
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
     The one moment the app asks you a question about a piece of writing, and
     it asks the only one that matters: which of the two folders is this. The
     slug is rebuilt from the final title here rather than at first save,
     because the working title of a draft is rarely the one it ships with. */

  async function onMain() {
    await flush();

    // Already published — there is nothing to decide, so Done just shows you
    // the piece. Going back would be one tap shy of that and would land on
    // nothing at all if the editor was the first screen of the session.
    if (!isDraft) {
      if (currentPath) nav(`#/e/${encodeURIComponent(currentPath)}`, true);
      else history.back();
      return;
    }

    if (!currentPath) {
      toast('Nothing to publish yet');
      return;
    }

    const c = card('Publish to');
    for (const target of store.WRITE_TARGETS) {
      c.row(target.label, store.children(target.prefix).length, async () => {
        c.close();
        await publish(target.prefix);
      });
    }
    c.present();
  }

  async function publish(prefix) {
    const node = store.get(currentPath);
    if (!node) return;

    const slug = slugify(node.title) || currentPath.split('/').pop();
    await store.move(currentPath, `${prefix}${slug}`);
    currentPath = `${prefix}${slug}`;

    await store.update(currentPath, { draft: false, date: today() });
    isDraft = false;
    refreshMain();

    tick('Medium');
    toast('Published');
    // Replace, not push: the draft you were editing is gone as a destination,
    // and a back tap should land on the tree rather than on a dead path.
    nav(`#/e/${encodeURIComponent(currentPath)}`, true);
  }

  title.addEventListener('input', schedule);
  bodyEl.addEventListener('input', schedule);

  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); }
  });

  // Leaving by any route — back arrow, tab, app backgrounding — commits first.
  window.addEventListener('hashchange', flush, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // scrollHeight is 0 until the view is in the document, and the router mounts
  // it after this returns — so the first measure has to wait a frame.
  requestAnimationFrame(updateCount);

  return view;
}
