/**
 * A card with no scopes is not always a fault, and the difference is known.
 *
 * Found on card_1fgz8lge: the card rendered two scope-sync notices side by side,
 * and they disagreed. The server had classified the card `no-spec` — an
 * investigation that reached audit without ever planning, with `planning: pending`
 * and `execution: pending` in its own state.md and no spec-tech.md on disk. The
 * honest notice stayed silent. A coarser rule inferred from the current stage
 * alone and told the reader their planning "likely used headings instead of
 * machine blocks", naming a spec that never existed.
 *
 * So the states that mean "scopes were expected and did not arrive" are pinned
 * here, and the two that do not are pinned as silence. A notice that fires on
 * emptiness is worse than none: it trains a reader to ignore the notice that
 * matters.
 */
import assert from "node:assert/strict";
import { scopeSyncNotice } from "../lib/scope-sync-notice.mjs";
import { diagnoseScopeSync } from "../lib/spec-scope-reader.mjs";

// The panel receives the server's REPORT, not the diagnosis directly:
// detailScopeSync maps `machine`/`human` onto `machineBlocks`/`humanBlocks`.
// Reproducing that mapping is the point — an earlier version of this test fed
// the raw diagnosis in, so every count read 0 and the strings were wrong.
const report = (specContent, syncedCount, specFile = null) => {
  const d = diagnoseScopeSync({ specContent, syncedCount });
  return {
    state: d.state,
    syncedScopes: d.synced,
    machineBlocks: d.machine,
    humanBlocks: d.human,
    specFile,
  };
};

const NO_SPEC = report(null, 0);
const NO_BLOCKS = report("# Spec\n\nNo scope blocks here.\n", 0);
const OK = report("[SCOPE-1] First\n[SCOPE-2] Second\n", 2);
// The human dialect the planning template invites: `### SCOPE-N: Title`.
const HUMAN = report("### SCOPE-1: First\n### SCOPE-2: Second\n", 0);
assert.equal(HUMAN.state, "human-dialect", "a human-dialect spec is diagnosed as such, not as no-blocks");
const UNSYNCED = report("[SCOPE-1] First\n[SCOPE-2] Second\n", 0);

// Silence where there is nothing to report. These are the regression: a card
// with no spec is the common case, and alarming on it accused a reader of
// writing a spec wrong when none was ever due.
assert.equal(scopeSyncNotice(NO_SPEC), null, "a card with no tech spec is not a scope-sync fault");
assert.equal(scopeSyncNotice(NO_BLOCKS), null, "a spec with no scope blocks is not yet a sync fault");
assert.equal(scopeSyncNotice(OK), null, "a card whose scopes synced has nothing to report");
assert.equal(scopeSyncNotice(null), null, "no classification means no notice");
assert.equal(scopeSyncNotice(undefined), null, "a missing classification never notices");
assert.equal(scopeSyncNotice("ok"), null, "junk never notices");

// The fault, named with the way out.
assert.match(
  scopeSyncNotice(UNSYNCED),
  /run bb stelow sync-scopes/,
  "machine blocks that did not sync name the command that fixes it",
);
assert.match(
  scopeSyncNotice(HUMAN),
  /headings instead of machine blocks/,
  "human headings name the dialect mismatch",
);
assert.match(scopeSyncNotice(HUMAN), /\[SCOPE-N\]/, "the fix is stated, not just the fault");

// A card that already ended is described as ended, not as needing action.
assert.match(
  scopeSyncNotice(UNSYNCED, { terminal: true }),
  /ended before tracking was established/,
  "a terminal card is not told to resync",
);
assert.doesNotMatch(
  scopeSyncNotice(UNSYNCED, { terminal: true }),
  /sync-scopes/,
  "a terminal card is not given a command",
);

// The spec is named when the server knows which file it read.
assert.match(
  scopeSyncNotice({ state: "human-dialect", humanBlocks: 3, machineBlocks: 0, specFile: "spec-tech_v2.md" }),
  /spec-tech_v2\.md/,
  "the notice names the spec the server actually read",
);
assert.match(
  scopeSyncNotice({ state: "human-dialect", humanBlocks: 3, machineBlocks: 0, specFile: null }),
  /the spec/,
  "an unknown spec file is named as unknown, not invented",
);

// The copy is user-facing and was already reviewed. The source is split across
// lines to satisfy the shape gate, so this pins the exact strings: a refactor
// that shortened or reworded one would ship a different warning silently.
const EXPECTED_TERMINAL =
  "Scope sync parsed 0 of 2 planned scopes — this card ended before tracking was "
  + "established (pre-guard format). Its audit record below is the evidence of what was verified.";
const EXPECTED_UNSYNCED =
  "Scope sync parsed 0 of 2 planned scopes — run bb stelow sync-scopes, then advance again.";
const EXPECTED_HUMAN =
  "Scope sync parsed 0 of 2 planned scopes — spec-tech_v2.md uses headings instead of "
  + "machine blocks. Rewrite openers as [SCOPE-N] Title, resync, then advance.";

assert.equal(scopeSyncNotice(UNSYNCED, { terminal: true }), EXPECTED_TERMINAL, "the terminal copy is unchanged");
assert.equal(scopeSyncNotice(UNSYNCED), EXPECTED_UNSYNCED, "the unsynced copy is unchanged");
assert.equal(
  scopeSyncNotice({ state: "human-dialect", humanBlocks: 2, machineBlocks: 0, specFile: "spec-tech_v2.md" }),
  EXPECTED_HUMAN,
  "the human-dialect copy is unchanged",
);

console.log("scope sync notice test ok: silence without a spec, the fault with a way out");
