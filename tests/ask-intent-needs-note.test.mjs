import assert from "node:assert/strict";
import test from "node:test";
import { ASK_USAGE, parseAskIntent } from "../server/runtime/cli/cli-ask-gate.ts";

/**
 * The conditional pick that never conditioned.
 *
 * `parseAskGroups` learned `--needs-note` and `cleanOptions` forwards an
 * explicit true, but `parseAskIntent` rebuilt each option with only five
 * fields and dropped `needsNote` on the floor — the same seam `--selected`
 * fell through in `ask-intent-selected.test.mjs`. Every conditional option
 * ("trim the scope — tell me which", "rework — say what is wrong") then
 * reached the human as a plain pick: submit never waited, and the worker
 * got a bare label into a guaranteed clarification round. This pins the
 * mapping the suite never covered: the flag the parser accepts must reach
 * the payload, the expired rows, and the renderer.
 */

const intent = (argv) => parseAskIntent(argv, { threadId: "thr_1" });

test("--needs-note survives the intent mapping on a single-select gate", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Spec gate: do you approve it as written?",
    "--option", "Approve as written",
    "--option", "Approve, but trim the scope", "--needs-note",
    "--option", "Rework before critique", "--needs-note",
  ]);
  assert.ok(!("refusal" in result), "a well-formed conditional gate parses");
  if ("refusal" in result) return;
  assert.deepEqual(
    result.groups[0].options.map((option) => option.needsNote === true),
    [false, true, true],
    "conditional options travel conditional; the plain approve travels sparse",
  );
});

test("options without --needs-note travel without the key", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Pick?",
    "--option", "A",
    "--option", "B",
  ]);
  assert.ok(!("refusal" in result));
  if ("refusal" in result) return;
  for (const option of result.groups[0].options) {
    assert.ok(!("needsNote" in option), "absence reads as submittable downstream — never invent a false");
  }
});

test("--needs-note with no preceding --option refuses, naming the flag", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Pick?",
    "--needs-note",
    "--option", "A",
    "--option", "B",
  ]);
  assert.ok("refusal" in result, "a bare flag refuses before the human is pinged");
  if (!("refusal" in result)) return;
  assert.match(result.refusal.stderr, /--needs-note/, "the refusal names the flag");
});

test("the ask usage advertises the conditional flag", () => {
  assert.match(ASK_USAGE, /--needs-note/, "workers discover the flag from the usage line, not from lore");
});

console.log("ask intent needs-note test ok: conditional picks reach the human instead of dying in the mapping");
