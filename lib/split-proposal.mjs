// Card-split proposal rules (pure, tested). A triage worker that finds 2+
// clearly independent items in one card proposes the split through a
// structured ask; the host creates the children only from an approved,
// recorded proposal — never from a worker's claim.
//
// Shape discipline (mirrors fan-out: IDs, never prose):
// - slices come from ask options (label + description), recorded by the host
//   at ask time; selections are recorded by the host from the submitted
//   answer (ask-handler return AND card-answer RPC — both land here);
// - `bb stelow split` takes no content args: it executes the recorded,
//   approved proposal or refuses.

export const SPLIT_KEEP_LABEL = "Keep as one card";
export const MAX_SPLIT_CHILDREN = 5;
export const MIN_SPLIT_CHILDREN = 2;
export const SPLIT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

// The only stages where a split is legal. Every guard (worker ask
// validation, `split` executor, human trigger, card UI flag) reads this —
// never a pasted "triage"/"select" pair.
export const SPLIT_STAGES = ["triage", "select"];

export const SPLIT_NON_BUILD_ERROR = "Only build cards split. Research and explore cards are single-stage by design.";

function text(value) {
  return typeof value === "string" ? value : "";
}

function norm(label) {
  return text(label).trim().toLowerCase();
}

/**
 * Validate ask-time slices (labels + descriptions, keep option excluded by
 * the caller). Returns an error string or null.
 */
export function validateSplitSlices(slices) {
  if (!Array.isArray(slices) || slices.length < MIN_SPLIT_CHILDREN) {
    return `A split needs at least ${MIN_SPLIT_CHILDREN} proposed cards — fewer is one card with scopes, not a split.`;
  }
  if (slices.length > MAX_SPLIT_CHILDREN) {
    return `A split proposes at most ${MAX_SPLIT_CHILDREN} cards at once — group the rest and propose again.`;
  }
  const seen = new Set();
  for (const slice of slices) {
    const title = text(slice?.title ?? slice?.label);
    if (!title.trim()) return "Every proposed card needs a non-empty title.";
    if (!text(slice?.desc ?? slice?.description).trim()) {
      return `Proposed card "${title.trim()}" needs a scope description — an option without one is not a proposal.`;
    }
    const key = norm(title);
    if (seen.has(key)) return `Proposed card "${title.trim()}" is duplicated — titles must be distinct.`;
    seen.add(key);
  }
  return null;
}

/**
 * Decide what an answered proposal means. `selected` are the submitted
 * option labels (host-recorded). Returns { action, approved, reason }:
 * - "keep": the keep option was picked by itself (the alternate choice);
 * - "split": approved slices to create;
 * - "refuse": nothing actionable (empty, unknown labels).
 */
export function splitOutcome(slices, selected) {
  const titles = new Map((Array.isArray(slices) ? slices : []).map((slice) => [norm(slice?.title ?? slice?.label), slice]));
  const picks = Array.isArray(selected) ? selected.map((label) => text(label)).filter((label) => label.trim().length > 0) : [];
  const choseKeep = picks.some((label) => norm(label) === norm(SPLIT_KEEP_LABEL));
  if (choseKeep && picks.length > 1) {
    return { action: "refuse", approved: [], reason: `choose either delivery cards or "${SPLIT_KEEP_LABEL}", not both` };
  }
  if (choseKeep) {
    return { action: "keep", approved: [], reason: "the user chose to keep one card" };
  }
  if (picks.length === 0) {
    return { action: "refuse", approved: [], reason: "no slices were approved — answer the split question first" };
  }
  const unknown = picks.filter((label) => !titles.has(norm(label)));
  if (unknown.length > 0) {
    return { action: "refuse", approved: [], reason: `unknown options cannot become cards: ${unknown.join(", ")} — re-answer the split question` };
  }
  const approved = picks.map((label) => titles.get(norm(label)));
  return { action: "split", approved, reason: `${approved.length} approved ${approved.length === 1 ? "slice" : "slices"}` };
}

/**
 * Split the stored slices into approved vs remaining, for partial approval:
 * the parent archives only when nothing remains.
 */
export function splitRemainder(slices, approved) {
  const approvedKeys = new Set((Array.isArray(approved) ? approved : []).map((slice) => norm(slice?.title ?? slice?.label)));
  const remaining = (Array.isArray(slices) ? slices : []).filter((slice) => !approvedKeys.has(norm(slice?.title ?? slice?.label)));
  return { approved: Array.isArray(approved) ? approved : [], remaining, archiveParent: remaining.length === 0 };
}

export function splitStageError(stage) {
  return `Refused: this workflow is at \`${stage ?? "an unknown stage"}\`, past the split point. Splits happen at triage — past setup the card stays whole and scopes carry the breakdown.`;
}

/**
 * One eligibility rule for every split entry point (worker ask validation,
 * `split` executor, human trigger, card UI flag). Single source so the
 * button can never promise what `split` would refuse.
 */
export function splitEligibility({ kind, stage }) {
  if (kind !== "build") return { ok: false, error: SPLIT_NON_BUILD_ERROR };
  if (!SPLIT_STAGES.includes(stage)) return { ok: false, error: splitStageError(stage) };
  return { ok: true, error: null };
}

/**
 * Full trigger/UI state in one place: visibility (dumb UI reads `show`,
 * never re-implements stage rules) plus executability with the reason.
 */
export function splitActionState({ kind, stage, status, archived, openProposal, openQuestions, hasWorker = false }) {
  const show = kind === "build" && SPLIT_STAGES.includes(stage) && !archived && status !== "completed" && hasWorker;
  if (!show) return { show: false, ok: false, reason: null };
  const eligibility = splitEligibility({ kind, stage });
  if (!eligibility.ok) return { show: true, ok: false, reason: eligibility.error };
  if (openProposal) return { show: true, ok: false, reason: "A split proposal is already open on this card — answer it on the card." };
  if (Number(openQuestions) > 0) return { show: true, ok: false, reason: "A question is already pending on this card — answer it before proposing a split." };
  return { show: true, ok: true, reason: null };
}

/**
 * Pure match: which submitted answers belong to the open split proposal.
 * Matched by question text — answers to any OTHER question on the card
 * must never land in the split row (that corruption would read as user
 * approval for slices nobody picked).
 */
export function matchSplitDecision(proposalQuestion, decisions) {
  const wanted = text(proposalQuestion).trim();
  if (!wanted) return [];
  const flat = (Array.isArray(decisions) ? decisions : [])
    .filter((decision) => decision !== null && typeof decision === "object" && !Array.isArray(decision)
      && text(decision.question).trim() === wanted)
    .flatMap((decision) => (Array.isArray(decision.answers) ? decision.answers : []));
  return flat.filter((answer) => typeof answer === "string");
}

/**
 * Consequence disclosure for STANDARD questions at the split point. A
 * scope-picking question reads like a split decision but executes nothing —
 * the host appends this (like splitQuestionText enriches split asks) so no
 * future card repeats the ambiguity, regardless of worker wording.
 */
export const STANDARD_SPLIT_DISCLOSURE = "Note: this answer only sets scope inside this card — it creates no new cards. After answering, you can still use Propose split (triage/select) for one card per item.";

export function withStandardSplitDisclosure(question) {
  const base = text(question).trim();
  if (!base) return STANDARD_SPLIT_DISCLOSURE;
  if (base.includes(STANDARD_SPLIT_DISCLOSURE)) return base;
  return `${base}\n\n${STANDARD_SPLIT_DISCLOSURE}`;
}

/**
 * Host-owned recording shared by the live-answer and expired-answer paths:
 * a split proposal answered anywhere lands on the pending proposal row so
 * `bb stelow split` trusts the row, never a worker claim. Returns the
 * number of picked labels recorded (0 when nothing matched).
 */
export function recordSplitAnswer(db, cardId, decisions) {
  const proposal = db.prepare("SELECT question FROM split_proposals WHERE card_id = ? AND selected IS NULL").get(cardId);
  const picked = matchSplitDecision(proposal?.question, decisions);
  if (picked.length === 0) return 0;
  db.prepare("UPDATE split_proposals SET selected = ?, answered_at = ? WHERE card_id = ? AND selected IS NULL")
    .run(JSON.stringify(picked), Date.now(), cardId);
  return picked.length;
}
