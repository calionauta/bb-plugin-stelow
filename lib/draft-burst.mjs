/**
 * Delegated draft bursts (Tier G). A draft is text-in/text-out: the caller
 * supplies a brief, a hidden thread on the generation preset produces prose,
 * and the card worker judges every word before using it. The draft preset
 * never touches protocol (locks, asks, files, advances, commits) — that is
 * what makes a cheap model safe here. Anything needing tools, exact shapes,
 * or multi-step sequencing stays Tier R (the band preset) and never calls
 * this module.
 */

// Tiers ride the spawn call site, never user choice: the code marks a burst
// Tier G only where its output is disposable by construction.
export const TIER_RELIABLE = "reliable";
export const TIER_GENERATION = "generation";

// Where the draft preset came from. `band` is the safe fallback: an unset
// generation preset degrades to today's behavior, never to a refusal.
export const DRAFT_SOURCE_CARD = "card";
export const DRAFT_SOURCE_BOARD = "board";
export const DRAFT_SOURCE_BAND = "band";

export function resolveDraftPreset({ cardPin, boardDefault, bandFallback }) {
  if (typeof cardPin === "string" && cardPin.length > 0) return { presetId: cardPin, source: DRAFT_SOURCE_CARD };
  if (typeof boardDefault === "string" && boardDefault.length > 0) return { presetId: boardDefault, source: DRAFT_SOURCE_BOARD };
  if (typeof bandFallback === "string" && bandFallback.length > 0) return { presetId: bandFallback, source: DRAFT_SOURCE_BAND };
  return { presetId: null, source: null };
}

// The draft thread's standing orders. Short on purpose: a cheap model
// follows a short leash better than a long brief.
export function buildDraftPrompt({ cardName, brief }) {
  const task = typeof brief === "string" && brief.trim().length > 0 ? brief.trim() : "(no brief given — answer in one line that no brief was given)";
  return [
    `You are a draft writer for the Stelow card "${cardName}". Produce ONLY the requested draft as markdown.`,
    `Rules: write no files, run no commands, ask no questions, advance nothing, commit nothing.`,
    `If you lack context, say what is missing instead of inventing it.`,
    ``,
    `Brief: ${task}`,
  ].join("\n");
}

// Draft output validation: presence and size only. Quality is the card
// worker's job — it re-checks 100% before using a word. Anything failing
// here is retried or escalated, never repaired inline (repairing a draft
// with a frontier model costs more than re-asking the cheap one).
export const DRAFT_MAX_CHARS = 8000;

export function validateDraftOutput(output) {
  const text = typeof output === "string" ? output.trim() : "";
  if (text.length === 0) return { ok: false, text: "", error: "empty draft — retry the burst or do the draft yourself" };
  if (text.length > DRAFT_MAX_CHARS) {
    return { ok: true, text: `${text.slice(0, DRAFT_MAX_CHARS)}\n\n[draft truncated at ${DRAFT_MAX_CHARS} chars]`, truncated: true };
  }
  return { ok: true, text, truncated: false };
}
