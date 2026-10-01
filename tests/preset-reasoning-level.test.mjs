/**
 * The preset reasoning level is a closed vocabulary, and every boundary that
 * touches it is a place a card could otherwise run at an effort nobody chose.
 *
 * The two halves of that claim are tested here rather than in the modules that
 * happen to implement them, because the failure is invisible from either side:
 * the picker's normaliser always showed `medium`, and the spawn site simply
 * forwarded whatever string it was handed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asPresetReasoningLevel,
  declaredProviderLevels,
  isLevelDeclaredForProvider,
  isPresetReasoningLevel,
  ladderIncludes,
  PRESET_REASONING_LEVELS,
  DEFAULT_PRESET_REASONING_LEVEL,
  unsupportedLevelMessage,
} from "../lib/preset-reasoning-level.mjs";
import {
  sanitizeComposerExecution,
  resolveComposerSpawn,
} from "../lib/composer-execution.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("only the eight host levels pass, and everything else reads as medium", () => {
  for (const level of PRESET_REASONING_LEVELS) {
    assert.equal(isPresetReasoningLevel(level), true, `${level} is a level`);
    assert.equal(asPresetReasoningLevel(level), level, `${level} survives normalisation`);
  }
  for (const value of ["banana", "", "HIGH", "medium-high", null, undefined, 7, {}]) {
    assert.equal(isPresetReasoningLevel(value), false, `${JSON.stringify(value) ?? value} is not a level`);
    assert.equal(
      asPresetReasoningLevel(value),
      DEFAULT_PRESET_REASONING_LEVEL,
      "an unusable level reads as the default, never as itself",
    );
  }
});

test("the vocabulary is the host's own, so a host that adds a level fails here", () => {
  const bundled = join(root, "node_modules/@get-bb/plugin-sdk/bundled-types");
  const declarations = readdirSync(bundled)
    .filter((name) => name.endsWith(".d.ts"))
    .map((name) => readFileSync(join(bundled, name), "utf8"))
    .filter((source) => source.includes("reasoningLevelSchema"));
  const host = new Set();
  for (const source of declarations) {
    const block = source.match(/reasoningLevelSchema:\s*\w*\.?ZodEnum<\{([^}]*)\}/);
    for (const match of (block?.[1] ?? "").matchAll(/\w+:\s*"([^"]+)"/g)) host.add(match[1]);
  }
  assert.ok(host.size > 0, "the SDK declares a reasoningLevelSchema");
  assert.deepEqual(
    [...PRESET_REASONING_LEVELS].sort(),
    [...host].sort(),
    "a preset stores exactly what the host can spawn — a new host level needs a decision here",
  );
});

test("a composer's level is validated against the same eight, so junk falls back to the preset", () => {
  assert.equal(
    sanitizeComposerExecution({ reasoningLevel: "banana" }),
    null,
    "a level no host will honour is not a choice at all",
  );
  assert.deepEqual(
    sanitizeComposerExecution({ providerId: "pi", reasoningLevel: "high" }),
    { providerId: "pi", reasoningLevel: "high" },
    "a real level survives next to the rest of the choice",
  );
  const base = { provider_id: "pi", model_id: "m", reasoning_level: "high", permission_mode: "full" };
  assert.equal(
    resolveComposerSpawn(base, { reasoningLevel: "banana" }).reasoningLevel,
    "high",
    "the preset's level fills the gap the junk level left, instead of the junk winning",
  );
});

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
