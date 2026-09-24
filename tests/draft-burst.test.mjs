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

// Shared draft-thread lifecycle (CLI bursts and RPC drafts): scripted
// threads with instant sleeps, so timeout and failure paths run in ms.
const { awaitDraftThread } = await import("../lib/draft-await.mjs");
const scripted = (statuses, output = "prose") => {
  let calls = 0;
  return {
    calls: () => calls,
    deps: {
      threadStatus: async () => statuses[Math.min(calls++, statuses.length - 1)],
      threadOutput: async () => output,
      stopThread: async () => true,
      sleep: async () => undefined,
    },
  };
};
{
  const t = scripted(["running", "idle"]);
  assert.deepEqual(await awaitDraftThread(t.deps, "thr_1", { pollMs: 1, polls: 5 }), { ok: true, output: "prose", error: null }, "a settling thread resolves its output");
  assert.equal(t.calls(), 2, "settled threads stop polling");
}
{
  const t = scripted(["running", "failed"]);
  assert.match((await awaitDraftThread(t.deps, "thr_2", { pollMs: 1, polls: 5 })).error ?? "", /ended with status failed/, "failed threads stop and name the status");
}
{
  const t = scripted(["running", "running", "running"]);
  assert.match((await awaitDraftThread(t.deps, "thr_3", { pollMs: 1, polls: 3 })).error ?? "", /still running after 0 minutes/, "exhausted polls stop and name the timeout");
}
{
  const t = scripted(["archived"]);
  assert.deepEqual((await awaitDraftThread(t.deps, "thr_4", { pollMs: 1, polls: 5 })).output, "prose", "archived threads fall through to the output path");
}
{
  const t = scripted([null, "idle"]);
  assert.deepEqual((await awaitDraftThread(t.deps, "thr_5", { pollMs: 1, polls: 5 })).ok, true, "unreadable status polls on instead of failing");
}

console.log("draft burst test ok: cascade, leash prompt, presence-only validation, shared await lifecycle");
