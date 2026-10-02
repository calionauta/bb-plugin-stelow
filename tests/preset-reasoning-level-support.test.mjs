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

/**
 * The recorded ledger is frozen, and this is the test that says so.
 *
 * `PRESET_MIGRATION_STATEMENTS` is spread into the single `bb.storage.migrate`
 * list, and the host records a sha256 per statement AT ITS POSITION, refusing to
 * start when a recorded position no longer hashes the same. Changing an entry's
 * text, or removing one so the rest shift up, makes every install that already
 * recorded that position refuse — with "migration 3 does not match the recorded
 * statement", which reads like a corrupt database and is not one.
 *
 * This is not hypothetical. The first version of the current-shape change
 * rewrote the `presets` entry as a template literal and emitted a single entry,
 * and it shipped in v0.61.0: every install rolled back. This host's live ledger
 * held `ba1ac500…` (the `presets` DDL) at position 3 and `dc61626f…`
 * (`card_presets`) at 4, and the new code presented `dc61626f…` at position 3.
 *
 * So the hashes below are the RELEASED ones, read off a live install's ledger. A
 * change to this migration is supposed to change the presets SCHEMA; it is not
 * supposed to change this list, and the current schema is reached outside it.
 * Inverted — reordering or rewriting the array — this fails on the hash
 * comparison rather than on a behaviour assertion, which is the point: the
 * failure it prevents cannot be reproduced by any schema-level test.
 */
const RELEASED_LEDGER_HASHES = [
  "ba1ac50033315c14f2c33b9f56cbacd380cf9ee96e5521901d53b07284c3ad07",
  "dc61626f2f9be61c7db251f4a6b3ae5eb5047892c433c602ea523a5b5b3fe1e6",
];

test("the recorded preset statements are the released ones, in the released order", async () => {
  const { createHash } = await import("node:crypto");
  const { PRESET_MIGRATION_STATEMENTS } = await import("../server/presets.ts");
  assert.deepEqual(
    PRESET_MIGRATION_STATEMENTS.map((s) => createHash("sha256").update(s).digest("hex")),
    RELEASED_LEDGER_HASHES,
    "bb records a hash per statement at the position it occupied and refuses to start when a "
    + "recorded position no longer matches — so this array is append-only and order-frozen. The "
    + "current presets DDL is reached outside it, by design.",
  );
});
