# Clinical Hub Incident Review

A single-file tool for compiling incident review reports — referral pathway,
timeline, ANTS breakdown, findings, recommendations — with Word (DOCX) export.
`APP_CONFIG.productName` is the single source of truth for the name.

**Renamed 2026-09-14**, from *Clinical Hub Audit Review*. Clinical audit means
measuring practice against a standard across a sample and re-measuring; this
tool reviews one incident at a time, so *Incident Review* is what it actually
does — and *Audit Review* stacked two near-synonyms. A second name, *Air Desk
Review Builder*, was hardcoded into the DOCX metadata and retired the same day.
All three retired strings are banned by a check so none can creep back in
through a copied block.

Reports exported before the rename carry the old name in their Word properties.
That is expected — it records what produced them.

The workflow label was removed from the header and `<title>` on 2026-09-14 — it
duplicated the Report Type dropdown and would have labelled a Secondary Triage
review as an Air Desk one the moment that workflow was added. The only place the
workflow now appears is the Report Type options, where the user selects it, and
`ACTIVE_WORKFLOW.name`, which names the exported DOCX. Both are correct as-is;
the Report Type options gain entries when Secondary Triage lands.

The header version is written from `APP_CONFIG.version` at boot rather than typed
into the markup, so it cannot drift from the version the saved JSON and the DOCX
docProps record. The `<title>` still holds a literal and is checked against the
constant.

> **Status:** an operational tool, deployed on Netlify for the Clinical Hub
> desk. The privacy statement at the top of the HTML sets out what it does and
> does not do with review data, and closes by saying plainly that those are
> design intentions rather than formal accreditation or organisational
> approval. That framing is correct and should not be quietly upgraded.

## What's in the repo

| File | Purpose |
|---|---|
| `Clinical Hub Incident Review.html` | The entire application — markup, styles, scripts, fonts, logos and the DOCX writer, all inlined. This is the deliverable. |
| `netlify.toml` | Deployment config: root rewrite, CSP and security headers, cache policy, Node 20, and a copy to `index.html`. |
| `.netlifyignore` | Keeps the published site to the app, `index.html` and `robots.txt`. |
| `robots.txt` | `Disallow: /` — keeps a clinical tool out of search indexes. |
| `ARCHITECTURE.md` | How the file is put together. Read before editing. |
| `NOTICE.md` | Copyright status. |
| `tools/check.mjs` | Static check — reads the file, and asserts the privacy claims. |
| `tools/verify.mjs` | Runtime check — boots the app with storage and network trapped. |
| `tools/lib.mjs` | Shared helpers. |

No framework build. `npm install` is needed only for `verify`. Netlify copies
the named HTML file to `index.html` after the structural check so `/` works
even if a rewrite is skipped.

## The design, in one line

**Nothing leaves the browser and nothing is stored.** Review data lives in
memory for as long as the page is open. The only things written to the device
are the ones the user explicitly asks for: a saved audit JSON, or a generated
DOCX.

The file keeps its human-readable name so the same file can be handed out for
offline use. The site root is still rewritten to that file, and Netlify also
gets an `index.html` copy at deploy time so `/` cannot 404 if a rewrite is
missed. That copy is generated, not edited.

## Deployment

Netlify. Connect this GitHub repo (not the zip). `netlify.toml` supplies the
publish directory, a one-second structural check, Node 20, and the root rewrite.
There is no framework build. At deploy time the named HTML file is also copied
to `index.html` so `/` is served natively as well as via rewrite.

Do not upload `clinical-hub-incident-review.zip` as the site — Netlify would
publish the archive, not the app. Upload the extracted folder, or connect the
repo.

Three things in it are load-bearing:

- **The root rewrite.** `status = 200`, not a 301, so the address bar stays on
  `/` and the file is returned directly. Rename the file without updating both
  rewrites and the root 404s while the direct link still works — invisible to
  whoever just deployed, broken for everyone with a bookmark. `check` asserts
  it.
- **The CSP header.** The app already ships the same policy as a `<meta>` tag,
  but the header version applies before the document is parsed, and
  `frame-ancestors` is **only** honoured as a header — it is ignored in a meta
  tag. That directive is what actually stops the tool being framed by another
  site. `check` asserts the header carries it, and that the two policies do not
  drift apart where they overlap.
- **`connect-src 'none'`.** This is the directive that turns "the app does not
  make network calls" into "the app cannot". `script-src` and `style-src` keep
  `'unsafe-inline'` because this is deliberately a single file with inline
  script and style — that is constrained by `default-src 'none'` and
  `connect-src 'none'`, so no external code can load and no data can go
  anywhere.

## Checks

```bash
npm install      # once, for jsdom
npm run check    # ~1s, no dependencies — reads the file
npm run verify   # boots the file with storage and network trapped
npm test         # both
```

### Automated

`.github/workflows/checks.yml` runs the suite on every push and pull request.
`netlify.toml` also gates the deploy itself on the structural check, which is
the only one of the two that actually blocks a bad build from publishing — a
red tick on GitHub does not stop Netlify.

Neither fires on a drag-and-drop upload. Nothing does. If you deploy that way,
run `npm test` first.

Exit code 0 clean, 1 on failure. Lines printed **NOTE** are known and owned.

### The privacy claims are checked, not trusted

The ten numbered claims at the top of the HTML are the closest thing this tool
has to a governance statement. They are shown to reviewers and, in substance,
to the people whose clinical detail ends up in an audit. A claim that quietly
stopped being true would be worse than never having made it.

So both checks assert them, from two directions:

| Claim | `check` (source) | `verify` (behaviour) |
|---|---|---|
| 1–3 · offline, no transmission, no analytics or external APIs | No `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, dynamic `import()` or geolocation anywhere in the code | `fetch` and friends are replaced with traps and the app is booted — no call is attempted |
| 3, 6 · assets embedded | No external `<script src>`, `<link href="http…">`, `<img src="http…">` or CSS `@import` | — |
| 4–5 · memory only, no storage | No `localStorage`, `sessionStorage`, `IndexedDB`, `document.cookie`, StorageManager, service worker or CacheStorage | Storage objects are replaced with recording proxies — nothing is read or written; the cookie string is unchanged; no worker takes control |
| 7 · restrictive CSP | `default-src 'none'` and `connect-src 'none'` in the meta tag, matched by the header, with `frame-ancestors 'none'` added there | — |

The comment block that states the claims is stripped before the source is
searched — otherwise the word "localStorage" in claim 5 would read as usage.

A regression test for this is one line: add a `localStorage.setItem` and a
`fetch` and both layers fail, naming each.

### What else `check` guards

Script syntax, HTML comment-pair balance, tag balance, 67 element ids with no
duplicates, no `console.log` / `debugger` / TODO markers, no `eval` or
`new Function`, and the netlify.toml rewrite target.

### What `verify` guards

That the app's single script block runs without throwing, the eight editor
cards render, sections and form controls are present, and the claims above hold
as behaviour rather than only as source.

### What neither can see

Layout, and whether an exported DOCX opens correctly in Word. jsdom has no
rendering and cannot read a `.docx`. Export fidelity — styles, tables,
images, page breaks — still needs checking by hand against real Word, and that
is the thing most likely to break in a way neither script would notice.

## Version and export identity

`APP_CONFIG.version` is the single source, currently `1.0`. It reaches both
exports:

- **Saved audit JSON** — `createAuditEnvelope()` writes it as
  `applicationVersion`, alongside `schemaVersion`, so a saved review records
  which build produced it and `migrateV1Audit()` knows what it is reading.
- **Exported DOCX** — carried in `docProps/app.xml` as
  `Clinical Hub Incident Review 1.0` (read from `APP_CONFIG`, never a literal),
  visible in Word under File → Info →
  Properties → Application.

That second one matters more than it sounds. The DOCX is the artefact that gets
filed and read months later; without a version, a report with a formatting or
content problem cannot be traced to a build, and there is no way to tell whether
a given report predates a fix. `check` asserts both.

The header version is written from `APP_CONFIG.version` at boot, so a reviewer
can read the build without exporting first. The `<title>` still holds a literal
and is checked against the constant.

## Known and owned

- **`structuredClone()` is used during init**, which would otherwise set a hard
  browser floor of Safari 15.4 / Chrome 98 / Firefox 94 — all early 2022 — and
  fail closed: a blank page rather than a degraded app. A guard at the top of
  the script now falls back to a JSON round-trip.

  That fallback is exact *for this app's payloads* and would be wrong for
  others. Everything cloned here is plain JSON — audit objects, the time
  breakdown, and images held as `{id, dataUrl, width, height, type, name,
  caption}` where `dataUrl` is a base64 string from `readAsDataURL`. No Blobs,
  Files, Dates, Maps or Sets. `check` asserts that assumption separately from
  the guard's existence, because if it ever stops holding, the guard becomes
  silent corruption instead of a safety net.

## Related

Clinical Log, Clinical Hub Resources and AirDesk are separate applications with
their own repositories. This one shares their audit conventions and nothing
else — it has no API keys, no network calls and no persistence.
