/**
 * The panel's projection of "what can this card move to" must agree with
 * the helper that enforces it.
 *
 * The panel used to read the catalog's transition rows and offer every
 * target: no intent route, no review mode. So it offered `diff-gate` in
 * Auto (where the stage does not exist) and `planning` at `context` on a
 * bugfix (where the route does not go), and the worker was refused by the
 * helper seconds later — the two answers to the same question disagreed,
 * and only the helper's was right.
 *
 * This test runs the PINNED HELPER over every (intent, stage, review mode)
 * triple and compares its answer with the host's projection. It is the
 * gate that keeps the two from drifting: upstream changes the rule, the
 * helper follows, and this test fails until the host's projection follows
 * too.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { legalMoves } from "../lib/workflow-moves.mjs";
import { STAGE_SEQUENCE, WORKFLOW_ROUTES } from "../lib/workflow-catalog.mjs";
import { LEGACY_REVIEW_MODE_TO_GATES } from "../lib/review-gates.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const HELPER = join(root, "data", "stelow");
const TRANSITIONS = join(root, "skills", "stelow-workflow-orchestrator", "references", "transitions.md");

const MODES = Object.keys(WORKFLOW_ROUTES.review_modes ?? {});

/** The helper's own answer for one triple. Runs the real script. */
function helperMoves({ intent, reviewMode, stage, quality = "production", explorationCount = "3" }) {
  const dir = mkdtempSync(join(tmpdir(), "stelow-moves-"));
  try {
    const stateDir = join(dir, ".stelow", "2026-01-01", "sw-test");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "state.md"),
      [
        "---",
        "name: parity",
        `intent: ${intent}`,
        `current_stage: ${stage}`,
        "status: active",
        "config:",
        `  quality: ${quality}`,
        `  exploration_count: ${explorationCount}`,
        `  review_mode: ${reviewMode}`,
        "  product_type: software",
        "stages:",
        `  ${stage}: in-progress`,
        "artifacts: []",
        "history: []",
        "---",
        "# parity",
        "",
      ].join("\n"),
    );
    const out = execFileSync("bash", [HELPER, "next", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        STELOW_STATEDIR: stateDir,
        STELOW_TRANSITIONS: TRANSITIONS,
      },
    });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The sweep.
 *
 * The review-mode dimension is swept over EVERY stage for one intent: the
 * mode decides which stages exist, and that can change the answer from any
 * stage (the predecessor of a skipped stage gains a move). The intent
 * dimension is swept over every stage in the modes that skip the most, for
 * the three routes that differ most from the reference one.
 *
 * Every triple costs a real helper process, so the sweep is chosen, not
 * exhaustive — but it covers both dimensions at every stage.
 */
const SWEEP = [
  ...MODES.flatMap((reviewMode) => STAGE_SEQUENCE.map((stage) => ({ intent: "feature", reviewMode, stage }))),
  ...["bugfix", "refactor", "investigate"].flatMap((intent) =>
    STAGE_SEQUENCE.map((stage) => ({ intent, reviewMode: "Auto", stage })),
  ),
];

let checked = 0;
for (const { intent, reviewMode, stage } of SWEEP) {
  {
    const projected = legalMoves({ intent, reviewPolicy: reviewMode, stage });
    const helper = helperMoves({ intent, reviewMode, stage });
    const label = `${intent}/${reviewMode}/${stage}`;
    assert.deepEqual(
      [...projected.allowed].sort(),
      [...helper.allowed].sort(),
      `the panel and the helper disagree about the moves from ${label}`,
    );
    assert.deepEqual(
      [...projected.forward].sort(),
      [...helper.forward].sort(),
      `the panel and the helper disagree about the forward move from ${label}`,
    );
    checked += 1;
  }
}

assert.ok(checked >= 100, `the parity sweep must cover the whole graph (${checked} triples)`);

/**
 * A gate SET is the finer policy, and the ladder rung is its legacy
 * spelling. The two must answer the same question the same way, or the
 * panel's answer depends on which field the card happened to carry.
 */
for (const [reviewMode, gates] of Object.entries(LEGACY_REVIEW_MODE_TO_GATES)) {
  for (const stage of STAGE_SEQUENCE) {
    const fromRung = legalMoves({ intent: "feature", reviewPolicy: reviewMode, stage });
    const fromGates = legalMoves({ intent: "feature", reviewPolicy: gates, stage });
    assert.deepEqual(
      [...fromRung.allowed].sort(),
      [...fromGates.allowed].sort(),
      `the ladder rung and its gate set disagree about ${stage} in ${reviewMode}`,
    );
  }
}

/**
 * The stage that waits for nobody still RUNS. `selection` is in
 * `no_human_wait`, not `skipped`: the agent decides the pick, but the stage
 * happens and produces the artifacts the next stage reads. Bypassing it
 * would hand the next stage a prose interface with no graph.
 */
/**
 * The stage policy: the same rule the helper enforces and the published
 * matrix is rendered from. The panel must agree with the helper about it
 * too, or the panel offers a move the helper refuses.
 */
for (const quality of ["production", "experimental"]) {
  for (const explorationCount of ["1", "3"]) {
    for (const reviewMode of ["Auto", "Product Spec + Interface + Tech Review + Code Diff"]) {
      const knobs = { intent: "feature", reviewMode, quality, explorationCount };
      const projected = legalMoves({
        intent: "feature",
        reviewPolicy: reviewMode,
        stage: "setup",
        quality,
        explorationCount,
      });
      const helper = helperMoves({ ...knobs, stage: "setup" });
      const label = `${quality}/${explorationCount}/${reviewMode}`;
      assert.deepEqual(
        [...projected.allowed].sort(),
        [...helper.allowed].sort(),
        `the panel and the helper disagree about the moves from setup (${label})`,
      );
    }
  }
}

const autoSelection = legalMoves({ intent: "feature", reviewPolicy: "Auto", stage: "int-gate" });
assert.ok(
  autoSelection.allowed.includes("selection"),
  "selection runs in Auto — the agent decides the pick, the stage still happens",
);
assert.ok(
  !autoSelection.allowed.includes("architecture"),
  "selection is not bypassed in Auto: it produces the artifacts the next stage reads",
);

console.log(`workflow moves ok: ${checked} triples agree with the pinned helper`);
