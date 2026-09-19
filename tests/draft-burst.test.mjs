import assert from "node:assert/strict";
import {
  TIER_RELIABLE,
  TIER_GENERATION,
  resolveDraftPreset,
  buildDraftPrompt,
  validateDraftOutput,
  DRAFT_MAX_CHARS,
} from "../lib/draft-burst.mjs";

assert.equal(TIER_RELIABLE, "reliable", "tier names are protocol, not prose");
assert.equal(TIER_GENERATION, "generation", "tier names are protocol, not prose");

// Cascade: card pin, board default, band fallback, then explicit nothing.
assert.deepEqual(
  resolveDraftPreset({ cardPin: "c", boardDefault: "b", bandFallback: "a" }),
  { presetId: "c", source: "card" },
  "card pin wins",
);
assert.deepEqual(
  resolveDraftPreset({ cardPin: null, boardDefault: "b", bandFallback: "a" }),
  { presetId: "b", source: "board" },
  "board default next",
);
assert.deepEqual(
  resolveDraftPreset({ cardPin: null, boardDefault: null, bandFallback: "a" }),
  { presetId: "a", source: "band" },
  "band fallback keeps today's behavior when generation is unset",
);
assert.deepEqual(
  resolveDraftPreset({ cardPin: null, boardDefault: null, bandFallback: null }),
  { presetId: null, source: null },
  "nothing configured reads as nothing, never a throw",
);
assert.deepEqual(
  resolveDraftPreset({ cardPin: "", boardDefault: "b", bandFallback: "a" }),
  { presetId: "b", source: "board" },
  "blank strings never win the cascade",
);

// Draft prompt: short leash — no files, no commands, no questions.
const prompt = buildDraftPrompt({ cardName: "Login", brief: "Three taglines" });
assert.ok(prompt.includes("Three taglines"), "brief carried verbatim");
assert.ok(prompt.includes("write no files"), "file writes forbidden");
assert.ok(prompt.includes("ask no questions"), "questions forbidden");
assert.ok(prompt.includes("instead of inventing it"), "missing context is stated, not invented");
assert.ok(buildDraftPrompt({ cardName: "Login", brief: "  " }).includes("no brief was given"), "blank brief fails closed");

// Output validation: presence and size only — quality is the worker's job.
assert.equal(validateDraftOutput("  hello  ").ok, true, "trims and passes");
assert.equal(validateDraftOutput("   ").ok, false, "empty draft fails with retry guidance");
assert.equal(validateDraftOutput(null).ok, false, "off-shape input fails, never throws");
const long = validateDraftOutput("x".repeat(DRAFT_MAX_CHARS + 10));
assert.equal(long.ok, true, "oversize passes truncated, never repaired inline");
assert.equal(long.truncated, true, "truncation flagged");
assert.ok(long.text.includes("truncated at"), "truncation named in the text");

console.log("draft burst test ok: cascade, leash prompt, presence-only validation");
