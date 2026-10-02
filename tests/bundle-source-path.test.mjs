import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBundleSource } from "../lib/bundle-source-path.mjs";

// Exporting a card's run bundle must find the artifacts the card registered.
//
// card_48uuhus1 reported 17 registered artifacts as unreadable. They were on
// disk the whole time. The card's own state.md records the same artifact in two
// shapes — 38 entries as `.stelow/2026-10-01/sw-card_48uuhus1/context/...` and
// 15 as `context/...` — and only the first resolved.
//
// The cause is documented upstream at data/stelow:1640. Artifacts are recorded
// relative to the directory `stelow advance` ran from, deliberately, because
// that is the base the manifest digests against. An agent that ran from inside
// the staging tree wrote paths relative to staging; one that ran from the
// project root wrote paths relative to the root. The state dir is the only place
// both shapes are true at once.

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "bundle-source-path.mjs"), "utf8");

const ROOTS = { stateDir: "/w/.stelow/2026-10-01/sw-card_48uuhus1", projectRoot: "/w" };

// --- both roots are offered, project first --------------------------------
// The reader stops at the first candidate that opens. The project root comes
// first because a committed bundle must stay relative to the project: a path
// that resolves there is the one someone opening the repository will find.

assert.deepEqual(
  resolveBundleSource("context/triage-items.md", ROOTS),
  [
    "/w/context/triage-items.md",
    "/w/.stelow/2026-10-01/sw-card_48uuhus1/context/triage-items.md",
  ],
  "a bare path is tried at the project root and then inside the state dir",
);

assert.deepEqual(
  resolveBundleSource(".stelow/2026-10-01/sw-card_48uuhus1/context/triage-items.md", ROOTS),
  [
    "/w/.stelow/2026-10-01/sw-card_48uuhus1/context/triage-items.md",
    "/w/.stelow/2026-10-01/sw-card_48uuhus1/.stelow/2026-10-01/sw-card_48uuhus1/context/triage-items.md",
  ],
  "a staging-rooted path resolves at the project root; the state-dir retry is the degenerate one and is offered second",
);

// --- a missing root narrows the list rather than failing ------------------

assert.deepEqual(
  resolveBundleSource("context/triage-items.md", { stateDir: null, projectRoot: "/w" }),
  ["/w/context/triage-items.md"],
  "without a state dir there is nothing second to try",
);
assert.deepEqual(
  resolveBundleSource("context/triage-items.md", { stateDir: "/w/.stelow/x", projectRoot: null }),
  ["/w/.stelow/x/context/triage-items.md"],
  "a staging-only workspace still resolves its own artifacts",
);

// --- an empty or non-string path is refused outright ----------------------

assert.deepEqual(resolveBundleSource("", ROOTS), [], "an empty path is refused");
assert.deepEqual(resolveBundleSource("   ", ROOTS), [], "whitespace is not a path");
assert.deepEqual(resolveBundleSource(null, ROOTS), [], "a non-string is refused");

// --- the safety rules survive ---------------------------------------------
// resolveArtifactPath refuses absolute paths and `..` for a reason: a manifest
// is agent-produced input. This must not become a way around it.

assert.deepEqual(
  resolveBundleSource("/etc/passwd", ROOTS),
  [],
  "an absolute path from a manifest is refused, as before",
);
assert.deepEqual(
  resolveBundleSource("../../etc/passwd", ROOTS),
  [],
  "a traversal is refused, as before",
);
assert.deepEqual(
  resolveBundleSource("../../../../etc/passwd", ROOTS),
  [],
  "retrying inside the state dir does not widen the boundary",
);

// --- the order is the contract --------------------------------------------
// A reader stops at the first candidate that opens, so swapping these two
// would silently export the staging copy in preference to the real one.

assert.match(
  source,
  /projectRoot \? safeResolve[\s\S]*stateDir \? safeResolve/,
  "the project root is tried before the state dir",
);

console.log("bundle source path test ok: both recorded shapes resolve, and the safety boundary is unchanged");
