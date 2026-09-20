/**
 * Preset-judge prompt builder and output parser (pure, no SDK).
 *
 * A preset judgment spawns one hidden thread on a user-chosen provider
 * preset and asks it to answer a decision question — the alternative to the
 * external Decision API for points that allow it. The contract is strict
 * JSON inside a fenced block; the judge may reason freely above it, but the
 * verdict counts only when the block parses and validates. Anything else
 * fails closed to built-in rules at the call site.
 */

export const PRESET_JUDGE_TIMEOUT_MS = 180000;
export const PRESET_JUDGE_POLL_MS = 5000;

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/g;

function lastFencedBlock(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  let last = null;
  FENCE_PATTERN.lastIndex = 0;
  let match = FENCE_PATTERN.exec(text);
  while (match !== null) {
    last = match[1];
    match = FENCE_PATTERN.exec(text);
  }
  FENCE_PATTERN.lastIndex = 0;
  return last;
}

// exec with /g keeps lastIndex on the shared pattern: both resets above keep
// repeated calls from skipping matches.
function parseJsonBlock(text) {
  const block = lastFencedBlock(text);
  if (block === null) return { ok: false, error: "no fenced verdict block" };
  try {
    return { ok: true, value: JSON.parse(block) };
  } catch {
    return { ok: false, error: "verdict block is not JSON" };
  }
}

function clampConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

// One atomic choice (triage intent today): the criteria map enumerates the
// legal ids with one-line glosses so the judge cannot invent options.
export function buildPresetJudgePrompt({ kind, state, questions }) {
  const body = typeof state === "string" ? state.slice(0, 8000) : "";
  if (kind === "criteria") {
    const list = Array.isArray(questions) ? questions : [];
    const lines = list.map((entry, index) => `${index + 1}. [${entry?.id ?? "unknown"}] ${entry?.text ?? ""}`);
    return [
      "You are a strict artifact judge. Read the artifact below, then judge each listed criterion.",
      "",
      "Artifact:",
      body,
      "",
      "Criteria:",
      ...lines,
      "",
      "End your reply with exactly one fenced block and nothing after it:",
      "```json",
      '{"verdicts": [{"id": "<criterion id>", "status": "met|unmet|unverifiable", "confidence": 0.0}]}',
      "```",
    ].join("\n");
  }
  const entries = questions && typeof questions === "object" && !Array.isArray(questions) ? Object.entries(questions) : [];
  const lines = entries.map(([id, question]) => `- ${id}: ${question?.criteria ? Object.entries(question.criteria).map(([choice, gloss]) => `${choice} (${gloss})`).join("; ") : ""}`);
  const instructions = entries.map(([, question]) => question?.instructions).find((text) => typeof text === "string") ?? "Pick the best option.";
  return [
    "You are a strict triage judge. Read the request below, then pick exactly one option.",
    "",
    "Request:",
    body,
    "",
    instructions,
    ...lines,
    "",
    "End your reply with exactly one fenced block and nothing after it:",
    "```json",
    '{"choice": "<option id>", "confidence": 0.0}',
    "```",
  ].join("\n");
}

// Normalized verdicts. Choice mode returns one {choice, confidence};
// criteria mode returns one entry per validated verdict. Unknown ids,
// unknown statuses, and non-numeric confidences never throw — they resolve
// to nulls the call-site resolvers already treat as rules fallbacks.
export function parsePresetJudgeOutput({ kind, text, validChoices }) {
  const parsed = parseJsonBlock(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const value = parsed.value;
  if (kind === "criteria") {
    if (!value || typeof value !== "object" || !Array.isArray(value.verdicts)) {
      return { ok: false, error: "verdicts must be an array" };
    }
    const verdicts = [];
    for (const entry of value.verdicts) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
      const status = entry.status === "met" || entry.status === "unmet" || entry.status === "unverifiable" ? entry.status : "unverifiable";
      verdicts.push({ id: entry.id, status, confidence: clampConfidence(entry.confidence) });
    }
    return { ok: true, verdicts };
  }
  const allowed = Array.isArray(validChoices) ? validChoices : [];
  if (!value || typeof value !== "object" || typeof value.choice !== "string" || !allowed.includes(value.choice)) {
    return { ok: false, error: "choice is missing or outside the allowed options" };
  }
  return { ok: true, choice: value.choice, confidence: clampConfidence(value.confidence) };
}
