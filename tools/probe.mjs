/* Drive headless Chrome over the DevTools protocol: load a route, collect
   console errors and failed requests, then run an expression in the page.

   Dev tool only — never shipped. Usage:
     node tools/probe.mjs <url> ["<js expression>"]
*/

const [, , url = 'http://localhost:8777/', expr = 'null'] = process.argv;
const PORT = 9333;

const { spawn } = await import('node:child_process');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--no-sandbox', '--mute-audio',
  `--remote-debugging-port=${PORT}`,
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome did not come up');
}

const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
const errors = [];
const failed = [];
const logs = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ` +
      msg.params.args.map((a) => a.description || a.value).join(' '));
  }
  if (msg.method === 'Network.loadingFailed') {
    failed.push(msg.params.errorText);
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    failed.push(`${msg.params.response.status} ${msg.params.response.url}`);
  }
};

const send = (method, params = {}) => new Promise((resolve) => {
  const msgId = ++id;
  pending.set(msgId, resolve);
  ws.send(JSON.stringify({ id: msgId, method, params }));
});

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');

// iPhone 15 Pro logical viewport, so what we measure and shoot is what the
// phone actually renders — not a desktop window that happens to be narrow.
await send('Emulation.setDeviceMetricsOverride', {
  width: 393, height: 852, deviceScaleFactor: 3, mobile: true,
});

// SCHEME=light|dark to see the other palette without touching the machine's
// own appearance setting.
if (process.env.SCHEME) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: process.env.SCHEME }],
  });
}

await send('Page.navigate', { url });
await sleep(3500);

if (process.env.SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'));
}

// Async IIFE so probe expressions can await — dynamic imports, store.load(),
// anything. The whole thing resolves to a JSON string.
const out = await send('Runtime.evaluate', {
  expression:
    `(async () => JSON.stringify(await (async () => { ` +
    `${expr.includes('return') ? expr : `return ${expr}`} })()))()`,
  returnByValue: true,
  awaitPromise: true,
});

// SHOT captures the route as it loads; SHOT_AFTER captures it once the
// expression has finished driving it, which is the only way to see a state you
// had to tap your way into.
if (process.env.SHOT_AFTER) {
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SHOT_AFTER, Buffer.from(shot.data, 'base64'));
}

console.log('── errors ──');
console.log(errors.length ? errors.join('\n') : '  none');
console.log('── console ──');
console.log(logs.length ? logs.slice(0, 12).join('\n') : '  none');
console.log('── failed requests ──');
console.log(failed.length ? [...new Set(failed)].slice(0, 12).join('\n') : '  none');
console.log('── result ──');
const v = out?.result?.value;
try { console.log(JSON.stringify(JSON.parse(v), null, 1)); } catch { console.log(v); }

ws.close();
chrome.kill();
process.exit(0);
