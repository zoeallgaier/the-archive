/* ═══════════════════════════════════════════════════════════════════════════
   GATE — the one thing standing between the URL and the archive.

   A DETERRENT, NOT A LOCK. This is a static site behind no server — GitHub
   Pages hands out every file in the repo to anyone who asks for it by name,
   gate or no gate. What this screen buys is real: the archive stops showing
   up to search engines, to a stranger who finds the link, to anyone glancing
   at the phone over your shoulder. What it does NOT buy is protection from
   someone who opens the browser's dev tools or fetches seed/index.json
   directly — there is no way to build that without a server, and a server is
   the one thing this app has deliberately never had. See CLAUDE.md.

   RUNS BEFORE ANYTHING ELSE. app.js awaits ensure() before its first call to
   store.load()/render(), so no node, photo or essay is ever pulled into the
   page while this is up — there's nothing behind the screen to leak, not
   just a screen in front of it. The composer is marked inert for the same
   reason from the other direction: its buttons exist in the DOM from the
   moment index.html parses, so `inert` is what stops a tab-and-Enter reaching
   Delete or ＋ before a password has been typed, the way an opaque div only
   stops a finger. */

import { el } from './ui.js';
import { readGate, writeGate } from './platform.js';

/* SHA-256 of the password, not the password — so this file doesn't hand it
   over to anyone reading the repo on GitHub. It's still a bare hash with
   nothing rate-limiting the guesses against it, which is the real ceiling on
   what "password" can mean on a site with no backend: fine against a glance,
   not against someone determined. Pick accordingly.

   TO CHANGE IT: run this in any browser console, on this site or off it —

     crypto.subtle.digest('SHA-256', new TextEncoder().encode('new password'))
       .then(b => console.log([...new Uint8Array(b)]
         .map(x => x.toString(16).padStart(2, '0')).join('')))

   and paste the hex string it prints in below. */
const HASH = '29991fa20e87583042ea082d2005ffd7778d904d5a967381839e1f6e7bffe232';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Resolves once the password has been entered — immediately, if this
    browser already answered it correctly once before. */
export function ensure() {
  if (readGate()) return Promise.resolve();

  return new Promise((resolve) => {
    const composer = document.getElementById('composer');
    const mount = document.getElementById('view');
    composer?.setAttribute('inert', '');
    mount?.setAttribute('inert', '');

    const field = el('input.card__field', {
      type: 'password',
      placeholder: 'Password',
      autocomplete: 'current-password',
      autocorrect: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      enterkeyhint: 'go',
    });
    const go = el('button.card__go', { type: 'button', text: 'Enter' });
    const panel = el('div.card__panel.gate__panel', {}, field, go);
    const gate = el('div.gate', {}, panel);

    async function submit() {
      const guess = field.value;
      if (!guess) return;
      if (await sha256Hex(guess) === HASH) {
        writeGate();
        composer?.removeAttribute('inert');
        mount?.removeAttribute('inert');
        gate.remove();
        resolve();
        return;
      }
      field.value = '';
      // Restart the animation even on a second wrong guess in a row.
      panel.classList.remove('gate__panel--wrong');
      void panel.offsetWidth;
      panel.classList.add('gate__panel--wrong');
      field.focus();
    }

    go.addEventListener('click', submit);
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    document.body.append(gate);
    field.focus();
  });
}
