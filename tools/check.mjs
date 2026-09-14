#!/usr/bin/env node
/**
 * Static audit — parses the HTML file without a browser.
 *
 *   npm run check      (or: node tools/check.mjs)
 *
 * Ordinary structural checks, plus the ones that matter most for this app:
 * the ten numbered privacy claims at the top of the file are asserted against
 * the code rather than trusted.
 *
 * That block is the closest thing this tool has to a governance statement. It
 * is shown to reviewers and, in substance, to the people whose clinical detail
 * ends up in an audit. A claim that quietly stopped being true would be worse
 * than never having made it, and nothing but this check stands between a
 * convenience edit and exactly that.
 *
 * Exit code 0 = clean, 1 = at least one check failed. Lines printed NOTE are
 * known and owned, not defects.
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { APP_FILE, APP_NAME, REPO_DIR, ok, note, fail, section, summary, netlifyToml } from './lib.mjs';

const src = readFileSync(APP_FILE, 'utf8');
const toml = netlifyToml();

// Embedded fonts, logos and the document assets are ~38% of the file.
const lean = src.replace(/(data:[a-zA-Z0-9/.+-]+;base64,)[A-Za-z0-9+/=]{200,}/g, '$1X');

// Claims are asserted against code, so the comment block that states them must
// not itself be searched — otherwise the words "localStorage" in claim 5 would
// look like usage.
const code = lean.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

section(`Static audit — ${APP_NAME}`);

/* ---------------------------------------------------------------- syntax -- */
const scripts = [...src.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
const tmp = mkdtempSync(join(tmpdir(), 'audit-review-'));
let syntaxFailures = 0;
scripts.forEach((m, i) => {
  const f = join(tmp, `b${i}.js`);
  writeFileSync(f, m[1]);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    syntaxFailures++;
    fail(`script block ${i} has a syntax error`,
      String(e.stderr || e).split('\n').slice(0, 4).join('\n'));
  }
});
rmSync(tmp, { recursive: true, force: true });
ok(syntaxFailures === 0, `${scripts.length} inline script block parses`);

/* --------------------------------------------------------- comment pairs -- */
const opens = (lean.match(/<!--/g) || []).length;
const closes = (lean.match(/-->/g) || []).length;
ok(opens === closes, `${opens} HTML comment pairs balance`,
  `${opens} "<!--" vs ${closes} "-->" — an unclosed comment swallows markup to the next "-->"`);

/* ------------------------------------------------------------ html shape -- */
const markup = lean
  .replace(/<script[\s\S]*?<\/script>/g, '<script></script>')
  .replace(/<style[\s\S]*?<\/style>/g, '<style></style>');
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'line', 'polyline',
  'polygon', 'rect', 'stop', 'use', 'ellipse']);
const stack = [];
const structural = [];
const idCounts = new Map();
for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
  const [, closing, rawTag, attrs] = m;
  const tag = rawTag.toLowerCase();
  if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
  if (closing) {
    if (!stack.length) { structural.push(`stray </${tag}>`); continue; }
    if (stack[stack.length - 1] === tag) stack.pop();
    else {
      const at = stack.lastIndexOf(tag);
      if (at === -1) structural.push(`stray </${tag}>`);
      else { structural.push(`unclosed <${stack[stack.length - 1]}>`); stack.length = at; }
    }
  } else {
    stack.push(tag);
    const id = /\bid\s*=\s*"([^"]+)"/.exec(attrs);
    if (id) idCounts.set(id[1], (idCounts.get(id[1]) || 0) + 1);
  }
}
ok(structural.length === 0, 'HTML tags balance', structural.slice(0, 5).join(', '));
const dupIds = [...idCounts].filter(([, n]) => n > 1);
ok(dupIds.length === 0, `${idCounts.size} element ids, none duplicated`,
  dupIds.map(([k, n]) => `${k} x${n}`).join(', '));

/* --------------------------------------------------------------- hygiene -- */
const codeLines = lean.split('\n').filter(l => l.length < 600 && !/^\s*(\/\/|\*|<!--)/.test(l));
const countIn = re => codeLines.filter(l => re.test(l)).length;
ok(countIn(/\bconsole\.(log|debug)\s*\(/) === 0, 'no console.log / console.debug');
ok(countIn(/\bdebugger\b/) === 0, 'no debugger statements');
ok(countIn(/\bTODO\b|\bFIXME\b/) === 0, 'no TODO / FIXME markers');
ok(!/(?<![\w.])eval\s*\(|new\s+Function\s*\(/.test(code),
  'no eval() or new Function()');

/* ------------------------------------------------- privacy claims, checked -- */
// Claims 1-3: nothing leaves the machine. Every API capable of making a
// request, plus the markup ways of pulling one in.
const EGRESS = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/navigator\.sendBeacon/, 'sendBeacon'],
  [/new\s+WebSocket/, 'WebSocket'],
  [/new\s+EventSource/, 'EventSource'],
  [/import\s*\(/, 'dynamic import()'],
  [/navigator\.geolocation/, 'geolocation'],
];
const egress = EGRESS.filter(([re]) => re.test(code)).map(([, n]) => n);
ok(egress.length === 0, 'claim 1-3: no API that can reach the network is used',
  `found: ${egress.join(', ')}`);

// The XML namespace URIs in the DOCX writer are identifiers, not addresses —
// nothing is ever fetched from them. Anything else with a scheme is suspect.
const remoteRefs = [
  ...[...lean.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)/g)].map(m => `script src=${m[1]}`),
  ...[...lean.matchAll(/<link[^>]*\bhref\s*=\s*["'](https?:[^"']+)/g)].map(m => `link href=${m[1]}`),
  ...[...lean.matchAll(/<img[^>]*\bsrc\s*=\s*["'](https?:[^"']+)/g)].map(m => `img src=${m[1]}`),
  ...[...lean.matchAll(/@import\s+url\(\s*["']?(https?:[^)"']+)/g)].map(m => `@import ${m[1]}`),
];
ok(remoteRefs.length === 0, 'claim 3, 6: no external script, style, font or image is referenced',
  remoteRefs.slice(0, 5).join('\n'));

// Claims 4-5: no persistence of any kind. The words appear in the header block
// asserting their own absence, which is why `code` has comments stripped.
const PERSISTENCE = [
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/i, 'IndexedDB'],
  [/document\.cookie/, 'cookies'],
  [/navigator\.storage/, 'StorageManager'],
  [/serviceWorker\s*\.\s*register/, 'service worker'],
  [/\bcaches\b\s*\./, 'CacheStorage'],
];
const persistence = PERSISTENCE.filter(([re]) => re.test(code)).map(([, n]) => n);
ok(persistence.length === 0, 'claim 4-5: no persistence API is used — review data is memory-only',
  `found: ${persistence.join(', ')}`);

// Claim 7: the policy that makes the above enforced rather than merely true
// today. connect-src 'none' is the load-bearing directive: with it, a future
// fetch() cannot reach anywhere even if one were added.
// The policy contains single quotes ('none'), so the attribute value has to be
// matched by its own delimiter rather than "anything that is not a quote".
const meta = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(lean)?.[0] || '';
const metaCsp = (/content="([^"]*)"/i.exec(meta) || /content='([^']*)'/i.exec(meta))?.[1] || '';
ok(/default-src\s+'none'/.test(metaCsp), "claim 7: CSP meta sets default-src 'none'", metaCsp || 'no CSP meta tag found');
ok(/connect-src\s+'none'/.test(metaCsp), "claim 7: CSP meta sets connect-src 'none'",
  'without this the policy does not actually prevent egress');

// The header CSP is the stronger one — it applies before parsing, and
// frame-ancestors is ignored in a meta tag. They must not drift apart.
if (toml) {
  const headerCsp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1] || '';
  ok(/default-src 'none'/.test(headerCsp) && /connect-src 'none'/.test(headerCsp),
    'netlify.toml sends the same restrictive policy as a header',
    headerCsp || 'no Content-Security-Policy header in netlify.toml');
  ok(/frame-ancestors\s+'none'/.test(headerCsp),
    "netlify.toml adds frame-ancestors 'none' (ignored in a meta tag)",
    'the tool could be framed by another site');

  const directives = d => Object.fromEntries(d.split(';').map(x => x.trim()).filter(Boolean)
    .map(x => [x.split(/\s+/)[0], x.split(/\s+/).slice(1).join(' ')]));
  const m1 = directives(metaCsp), m2 = directives(headerCsp);
  const drift = Object.keys(m1).filter(k => m2[k] !== undefined && m1[k] !== m2[k]);
  ok(drift.length === 0, 'meta and header policies agree where they overlap',
    drift.map(k => `${k}: meta "${m1[k]}" vs header "${m2[k]}"`).join('\n'));

  // The file keeps its human-readable name so the same file can be handed out
  // for offline use, so the site root is a rewrite. Rename the file without
  // updating this and the root 404s while the direct link still works.
  const targets = [...toml.matchAll(/to\s*=\s*"\/([^"]+\.html)"/g)]
    .map(m => decodeURIComponent(m[1]));
  const stale = [...new Set(targets)].filter(t => t !== APP_NAME);
  ok(targets.length > 0 && stale.length === 0,
    `netlify.toml rewrites point at ${APP_NAME}`,
    targets.length === 0 ? 'no rewrite found — the site root will 404'
      : `stale: ${stale.join(', ')}`);
} else {
  fail('netlify.toml present', 'not found — headers and the root rewrite are missing');
}

/* -------------------------------------------------------- browser floor -- */
// structuredClone is called during init, and is Safari 15.4 / Chrome 98 /
// Firefox 94 — all early 2022. Without a guard the script throws before the app
// exists, so an older device gets a blank page rather than a degraded one.
//
// The fallback is a JSON round-trip, which is exact for everything this app
// clones: audit objects, the time breakdown, and images held as
// {id, dataUrl, width, height, type, name, caption} where dataUrl is a base64
// string. Nothing here is a Blob, Date, Map or Set. If that ever stops being
// true the guard becomes a silent corruption rather than a safety net, which is
// why the check names the assumption rather than just checking the guard exists.
const usesStructuredClone = /structuredClone\s*\(/.test(code);
const guarded = /typeof structuredClone\s*!==\s*'function'/.test(code);
ok(!usesStructuredClone || guarded,
  'structuredClone has a fallback for pre-2022 browsers',
  'structuredClone() is called during init with no guard — on Safari < 15.4 the app does not start at all');

const clonesBlob = /structuredClone\s*\(\s*[^)]*\b(?:blob|file|Map|Set|new Date)\b/i.test(code);
ok(!clonesBlob, 'nothing cloned needs more than a JSON round-trip',
  'a Blob, File, Map, Set or Date appears to be cloned — the JSON fallback would corrupt it silently');

/* ------------------------------------------------------- export identity -- */
// A saved audit JSON already carries applicationVersion via
// createAuditEnvelope(). The DOCX is the artefact that actually gets filed and
// read months later, so it carries the same version in its document
// properties — otherwise a report cannot be traced to the build that made it.
ok(/applicationVersion\s*:\s*APP_CONFIG\.version/.test(code),
  'saved audit JSON records the application version');
ok(/<Application>[^<]*\$\{APP_CONFIG\.version\}[^<]*<\/Application>/.test(code),
  'exported DOCX records the application version in docProps',
  'the DOCX carries no version — an exported report cannot be traced to a build');

/* --------------------------------------------------------- product name -- */
// APP_CONFIG.productName is the single source of truth for what this tool is
// called. The DOCX metadata used to hardcode "Air Desk Review Builder", so
// every exported report carried a name that appeared nowhere else in the repo
// -- and pointed at the Air Desk line rather than the Clinical Hub line it
// belongs to. Report provenance leaves the building; it has to be right.
const productName = /productName\s*:\s*'([^']+)'/.exec(src)?.[1];
ok(!!productName, `APP_CONFIG.productName declared (${productName || 'absent'})`);

const docPropsFields = [
  [/<dc:creator>([^<]*)<\/dc:creator>/, 'dc:creator'],
  [/<cp:lastModifiedBy>([^<]*)<\/cp:lastModifiedBy>/, 'cp:lastModifiedBy'],
  [/<Application>([^<]*)<\/Application>/, 'Application'],
];
const hardcoded = docPropsFields.filter(([re_, label]) => {
  const v = re_.exec(src)?.[1] ?? '';
  return v.length > 0 && !v.includes('APP_CONFIG.productName');
}).map(f => f[1]);
ok(hardcoded.length === 0,
  `DOCX docProps read the product name from APP_CONFIG (${docPropsFields.length} fields)`,
  `hardcoded name in: ${hardcoded.join(', ')}`);

// Retired names. "Air Desk Review Builder" was a second product name hardcoded
// into the DOCX metadata; "Clinical Hub Audit Review" was the name until
// 2026-09-14, dropped because the tool reviews single incidents rather than
// running clinical audits, and because it will cover Secondary Triage as well
// as Air Desk. Both stay banned so neither creeps back through a copied block.
const retiredNames = ['Air Desk Review Builder', 'Clinical Hub Audit Review', 'Clinical-Hub-Audit'];
const revived = retiredNames.filter(name => src.includes(name));
ok(revived.length === 0,
  `no retired product name remains (${retiredNames.length} banned)`,
  `found: ${revived.join(', ')}`);

// The file was renamed on 2026-09-14 while the tool was already deployed. A
// direct link to the old filename must not 404, and /audit must keep working
// for anyone who bookmarked it. Both are one line in netlify.toml and both are
// invisible failures — the bookmark holder just sees a dead tool.
const legacyRoutes = [
  [/from\s*=\s*"\/Clinical%20Hub%20Audit%20Review\.html"/, 'the old filename redirects instead of 404ing'],
  [/from\s*=\s*"\/audit"/, '/audit still resolves for existing bookmarks'],
];
const brokenRoutes = legacyRoutes.filter(([re_]) => !re_.test(toml || '')).map(r => r[1]);
ok(brokenRoutes.length === 0,
  `netlify.toml keeps both pre-rename routes alive (${legacyRoutes.length} checked)`,
  `missing: ${brokenRoutes.join('; ')}`);

/* ------------------------------------------------------ csp resource types -- */
// default-src is 'none', so ANY resource type not given its own directive is
// blocked outright — and a blocked resource fails silently in the UI. This app
// is the strictest of the three, which makes it the one where adding a feature
// quietly breaks it. Each entry is "if the app starts doing X, the policy must
// allow it first".
const cspPolicy = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml || '')?.[1] || '';
const cspAllows = d => {
  const m = new RegExp('(?:^|;)\\s*' + d + '\\s+([^;]*)').exec(cspPolicy);
  return !!m && !/'none'/.test(m[1]);
};
const cspUses = [
  [/<form\b/i, 'form-action', 'a <form> appeared'],
  [/<iframe\b/i, 'frame-src', 'an <iframe> appeared'],
  [/<(?:audio|video)\b|new Audio\s*\(/i, 'media-src', 'audio or video appeared'],
  [/<(?:embed|object)\b/i, 'object-src', 'an <embed> or <object> appeared'],
  [/<base\s/i, 'base-uri', 'a <base> tag appeared'],
  [/rel="?manifest/i, 'manifest-src', 'a manifest link appeared'],
  [/new (?:Shared)?Worker\s*\(/, 'worker-src', 'a Worker appeared'],
  [/\bfetch\s*\(|XMLHttpRequest/, 'connect-src', 'a network call appeared — this tool is meant to be fully offline'],
];
const cspBlocked = cspUses.filter(([re_, dir]) => re_.test(src) && !cspAllows(dir));
ok(cspBlocked.length === 0,
  `CSP permits every resource type the app uses (${cspUses.length} checked)`,
  cspBlocked.map(c => `${c[2]}; ${c[1]} does not allow it`).join('; '));

/* ------------------------------------------------------- version display -- */
// APP_CONFIG.version is what the saved JSON and the DOCX docProps record. The
// header label is written from it at boot; the <title> still holds a literal,
// so that one is checked here. A stale label means a report claims a build that
// never produced it — and nothing on screen would say so.
const cfgVersion = /version:\s*'([\d.]+)'/.exec(src)?.[1];
const titleVersion = /<title>[^<]*?v([\d.]+)[^<]*<\/title>/i.exec(src)?.[1];
ok(cfgVersion && titleVersion === cfgVersion,
  `<title> version matches APP_CONFIG.version (${cfgVersion || '?'})`,
  `title says ${titleVersion || 'nothing'}, APP_CONFIG says ${cfgVersion || 'nothing'}`);

// The header subtitle carried the workflow name until 2026-09-14. It duplicated
// the Report Type dropdown and would have gone stale the moment Secondary
// Triage was added, labelling a Secondary Triage review as an Air Desk one.
ok(/id="buildVersion"><\/small>/.test(src),
  'header version label is empty in markup and written from APP_CONFIG',
  'a hand-typed version or workflow name is back in the header');

/* ------------------------------------------------------- deploy readiness -- */
ok(!existsSync(join(REPO_DIR, 'clinical-hub-incident-review.zip')),
  'repo is the extracted app, not a zip upload',
  'Netlify would publish the archive instead of the HTML file');

const pasteSelector = /PROSE_PASTE_SELECTOR='([^']+)'/.exec(src)?.[1] || '';
const pasteIds = [...pasteSelector.matchAll(/#([A-Za-z][\w-]*)/g)].map(m => m[1]);
const missingPaste = pasteIds.filter(id => !idCounts.has(id));
ok(pasteIds.length > 0 && missingPaste.length === 0,
  `paste normaliser targets real element ids (${pasteIds.length})`,
  missingPaste.length ? `missing: ${missingPaste.join(', ')}` : 'PROSE_PASTE_SELECTOR not found');

if (toml) {
  ok(/pretty_urls\s*=\s*false/.test(toml),
    'netlify.toml disables Pretty URLs for the named HTML file');
  ok(/NODE_VERSION\s*=\s*"20"/.test(toml),
    'netlify.toml pins Node 20 for the deploy check');
  ok(/cp .*Clinical Hub Incident Review\.html.*index\.html/.test(toml),
    'Netlify build copies the app to index.html so / is served natively');
}

let netlifyIgnore = '';
try { netlifyIgnore = readFileSync(join(REPO_DIR, '.netlifyignore'), 'utf8'); } catch { netlifyIgnore = ''; }
ok(!!netlifyIgnore, '.netlifyignore present',
  'without it the check suite and docs would be published on the clinical site');
const ignoredLines = netlifyIgnore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
ok(!ignoredLines.includes(APP_NAME) && !ignoredLines.includes('robots.txt') && !ignoredLines.includes('index.html'),
  '.netlifyignore does not exclude the app, robots.txt or index.html',
  ignoredLines.join(', '));

process.exit(summary());
