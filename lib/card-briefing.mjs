/**
 * Card briefings: a human-facing summary of what a card recorded.
 *
 * The fact list is deterministic (`lib/card-catch-up.mjs`); a generation-tier
 * model may PHRASE it and never add to it. That leash is the whole design: the
 * model receives the facts as text, is told they are the only facts, and is told
 * to say so when the list is empty rather than produce something to fill the
 * space. A briefing that invents a change is worse than no briefing, because the
 * reader has no way to tell it apart from the real ones.
 *
 * It rides the `card-briefing` delegation site: disposable, hidden, read-only,
 * text-in/text-out — the same shape as a draft burst, on the same generation
 * preset. Nothing here writes a card, an artifact, or a state file, and nothing
 * here advances anything.
 *
 * `STELOW_COMMS=0` disables the model half entirely, mirroring
 * `STELOW_GITHUB_ISSUES=0`. The deterministic list still renders: the kill
 * switch removes the phrasing, never the facts.
 */

/** Off switch for the model half. The facts are unaffected. */
export function commsDisabled(env = process.env) {
  return String(env?.STELOW_COMMS ?? "").trim() === "0";
}

export const BRIEFING_MAX_CHARS = 4000;

/**
 * The facts, as the text the model may rephrase.
 *
 * Rendered here rather than by the model: a model asked to summarise rows will
 * re-derive them, and a re-derived stage name is a second source of truth for
 * something the database already decided.
 */
export function renderFacts(facts) {
  const rows = Array.isArray(facts) ? facts : [];
  if (rows.length === 0) return "(no changes recorded)";
  return rows.map((fact) => {
    const when = new Date(fact.at).toISOString();
    const open = fact.open ? " [open]" : "";
    if (fact.kind === "stage") return `${when} stage → ${fact.stage}`;
    return `${when} ${fact.kind}${open}: ${fact.text ?? ""}`.trimEnd();
  }).join("\n");
}

/**
 * The briefing thread's standing orders.
 *
 * Short on purpose, like the draft prompt: a cheap model follows a short leash
 * better than a long brief. Three constraints do the work — these are the only
 * facts, invent nothing, and say plainly when there is nothing.
 */
export function buildBriefingPrompt({ cardName, summary, facts }) {
  return [
    `You are writing a short briefing for the person who owns the Stelow card "${cardName}".`,
    `They asked what changed on this card. You are given the changes; they are the ONLY facts you have.`,
    `Rules: state no fact that is not in the list; do not infer progress, quality, or intent;`,
    `do not ask questions, run commands, write files, or advance anything.`,
    `If the list is empty, say plainly that nothing changed — do not invent something to report.`,
    `Write 1–4 plain sentences. No headings, no bullet lists, no preamble.`,
    ``,
    `Summary of the list: ${summary}`,
    `Changes:`,
    renderFacts(facts),
  ].join("\n");
}

/**
 * Accept or refuse the model's phrasing.
 *
 * Presence and size only — the facts are already correct, so this checks that
 * the model produced something and does not overflow, exactly like a draft
 * burst. Quality is the reader's judgment, and a briefing that fails here
 * degrades to the deterministic list rather than to an error: the reader asked
 * what changed, and the list answers that without the model.
 */
export function validateBriefingOutput(output) {
  const text = typeof output === "string" ? output.trim() : "";
  if (text.length === 0) return { ok: false, text: "", error: "empty briefing" };
  if (text.length > BRIEFING_MAX_CHARS) {
    return { ok: true, text: `${text.slice(0, BRIEFING_MAX_CHARS)}\n\n[briefing truncated at ${BRIEFING_MAX_CHARS} chars]`, truncated: true };
  }
  return { ok: true, text, truncated: false };
}

/**
 * One fact in the wire shape.
 *
 * The contract's fields are always present, so a client never branches on
 * whether a key exists — an absent `stage` and an absent `text` are the same
 * nothing, and saying so once here is cheaper than every reader saying it.
 */
export function wireFacts(facts) {
  return (Array.isArray(facts) ? facts : []).map((fact) => ({
    kind: fact.kind,
    at: fact.at,
    text: typeof fact.text === "string" ? fact.text : null,
    stage: typeof fact.stage === "string" ? fact.stage : null,
    open: typeof fact.open === "boolean" ? fact.open : null,
  }));
}

/**
 * What the reader is shown, and where each half came from.
 *
 * `prose` is the model's phrasing when it produced usable output and null when
 * it did not. `source` names WHY the prose is what it is — `generation` when the
 * model wrote it, otherwise the reason it did not (`disabled`, `no-preset`,
 * `spawn-failed`, `no-output`). Collapsing every failure into one word would
 * hide the one distinction an operator needs: a switch someone turned off is not
 * an outage, and a briefing that cannot say which is a briefing nobody can
 * debug.
 *
 * `facts` and `summary` are always present. The UI labels this a summary of what
 * the card recorded, never a channel: the card already renamed "Conversation" to
 * "Notes for the agent" for the same reason, and a briefing that read as a
 * conversation would invite answers nobody is reading.
 */
export function briefingResult({ prose, facts, summary, source }) {
  const accepted = validateBriefingOutput(prose);
  return {
    summary,
    facts: Array.isArray(facts) ? facts : [],
    prose: accepted.ok ? accepted.text : null,
    source,
  };
}
