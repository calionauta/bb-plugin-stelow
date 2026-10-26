#!/usr/bin/env node
/**
 * Audit the committed run bundles in `docs/runs/`.
 *
 * A bundle is the only record that survives a card: the state file is not
 * committed, so if the manifest disagrees with itself the run is unreadable after
 * the fact. This reads each manifest as a document — not as a plan — and counts
 * the ways it can lie:
 *
 *   trailer   `Stelow-Artifacts: N` must equal the rows in the `## Files` table,
 *             or the one-line count a reader trusts contradicts the table below it.
 *   missing   a `## Missing (registered but unreadable at export)` section means
 *             the card registered a document the bundle cannot show. Honest, but
 *             counted: it is evidence that a registration outlived its file.
 *   trail     a bundle without a `## Stage trail` cannot be replayed against the
 *             route its intent declares.
 *   tokens    `Unknown — no token reports` is honest; a rendered `0 total` would
 *             be a claim the host cannot make.
 *
 * Deliberately a script, not a test: the corpus is history. A test would go red on
 * a bundle nobody can regenerate, and red history teaches people to skip the gate.
 * The metric is the signal; the fix is forward-looking.
 *
 * Emits `METRIC name=value` lines so an autoresearch session can watch it, and a
 * table for a human.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RUNS = "docs/runs";
const METRIC = (name, value) => console.log(`METRIC ${name}=${value}`);

function parseBundle(cardId, text) {
  const stage = text.match(/at stage `([a-z-]+)`/)?.[1] ?? null;
  const trailer = text.match(/^Stelow-Artifacts:\s*(\d+)/m)?.[1];
  const rows = [...text.matchAll(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \|/gm)].map((m) => ({
    file: m[1],
    stage: m[2].trim(),
    sha: m[3].trim(),
  }));
  const missingSection = text.includes("## Missing (registered but unreadable at export)");
  const missing = [...(text.match(/## Missing \(registered but unreadable at export\)([\s\S]*?)(?:\n## |$)/)?.[1] ?? "")
    .matchAll(/^- (.+)$/gm)].map((m) => m[1].trim());
  const trailSection = text.match(/## Stage trail([\s\S]*?)(?:\n## |$)/)?.[1] ?? "";
  const trail = [...trailSection.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);
  const tokensUnknown = /Unknown — no token reports/.test(text);
  return {
    cardId,
    stage,
    trailer: trailer === undefined ? null : Number(trailer),
    rows: rows.length,
    missing: missing.length,
    missingSection,
    trail,
    tokensUnknown,
  };
}

const bundles = readdirSync(RUNS)
  .map((dir) => {
    try {
      return parseBundle(dir, readFileSync(join(RUNS, dir, "manifest.md"), "utf8"));
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const trailerMismatch = bundles.filter((b) => b.trailer !== null && b.trailer !== b.rows);
const withoutTrail = bundles.filter((b) => b.trail.length === 0);
const withMissing = bundles.filter((b) => b.missingSection || b.missing > 0);

METRIC("bundle_count", bundles.length);
METRIC("bundle_trailer_mismatch", trailerMismatch.length);
METRIC("bundle_without_trail", withoutTrail.length);
METRIC("bundle_registrations_unreadable", withMissing.reduce((sum, b) => sum + Math.max(b.missing, b.missingSection ? 1 : 0), 0));
METRIC("bundle_tokens_unknown", bundles.filter((b) => b.tokensUnknown).length);

for (const bundle of trailerMismatch) {
  console.log(
    `trailer mismatch  ${bundle.cardId}: trailer says ${bundle.trailer}, table has ${bundle.rows} row(s)`,
  );
}
for (const bundle of withoutTrail) {
  console.log(`no stage trail    ${bundle.cardId} (stage ${bundle.stage ?? "?"})`);
}
for (const bundle of withMissing) {
  console.log(`unreadable        ${bundle.cardId}: ${bundle.missing} named missing`);
}

console.log(
  `\n${bundles.length} bundles · ${bundles.length - trailerMismatch.length} agree with their trailer · `
    + `${bundles.length - withoutTrail.length} carry a replayable trail · ${bundles.length - withMissing.length} account for every registration`,
);
