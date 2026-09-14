# Architecture and maintenance

A map of `Clinical Hub Incident Review.html` for someone maintaining it who did
not write it. `README.md` covers deployment, the checks and what is
known-and-owned; this covers how the file is built.

## The short version

One HTML file, ~356 KB, no build step, no server, no network, no persistence.

| Part | Size | Share |
|---|---|---|
| Embedded base64 (fonts, logos, document assets) | ~136 KB | 38% |
| CSS | ~89 KB | 25% |
| JavaScript | ~114 KB | 32% |
| Markup | the rest | ~5% |

117 functions, 67 element ids, one `<script>` block and one `<style>` block.
792 CSS rule blocks across 594 distinct selectors, 133 `!important`, 26 custom
properties, 18 media queries.

Unlike the sibling apps, the UI is largely static markup rather than generated
— there is not a single inline `on*` handler, and events are bound with 20
`addEventListener` calls. The eight editor cards are `.card[id]` elements in
the document.

## The privacy position is the architecture

Most of the design follows from one decision: **review data never leaves
memory**. There is no storage layer to reason about, no sync, no cache, no
session. Close the tab and the review is gone unless it was explicitly saved.

That sounds like a limitation and is mostly a feature, given what an Air Desk
review contains. It also means the failure modes are unusual: there is no
half-saved state to recover, and no stale copy to reconcile. The compensating
control is that saving is explicit and produces a file the user can see.

Two artefacts come out of it:

- **A saved audit JSON** — the whole review, versioned with `schemaVersion`.
  `readAuditEnvelope()` validates the shape on load and `migrateV1Audit()`
  upgrades older files, so a review saved by an earlier build still opens.
  Keep that pair working: it is the only reason a saved review outlives a
  release.
- **A DOCX** — written from scratch in the browser. The file contains a minimal
  OOXML package: `[Content_Types].xml`, `docProps`, `word/document.xml`, zipped
  with a hand-rolled CRC-32 and stored (not deflated) entries, handed to the
  user as a Blob download.

The XML namespace URIs in that writer (`schemas.openxmlformats.org`,
`purl.org`, `w3.org`) are **identifiers, not addresses**. Nothing is ever
fetched from them. A reviewer scanning for external URLs will find 44 of them
and they are all namespace declarations — worth knowing before someone
"removes the external dependencies".

## The claims block

The numbered privacy statement at the top of the file is not decoration. It is
what a reviewer reads, and `tools/check.mjs` and `tools/verify.mjs` assert
claims 1 through 7 against the code and against runtime behaviour
respectively — see `README.md` for the mapping.

Claims 9 and 10 are advisory and cannot be checked by anything: exported files
carry sensitive clinical information, and pasted content may persist in the OS
or Citrix clipboard. Both are true and outside the application's control, which
is exactly why they are stated rather than implied.

The block closes by saying these are design intentions and not formal
accreditation or organisational approval. **Leave that sentence alone.** It is
the difference between an honest statement and an implied assurance, and
nothing in the code can make the stronger version true.

## Deployment couplings

Three, all asserted by `check`:

1. The netlify.toml rewrites must name the actual filename. The file keeps its
   human-readable name deliberately so the same file can be handed out for
   offline use, which is why the root is a rewrite rather than an
   `index.html`.
2. The meta CSP and the header CSP must not drift apart where they overlap.
   The header is the stronger of the two — it applies before parsing — and it
   adds `frame-ancestors 'none'`, which a meta tag cannot express.
3. `connect-src 'none'` must survive. It is what makes the privacy claims
   enforced rather than merely currently-true.

## Structural observations

Not defects — recorded so a reviewer does not have to rediscover them.

| Observation | Assessment |
|---|---|
| 133 `!important` across ~89 KB of CSS, and 792 rule blocks over 594 selectors (~25% repeats) | Middling density — well below AirDesk, above Clinical Log. A single flat stylesheet in a single-file app with no cascade layering produces this. It works and it is verified; untangling it is a large diff whose only proof is visual. Leave it. |
| No inline `on*` handlers; 20 `addEventListener` | Clean. The dead-button class that has bitten two sibling apps cannot occur here. |
| No `eval`, `new Function`, `document.write` | Clean. |
| `APP_CONFIG.version` reaches both exports and the header | Saved JSON via `createAuditEnvelope()`, DOCX via `docProps/app.xml`, header via `#buildVersion`. |
| `structuredClone()` at init, guarded | The guard falls back to a JSON round-trip, which is exact for this app's payloads and would be wrong for others. `check` asserts the assumption as well as the guard. |

## If you are picking this up cold

1. Read the privacy block at the top of the HTML, then `README.md`.
2. `npm install && npm test`. Both should be fully green — this app carries no
   outstanding NOTEs.
3. Before adding anything that stores or sends, read the claims block again.
   If a change would make one of those ten statements false, the statement has
   to change first — and then it is a governance conversation, not a code one.
4. After any change: `npm test`, then export a DOCX and open it in real Word.
   That is the one thing neither script can check and the most likely thing to
   break.
