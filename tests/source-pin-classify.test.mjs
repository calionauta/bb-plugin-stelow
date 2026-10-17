import assert from "node:assert/strict";
import test from "node:test";
import { classifySourcePin } from "../scripts/source-pin-classify.mjs";
import { discoveredRead, entrypointRead, literalRead, noReads } from "./fixtures/source-pin-samples.mjs";

/**
 * The ratchet's counting rule, tested on its own.
 *
 * The rule has one subtle half: a test that discovers files with readdirSync and
 * reads them by variable carries no literal inside the call window, so the
 * directory it walks is the only signal. That half once matched the whole file
 * text against the source pattern, which counted a test that read `skills/`
 * fixtures merely because it imported a helper from `../lib/`. These cases name
 * the difference, so the count can only move for the right reason.
 *
 * The sample sources live in tests/fixtures/ — a test file embedding
 * `readFileSync("…")` in a template literal would itself look like a pin.
 */

test("a literal read of a source file is a pin", () => {
  assert.equal(classifySourcePin(literalRead("server/runtime/card-detail.ts")).sourcePin, true);
});

test("a literal read of a fixture is not a pin", () => {
  assert.equal(classifySourcePin(literalRead("tests/fixtures/x.state.md")).sourcePin, false);
});

test("a discovered read of a source directory is still a pin", () => {
  const result = classifySourcePin(discoveredRead("server"));
  assert.equal(result.dynamicDirPin, true);
  assert.equal(result.sourcePin, true, "walking server/ is a source read however the path is built");
});

test("a discovered read of a fixture tree is not a pin, even beside a lib import", () => {
  const result = classifySourcePin(discoveredRead("skills"));
  assert.equal(result.dynamicDirPin, false, "the walk names skills/, a fixture tree — so it does not count");
  assert.equal(result.sourcePin, false, "importing ../lib/ is not reading source text");
});

test("an entrypoint read is named separately from a source read", () => {
  const result = classifySourcePin(entrypointRead());
  assert.equal(result.entrypointPin, true);
  assert.equal(result.sourcePin, true);
});

test("a file that reads nothing is not a pin", () => {
  assert.deepEqual(
    classifySourcePin(noReads),
    { sourcePin: false, entrypointPin: false, windows: 0, dynamicDirPin: false },
  );
});
