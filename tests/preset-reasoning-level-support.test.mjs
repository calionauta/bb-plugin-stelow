/**
 * The provider's own ladder, and the third state between "supported" and
 * "not".
 *
 * Split out of `preset-reasoning-level.test.mjs` because the two are different
 * subjects that happened to land in one file: that one asks whether the
 * `presets` TABLE accepts a level (a storage question, needing a real
 * database), and this one asks whether the PROVIDER honours it (a
 * host-capability question, needing only the roster shape as plain data).
 * Merging them pushed the file past the 400-line budget, and joining the
 * subjects would have been the wrong answer to that.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  declaredProviderLevels,
  isLevelDeclaredForProvider,
  isPresetReasoningLevel,
  ladderIncludes,
  unsupportedLevelMessage,
} from "../lib/preset-reasoning-level.mjs";


/**
 * The host enum is a superset: every provider declares a subset of the eight,
 * so "valid for the host" is not "valid here". These are the shapes the host's
 * own roster has — `pi` without `ultra`/`ultracode`, `acp-opencode` without
 * `none`/`ultra`/`ultracode` — and the reason the enum check alone let a level
 * persist that the provider never declared.
 */
const ROSTER = [
  { id: "pi", reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"] },
  { id: "acp-opencode", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
  { id: "silent", reasoningLevels: [] },
].map((entry) => ({
  id: entry.id,
  reasoningLevels: entry.reasoningLevels.map((id) => ({ id, label: id })),
}));

test("a level the provider never declared is not a level, however valid it is for the host", () => {
  assert.equal(
    isLevelDeclaredForProvider(ROSTER, "acp-opencode", "medium"),
    true,
    "a level inside the declared ladder is supported",
  );
  assert.equal(
    isLevelDeclaredForProvider(ROSTER, "acp-opencode", "ultracode"),
    false,
    "a level the host enum allows and this provider never declared is unsupported",
  );
  assert.equal(
    isPresetReasoningLevel("ultracode"),
    true,
    "which is exactly why the enum check on its own let this through",
  );
  for (const level of ["none", "ultra", "ultracode"]) {
    assert.equal(
      isLevelDeclaredForProvider(ROSTER, "acp-opencode", level),
      false,
      `acp-opencode declares no ${level}`,
    );
  }
  assert.equal(
    isLevelDeclaredForProvider(ROSTER, "pi", "ultra"),
    false,
    "pi declares no ultra",
  );
  assert.equal(
    ladderIncludes(["low", "medium"], "high"),
    false,
    "the bare ladder predicate agrees with the roster-shaped one",
  );
});

test("the host's silence is null, never support", () => {
  for (const [roster, providerId, why] of [
    [null, "pi", "an unreadable roster"],
    [ROSTER, "not-installed", "a provider absent from the roster"],
    [ROSTER, "silent", "a provider that declares no ladder"],
  ]) {
    assert.equal(
      isLevelDeclaredForProvider(roster, providerId, "high"),
      null,
      `${why} reports unverified, not supported`,
    );
    assert.equal(
      declaredProviderLevels(roster, providerId),
      null,
      `${why} yields no ladder to check against`,
    );
  }
  assert.deepEqual(
    declaredProviderLevels(ROSTER, "pi"),
    ["none", "low", "medium", "high", "xhigh", "max"],
    "a declared ladder is reported as the provider declared it, ids only",
  );
});

test("the refusal names the provider's own ladder, because that is where the mismatch is", () => {
  const message = unsupportedLevelMessage("acp-opencode", "ultracode", ["low", "medium"]);
  assert.match(message, /acp-opencode/);
  assert.match(message, /ultracode/);
  assert.match(
    message,
    /low, medium/,
    "naming the levels that ARE supported sends the reader to the fix, not back to the enum",
  );
});
