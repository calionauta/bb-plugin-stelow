import assert from "node:assert/strict";
import {
  TIER_RELIABLE,
  TIER_GENERATION,
  resolveDraftPreset,
  buildDraftPrompt,
  validateDraftOutput,
  DRAFT_MAX_CHARS,
  buildCardNamePrompt,
  validateCardName,
  heuristicDisplayName,
  CARD_NAME_MAX_CHARS,
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

// Card titles ride Tier G: a short constrained ask, judged by the human
// inline rename — the heuristic stays the instant fallback everywhere.
assert.equal(CARD_NAME_MAX_CHARS, 60, "titles fit tiles, headers, and toasts");
const titlePrompt = buildCardNamePrompt({ prompt: "Fix the login redirect loop on Safari", kind: "build" });
assert.ok(titlePrompt.includes("ONLY the title"), "the leash forbids everything but the title");
assert.ok(titlePrompt.includes("Safari"), "the request reaches the judge");
assert.deepEqual(validateCardName("```\n```"), { ok: false, name: null, error: "empty title" }, "a fenced empty block fails closed");
assert.deepEqual(validateCardName('```"Fix Safari login loop"```'), { ok: true, name: "Fix Safari login loop", truncated: false }, "fenced verdicts extract before unquoting");
const quoted = validateCardName('"Fix Safari login loop"');
assert.deepEqual(quoted, { ok: true, name: "Fix Safari login loop", truncated: false }, "surrounding quotes strip, content survives");
const clipped = validateCardName(`{"ok":true,"choice":"${"x".repeat(80)}"}`);
assert.equal(clipped.name?.length, 60, "long verdicts clip to tile width");
assert.equal(validateCardName("   ").ok, false, "whitespace is not a title");
assert.equal(heuristicDisplayName("Fix the login redirect loop on Safari today please ok", "fallback"), "Fix the login redirect loop on Safari today please ok".split(" ").slice(0, 8).join(" "), "heuristic takes the first words");
assert.equal(heuristicDisplayName("", "fallback"), "fallback", "empty prompt falls back, never blanks");

console.log("draft burst test ok: cascade, leash prompt, presence-only validation");
