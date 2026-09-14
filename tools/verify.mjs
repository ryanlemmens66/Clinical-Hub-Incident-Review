#!/usr/bin/env node
/**
 * Runtime verification — boots the app in a DOM and watches what it touches.
 *
 *   npm run verify      (or: node tools/verify.mjs)
 *
 * tools/check.mjs proves the code contains no persistence or egress API. This
 * proves the running app touches neither: storage and network are replaced
 * with traps that record any access, and the app is booted and driven with
 * them in place. A claim asserted against source and again against behaviour
 * is a much harder thing to break by accident.
 *
 * jsdom, not a real browser — no Chromium download, runs anywhere Node runs,
 * at the cost of seeing nothing visual. Layout, the DOCX opening correctly in
 * Word, and print output all still need checking by hand.
 *
 * Exit code 0 = clean, 1 = at least one check failed.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { APP_FILE, APP_NAME, ok, section, summary } from './lib.mjs';

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(String(e && e.message || e)));
virtualConsole.on('error', (...args) => errors.push(args.join(' ')));

section(`Runtime verification — ${APP_NAME}`);

const dom = new JSDOM(readFileSync(APP_FILE, 'utf8'), {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://local.test/',
  virtualConsole,
});

const win = dom.window;

// jsdom does not expose structuredClone on the window, though every browser
// from early 2022 does. Without this the app's own init throws and we would be
// testing a broken environment rather than the app.
if (typeof win.structuredClone !== 'function') {
  win.structuredClone = obj => JSON.parse(JSON.stringify(obj));
}

/* ------------------------------------------------------------- the traps -- */
// Anything the app reaches for that could persist or transmit is recorded
// rather than allowed. Nothing here throws: a trap that throws would abort the
// app and the rest of the run would prove nothing.
const touched = [];
const trap = name => new Proxy({}, {
  get(_, prop) {
    if (typeof prop === 'string' && prop !== 'then') touched.push(`${name}.${String(prop)}`);
    return () => undefined;
  },
  set(_, prop) { touched.push(`${name}.${String(prop)} =`); return true; },
});

for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
  try {
    Object.defineProperty(win, name, { configurable: true, get() { touched.push(name); return trap(name); } });
  } catch { /* jsdom may refuse some redefinitions; the static check still covers it */ }
}
// A rejected promise here would surface as an unhandled rejection and kill the
// run before it could report what it caught. Never settling records the call
// and lets the rest of the checks finish.
win.fetch = (...a) => { touched.push(`fetch(${String(a[0]).slice(0, 60)})`); return new Promise(() => {}); };
win.XMLHttpRequest = function () { touched.push('XMLHttpRequest'); return { open() {}, send() {}, setRequestHeader() {} }; };
win.WebSocket = function (u) { touched.push(`WebSocket(${u})`); };
win.EventSource = function (u) { touched.push(`EventSource(${u})`); };
if (win.navigator) {
  try { win.navigator.sendBeacon = (u) => { touched.push(`sendBeacon(${u})`); return false; }; } catch { /* readonly */ }
}

// Cookies are a plain accessor, so they are checked by value afterwards
// rather than trapped.
const cookiesBefore = win.document.cookie;

/* ---------------------------------------------------------------- boot -- */
// The document was parsed with scripts off so the traps could be installed
// first; run them now.
const scripts = [...win.document.querySelectorAll('script:not([src])')];
let booted = true;
for (const el of scripts) {
  try { win.eval(el.textContent); } catch (e) { booted = false; errors.push('script threw: ' + e.message); }
}
win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
win.dispatchEvent(new win.Event('load'));
await new Promise(r => setTimeout(r, 1500));

const doc = win.document;

ok(booted, `app script runs without throwing (${scripts.length} block)`,
  errors.slice(0, 4).join('\n'));

/* --------------------------------------------------------------- render -- */
ok(doc.querySelectorAll('.card[id]').length > 0,
  `editor cards rendered (${doc.querySelectorAll('.card[id]').length})`);
ok(doc.querySelectorAll('section, fieldset').length > 0, 'document sections present');
ok(!!doc.querySelector('button, input, textarea'), 'form controls present');

/* --------------------------------------------- the claims, as behaviour -- */
const storageTouched = touched.filter(t => /^(localStorage|sessionStorage|indexedDB|caches)/.test(t));
ok(storageTouched.length === 0,
  'claim 4-5: nothing was written to or read from browser storage at runtime',
  [...new Set(storageTouched)].join(', '));

const networkTouched = touched.filter(t => /^(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)/.test(t));
ok(networkTouched.length === 0,
  'claim 1-3: no network call was attempted at runtime',
  [...new Set(networkTouched)].join(', '));

ok(doc.cookie === cookiesBefore, 'claim 5: no cookie was set',
  `cookie changed to: ${doc.cookie}`);

ok(!('serviceWorker' in win.navigator) || !win.navigator.serviceWorker.controller,
  'claim 5: no service worker took control');

/* -------------------------------------------------------------- console -- */
ok(errors.length === 0, 'no errors during boot',
  errors.slice(0, 6).map(e => e.slice(0, 180)).join('\n'));

console.log('\n  Note: jsdom sees no layout, and cannot open a DOCX. Word export fidelity,');
console.log('  print output and anything visual still need checking by hand.');

dom.window.close();
process.exit(summary());
