#!/usr/bin/env node
/**
 * DOM sweep gate: once a network is selected in a signet session, NO regtest
 * artifact may appear anywhere in the UI (text, placeholders, tooltips, link
 * hrefs, metadata, or the tab title). Any occurrence is a violation.
 *
 * Also captures the request stream and fails on any regtest-targeted request
 * (regtest host, `/rpc`, root `/health` or `/tachi_*` paths), and refuses
 * hollow passes (the journey must actually exercise the signet flows).
 *
 * Usage (requires a running headless Chrome with CDP on 127.0.0.1:9222 and a
 * deployed or previewed build):
 *   node scripts/dom-sweep.mjs https://ripcord-signet.vercel.app
 *
 * Exit 0 = every screen clean + zero regtest requests + journey exercised.
 * Exit 1 = a violation was found (each is printed with its context).
 */
const CDP = 'http://127.0.0.1:9222';
const BASE = process.argv[2] ?? 'https://ripcord-signet.vercel.app';
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('no browser page on', CDP); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const pending = new Map();
const events = new Map();
const requests = [];
ws.onmessage = (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method) {
    if (d.method === 'Page.javascriptDialogOpening') { void send('Page.handleJavaScriptDialog', { accept: true }); return; }
    if (d.method === 'Network.requestWillBeSent') requests.push(d.params.request.url);
    const w = events.get(d.method); if (w) { w(d.params); events.delete(d.method); }
  }
};
let msgId = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++msgId; pending.set(id, (d) => resolve(d.result || d.error)); ws.send(JSON.stringify({ id, method, params })); });
const onEvent = (name) => new Promise((resolve) => events.set(name, resolve));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result ? r.result.value : `ERR ${r.message || ''}`;
};
const sweep = () => evaluate(`(() => {
  const all = [document.title || ''];
  if (document.body) all.push(document.body.innerText || '');
  for (const el of document.querySelectorAll('*')) for (const a of el.attributes || []) all.push(a.value || '');
  return all.join(' \\\\n ');
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
// Deterministic empty device: clear the origin's storage (IndexedDB included)
// BEFORE the journey so the gate never depends on surviving a lock screen.
const origin = new URL(BASE).origin;
await send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
const loaded = onEvent('Page.loadEventFired');
await send('Page.navigate', { url: `${BASE}/app.html` });
await loaded;
await sleep(2500);

// clean profile via the app's own escape hatch if a vault exists
await evaluate(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => /start over/i.test(b.textContent));
  if (btn) { btn.click(); await new Promise(r => setTimeout(r, 600));
    for (let i = 0; i < 2; i++) { const c = [...document.querySelectorAll('button')].find(b => /^(wipe|start over|confirm|erase)/i.test(b.textContent.trim()) && !b.disabled); if (c) c.click(); await new Promise(r => setTimeout(r, 500)); } }
  return 'ok';
})()`);
await sleep(1200);

const sweepAfter = async (label) => {
  const body = await sweep();
  const hits = (body.match(/regtest|bcrt1/gi) || []).length;
  if (hits > 0) {
    failures++;
    console.log(`VIOLATION at ${label}:`, JSON.stringify((body.match(/.{0,40}(regtest|bcrt1).{0,40}/gi) || []).slice(0, 3)));
  } else {
    console.log(`clean sweep at ${label}`);
  }
};

// Retry-resilient click: waits for the target button to appear (fresh-profile
// boots render the shell first) and refuses hidden duplicate matches.
const clickWhen = async (findExpr, label, tries = 25) => {
  for (let i = 0; i < tries; i++) {
    const res = await evaluate(`(() => { ${findExpr} })()`);
    if (typeof res === 'string' && res.startsWith('clicked')) return true;
    await sleep(1000);
  }
  console.log(`WARN: ${label} never clicked`);
  return false;
};

// selection screen legitimately describes BOTH networks - sweep starts after
// the choice. Visible, last-match button only.
const chosen = await clickWhen(
  `const bs = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Use Tachi Signet' && !b.disabled && b.offsetParent !== null); if (bs.length === 0) return 'no'; bs[bs.length - 1].click(); return 'clicked';`,
  'network selection', 30,
);
if (!chosen) { failures++; console.log('FAIL: network selection did not start'); }
await sleep(1500);
await sweepAfter('post-selection');

// create a signet wallet (generate -> backup check -> create)
const genOk = await clickWhen(
  `const b = [...document.querySelectorAll('button')].find(b => /generate a new recovery phrase/i.test(b.textContent) && !b.disabled && b.offsetParent !== null); if (!b) return 'no'; b.click(); return 'clicked';`,
  'generate phrase', 25,
);
if (!genOk) {
  console.log('BUTTONS AT GENERATE FAIL:', await evaluate(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 40) + (b.offsetParent ? '' : ' [hidden]') + (b.disabled ? ' [disabled]' : '')))`));
}
await sleep(1200);
// Round 7B-1/7B-2: the extraction is REGEX-FREE (no backslash escapes to get
// wrong across the template-literal boundary) and the verification counts what
// actually landed in the challenge inputs - not the displayed text (the old
// diagnostic printed a false green while the fill was a page-level syntax
// error). Page code contains no backslashes at all: charCode checks and
// String.fromCharCode(10) instead of \d / \n / \b.
const fillStatus = await evaluate(`(() => {
  const txt = document.body.innerText;
  const tokens = txt.split(String.fromCharCode(10)).join(' ').split(' ');
  const words = {};
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i].trim();
    if (t.length === 2 && t[0] >= '0' && t[0] <= '9' && t[1] >= '0' && t[1] <= '9') {
      const n = parseInt(t, 10);
      const w = (tokens[i + 1] || '').trim();
      if (n >= 1 && n <= 12 && w.length >= 3 && /^[a-z]+$/.test(w)) words[n] = w;
    }
  }
  const extracted = Object.keys(words).length;
  let filled = 0;
  for (const el of document.querySelectorAll('input')) {
    const label = (el.closest('label')?.innerText || el.getAttribute('aria-label') || '').trim();
    if (label.indexOf('WORD #') !== 0) continue;
    const n = parseInt(label.slice(6), 10);
    if (!words[n]) continue;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, words[n]);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled++;
  }
  return 'extracted:' + extracted + ' filled:' + filled;
})()`);
console.log('backup fill:', fillStatus);
if (typeof fillStatus !== 'string' || !/^extracted:1[0-2] filled:[1-9][0-9]*$/.test(fillStatus)) {
  failures++;
  console.log('FAIL: backup-word fill did not populate the challenge inputs (', fillStatus, ')');
} else {
  await sleep(600);
}
await clickWhen(
  `const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Create identity') && !b.disabled && b.offsetParent !== null); if (!b) return 'no'; b.click(); return 'clicked';`,
  'create identity', 25,
);
let reachedFunding = false;
for (let i = 0; i < 75; i++) { await sleep(2000); const b = await evaluate('document.body.innerText'); if (/tb1[qpx]/i.test(b)) { reachedFunding = true; break; } }
await sweepAfter('funding screen');

// every bottom-nav page + send/receive surfaces
for (const tab of ['Wallet', 'Exit', 'Proofs', 'Activity']) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('button, a, [role=tab]')].find(b => b.textContent.trim() === ${JSON.stringify(tab)}); if (b) b.click(); return 'ok'; })()`);
  await sleep(1500);
  await sweepAfter(tab);
}
await evaluate(`(() => { const b = [...document.querySelectorAll('button, a, [role=tab]')].find(b => b.textContent.trim() === 'Wallet'); if (b) b.click(); return 'ok'; })()`);
await sleep(1000);
for (const label of ['Send VTXO', 'Receive', 'Ripcord Exit']) {
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}) && !b.disabled); if (b) { b.click(); return 'clicked'; } return 'not-found'; })()`);
  await sleep(1500);
  if (clicked === 'clicked') await sweepAfter(label);
}
await sleep(5000);

// request-stream independence
const flagged = requests.filter((u) => {
  let path = u; let host = '';
  try { const parsed = new URL(u); path = parsed.pathname + parsed.search; host = parsed.host; } catch {}
  return /regtest|bcrt1/i.test(u) || host.includes('rpc-regtest')
    || path === '/rpc' || path.startsWith('/rpc?') || path.startsWith('/rpc/')
    || path === '/health' || path.startsWith('/health?') || path.startsWith('/tachi_');
});
const paths = [...new Set(requests.map((u) => { try { return new URL(u).pathname; } catch { return ''; } }).filter(Boolean))];
const signetCalls = paths.filter((p) => p.startsWith('/signet/')).length;
if (flagged.length) { failures++; console.log('REGTEST REQUESTS:', flagged); }
if (!reachedFunding || signetCalls < 3) { failures++; console.log('WARN: journey not exercised (funding:', reachedFunding, 'signet calls:', signetCalls, ')'); }

console.log(failures === 0 ? 'GATE: PASS - every screen clean, zero regtest requests, journey exercised' : `GATE: FAIL (${failures} violation group(s))`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
