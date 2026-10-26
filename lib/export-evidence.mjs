// Evidence integrity at export (pure, no IO).
//
// A registration in the card's `state.md` is a claim that a document exists. The
// bundle is where that claim becomes checkable after the thread is gone, so every
// registration has exactly two honest fates at export: a row in the `## Files`
// table (copied, with a SHA an outside reader can verify) or a row under
// `## Missing (registered but unreadable at export)` (named, so nobody thinks the
// card produced nothing). A registration that lands in neither is the failure this
// module measures: the export dropped it, the bundle reads as complete, and the
// only remaining trace of the document is a line in a state file that the run no
// longer carries.
//
// Two rules make the measurement worth trusting.
//
// It is a fixture, not a machine. The writer's IO lives in `server/`, so this
// module drives the same pure decisions (`parseArtifactManifest`, the two-root
// read, `assignBundleNames`, `renderBundleManifest`) against an in-memory file map.
// The same ledger and the same files therefore produce the same verdict on every
// host, which is what a metric needs.
//
// It reads the answer BACK from the rendered manifest, never from the plan. An
// accounting computed from the same list that decided the copy is `plan == plan`:
// it stays green the day the render stops emitting a row, which is the day it
// would have been worth something.

import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { MISSING_ARTIFACTS_HEADING, parseArtifactManifest, renderBundleManifest } from "./artifact-manifest.mjs";
import { assignBundleNames, parseBundleManifest } from "./run-bundle.mjs";
import { resolveBundleSource } from "./bundle-source-path.mjs";

/** The renderer's heading, imported rather than re-spelled: the accounting
 * parses the section back out of the manifest, so one literal owns it. */
export const MISSING_HEADING = MISSING_ARTIFACTS_HEADING;

function sha8(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 8);
}

/**
 * Read one registration the way the bundle writer does: project root first, then
 * the card's staging dir (see `bundle-source-path`). Null means registered and
 * unreadable — a blank placeholder counts, because a whitespace-only file is not
 * evidence of anything.
 */
export function readRegisteredSource(sourcePath, { projectRoot, stateDir, files }) {
  for (const candidate of resolveBundleSource(sourcePath, { projectRoot, stateDir })) {
    const content = files.get(resolve(candidate));
    if (typeof content === "string" && content.trim()) return content;
  }
  return null;
}

/** Registrations split by whether the export can read them. */
export function collectSources(registered, roots) {
  const readable = [];
  const unreadable = [];
  for (const fields of registered) {
    const content = readRegisteredSource(fields.path, roots);
    if (content === null) {
      unreadable.push(fields.path);
    } else {
      readable.push({ stage: fields.stage ?? null, sourcePath: fields.path, content });
    }
  }
  return { readable, unreadable };
}

/** The `## Missing` list, read back from the rendered manifest. */
export function missingRows(manifest) {
  const lines = String(manifest ?? "").split("\n");
  const start = lines.indexOf(MISSING_HEADING);
  if (start < 0) return [];
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    const row = line.match(/^- (.+)$/);
    if (row) {
      rows.push(row[1].trim());
    } else if (line.trim() && rows.length > 0) {
      break;
    }
  }
  return rows;
}

/**
 * Every path the ledger records, read by a second reader on purpose.
 *
 * The registration list otherwise comes from the same parser the export uses, and
 * that is exactly why it cannot answer "did the export see everything the ledger
 * says": a path the parser never returned cannot be missing from its output. So
 * this walker shares no code with it — it collects `path:` values inside
 * `artifacts:` blocks and nothing else. Where the two disagree, the ledger is the
 * claim on record and the reader is the one that lost a document.
 */
export function ledgerArtifactPaths(ledger) {
  const paths = [];
  let inside = false;
  for (const line of String(ledger ?? "").split("\n")) {
    if (line === "artifacts:") {
      inside = true;
      continue;
    }
    if (inside && /^\S/.test(line)) inside = false;
    if (!inside) continue;
    const row = line.match(/^  - path:\s*(.+)$/) ?? line.match(/^    path:\s*(.+)$/);
    if (row) paths.push(row[1].trim());
  }
  return [...new Set(paths)];
}

/**
 * Ledger registrations the exported manifest accounts for in neither place.
 *
 * The claim is the ledger, the answer is read back from the manifest text. A reader
 * that drops an entry, a copy pass that skips a plan without recording it, and a
 * render that stops writing the `## Missing` section all land here instead of
 * quietly shrinking the bundle.
 */
export function evidenceLost(ledger, manifest) {
  const copied = new Set(parseBundleManifest(manifest).map((entry) => entry.sourcePath));
  const missing = new Set(missingRows(manifest));
  return ledgerArtifactPaths(ledger).filter((path) => !copied.has(path) && !missing.has(path));
}

/** Copy every readable registration under its bundle name, or record the failure. */
function copySources(fixture, readable) {
  const unwritable = new Set(fixture.unwritable ?? []);
  const plans = assignBundleNames(readable.map(({ stage, sourcePath }) => ({ stage, path: sourcePath })));
  const copied = [];
  const failed = [];
  for (const plan of plans) {
    const source = readable.find((entry) => entry.sourcePath === plan.sourcePath);
    if (!source || unwritable.has(plan.sourcePath)) {
      failed.push(plan.sourcePath);
      continue;
    }
    copied.push({ name: plan.name, stage: plan.stage, sha8: sha8(source.content), sourcePath: plan.sourcePath });
  }
  return { copied, failed };
}

/** Drive the export's pure decisions over a fixture and render the manifest. */
export function simulateExport(fixture) {
  const files = new Map(
    Object.entries(fixture.files ?? {}).map(([path, content]) => [resolve(path), content]),
  );
  const roots = { projectRoot: fixture.projectRoot, stateDir: fixture.stateDir, files };
  const registered = parseArtifactManifest(fixture.ledger)
    .filter((fields) => typeof fields.path === "string" && fields.path.length > 0);
  const { readable, unreadable } = collectSources(registered, roots);
  const { copied, failed } = copySources(fixture, readable);
  const manifest = renderBundleManifest({
    cardId: fixture.cardId,
    cardName: fixture.cardName,
    stage: fixture.stage,
    generatedAt: fixture.generatedAt,
    files: copied,
    missing: [...unreadable, ...failed],
    registered,
    gapTotals: fixture.gapTotals,
    tokens: fixture.tokens ?? null,
  });
  return { registered: registered.map((fields) => fields.path), copied, missing: [...unreadable, ...failed], manifest };
}

/**
 * One ledger, one file map, every fate the export has to account for.
 *
 * The cases are chosen from what cards actually wrote, not from what the parser
 * wishes they wrote:
 *
 *   plans/spec-product.md      root-relative and readable -> copied
 *   plans/spec-tech.md         staging-relative and readable -> copied on retry
 *   context/triage-items.md    registered with no stage at all, file readable
 *   plans/spec-critique.md     registered, file never written -> Missing
 *   plans/blank.md             written as a whitespace placeholder -> Missing
 *   audits/verification.md     copy fails (disk, permissions) -> Missing
 *   /etc/passwd                absolute -> refused by the resolver -> Missing
 *   ../outside.md              traversal -> refused by the resolver -> Missing
 *
 * The stage-less case is the one that has to be measured rather than assumed: the
 * ledger records a document, the file is on disk and readable, and `stage` is
 * missing only because the block that registered it was appended by hand.
 */
export const EVIDENCE_FIXTURE = Object.freeze({
  projectRoot: "/w/project",
  stateDir: "/w/project/.stelow/2026-10-01/sw-card_evidence",
  cardId: "card_evidence",
  cardName: "evidence-fixture",
  stage: "audit",
  generatedAt: "2026-10-01T12:00:00.000Z",
  gapTotals: { fixed: 1, documented: 2, escalated: 0 },
  tokens: null,
  unwritable: ["audits/verification.md"],
  ledger: `---
name: evidence-fixture
current_stage: audit
artifacts:
  - stage: shape
    kind: document
    label: product spec
    path: plans/spec-product.md
  - stage: plan
    kind: document
    label: tech plan
    path: plans/spec-tech.md
  - kind: document
    label: triage items
    path: context/triage-items.md
  - stage: critique
    kind: document
    label: critique
    path: plans/spec-critique.md
  - stage: critique
    kind: document
    label: blank placeholder
    path: plans/blank.md
  - stage: audit
    kind: document
    label: verification
    path: audits/verification.md
  - stage: audit
    kind: document
    label: host file
    path: /etc/passwd
  - stage: audit
    kind: document
    label: outside the workspace
    path: ../outside.md
history: []
---`,
  files: {
    "/w/project/plans/spec-product.md": "# Product spec\n\nOne job, one product.\n",
    "/w/project/.stelow/2026-10-01/sw-card_evidence/plans/spec-tech.md": "# Tech plan\n\nTwo seams.\n",
    "/w/project/context/triage-items.md": "# Triage\n\n- critical: one\n",
    "/w/project/plans/blank.md": "  \n\t\n",
    "/w/project/audits/verification.md": "# Verification\n\nPASS.\n",
  },
});

/** The fixture's verdict: what the export dropped, and the manifest to read it in. */
export function evidenceReport(fixture = EVIDENCE_FIXTURE) {
  const exported = simulateExport(fixture);
  return { ...exported, lost: evidenceLost(fixture.ledger, exported.manifest) };
}
