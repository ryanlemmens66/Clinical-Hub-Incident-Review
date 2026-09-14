/**
 * Shared helpers for the audit scripts: locating the app file and printing
 * consistent pass/fail output.
 *
 * Same reporting shape as the Clinical Hub Resources, AirDesk and Clinical Log suites, so
 * output from any of them reads the same way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

export const APP_NAME = 'Clinical Hub Incident Review.html';
export const APP_FILE = join(repo, APP_NAME);
export const REPO_DIR = repo;

if (!existsSync(APP_FILE)) {
  console.error(`Cannot find the app at ${APP_FILE}`);
  process.exit(2);
}

/** Raw netlify.toml text, or '' when it is absent. */
export function netlifyToml() {
  try { return readFileSync(join(repo, 'netlify.toml'), 'utf8'); } catch { return ''; }
}

/* ------------------------------------------------------------- reporting -- */
let passes = 0;
let failures = 0;
let warnings = 0;

export function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** Record a check. `detail` is printed only on failure. */
export function ok(condition, label, detail = '') {
  if (condition) {
    passes++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
  } else {
    failures++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
    if (detail) String(detail).split('\n').forEach(l => console.log(`        ${l}`));
  }
}

/**
 * A check that reports a real condition but must not fail the run — used for
 * things that are known and owned rather than wrong, so they stay visible
 * without ever going red.
 */
export function note(condition, label, detail = '') {
  if (condition) {
    passes++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
  } else {
    warnings++;
    console.log(`  \x1b[33mNOTE\x1b[0m  ${label}`);
    if (detail) String(detail).split('\n').forEach(l => console.log(`        ${l}`));
  }
}

export function fail(label, detail = '') { ok(false, label, detail); }

export function summary() {
  console.log('');
  const noted = warnings ? `, \x1b[33m${warnings} note(s)\x1b[0m` : '';
  if (failures) console.log(`\x1b[31m${failures} check(s) failed\x1b[0m, ${passes} passed${noted}`);
  else console.log(`\x1b[32mAll ${passes} checks passed\x1b[0m${noted}`);
  return failures ? 1 : 0;
}
