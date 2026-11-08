import assert from "node:assert/strict";
import test from "node:test";
import { parseAskIntent } from "../server/runtime/cli/cli-ask-gate.ts";

/**
 * The opt-out confirm that never opted out.
 *
 * On card_a9q5zhzd the worker asked "Keep IN scope? Uncheck to remove" with
 * seven options and every one rendered unchecked — keeping everything meant
 * checking everything by hand. The full chain already existed: `--selected`
 * parses, single-select refuses it, cleanOptions forwards an explicit true,
 * and the renderer starts checked rows checked. But parseAskIntent rebuilt
 * each option with only four fields and dropped `selected` on the floor, so
 * no --selected flag ever reached a human. This pins the seam the suite
 * never covered: the parser below it and the cleaner above it both passed
 * while the mapping between them lost the flag.
 */

const intent = (argv) => parseAskIntent(argv, { threadId: "thr_1" });

test("--selected survives the intent mapping on a multiple question", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Keep IN scope? Uncheck to remove.",
    "--multiple",
    "--option", "needsNaming helper", "--selected",
    "--option", "Start-time refire", "--selected",
    "--option", "Regression pins",
  ]);
  assert.ok(!("refusal" in result), "a well-formed opt-out ask parses");
  if ("refusal" in result) return;
  assert.deepEqual(
    result.groups[0].options.map((option) => option.selected === true),
    [true, true, false],
    "checked options travel checked; the rest travel sparse",
  );
});

test("options without --selected travel without the key", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Pick?",
    "--multiple",
    "--option", "A",
    "--option", "B",
  ]);
  assert.ok(!("refusal" in result));
  if ("refusal" in result) return;
  for (const option of result.groups[0].options) {
    assert.ok(!("selected" in option), "absence reads as unchecked downstream — never invent a false");
  }
});

test("--selected on a single-select question is still refused", () => {
  const result = intent([
    "ask",
    "--thread", "thr_1",
    "--question", "Pick one.",
    "--option", "A", "--selected",
    "--option", "B",
  ]);
  assert.ok("refusal" in result, "preselection is an opt-out confirm and needs --multiple");
});

console.log("ask intent selected test ok: --selected reaches the human instead of dying in the mapping");
