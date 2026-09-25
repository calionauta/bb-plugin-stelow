import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCard,
  callsNamed,
  cliHarness,
  commentBodies,
} from "./helpers/cli-harness.mjs";

/** Independent review: the deterministic preconditions that must pass before
 * a reviewer thread is ever spawned, and the verdict trail when it does. */

/** A tech plan that passes its stage contract (lib/artifact-contracts): the
 * planning structure, 800+ words, a task table with the required columns, and
 * the Dependencies/Done Criterion needles. The filler paragraphs satisfy the
 * word floor the way a real document would. */
const TECH_PLAN = [
  "## Identified Scopes",
  "The payment retry path and the receipt renderer are the two scopes. ".repeat(
    60,
  ),
  "",
  "## Sequence",
  "Retry first, then the receipt. ".repeat(60),
  "",
  "| Task | Done Criterion | Dependencies |",
  "| --- | --- | --- |",
  "| Retry path | Retry test passes | none |",
  "| Receipt | Receipt renders the retry | Retry path |",
  "",
].join("\n");

test("review refuses without a designated reviewer preset", async () => {
  const { invoke, calls } = cliHarness({
    reviewPresetId: null,
    card: buildCard({ kind: "research" }),
  });
  const result = await invoke(["review"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No artifact-reviewer preset designated/);
  assert.deepEqual(
    callsNamed(calls, "spawnDisposable"),
    [],
    "no reviewer thread without a designated reviewer",
  );
});

test("review of a build card demands a named artifact instead of the card", async () => {
  const { invoke } = cliHarness({ reviewPresetId: "preset_rev" });
  const result = await invoke(["review"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /--artifact <registered path>/);
});

test("review of an unregistered artifact refuses before any reviewer runs", async () => {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    files: {
      "/w/.stelow/state/state.md":
        "artifacts:\n  - stage: plan\n    path: spec-tech.md\n",
    },
  });
  const result = await invoke(["review", "--artifact", "notes.md"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /review only registered manifest documents/);
  assert.deepEqual(callsNamed(calls, "spawnDisposable"), []);
});

test("a completed review comments the verdict on the card", async () => {
  const { invoke, calls } = cliHarness({
    reviewPresetId: "preset_rev",
    reviewerOutput: "Verdict: changes-requested",
    files: {
      "/w/.stelow/state/state.md":
        "artifacts:\n  - stage: plan\n    kind: document\n    label: tech plan\n    path: spec-tech.md\n",
      "/w/spec-tech.md": TECH_PLAN,
    },
  });
  const result = await invoke(["review", "--artifact", "spec-tech.md"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(callsNamed(calls, "spawnDisposable").map(([, site]) => site), ["review"]);
  assert.match(commentBodies(calls).join("\n"), /Review requested/);
  assert.match(result.stdout, /Reviewer thread: thr_review/);
});

/** The advisory judges (criteria, verify-tasks, verify-delegation,
 * gap-triage): read-only, routed through one decision point, and never a
 * gate. */
