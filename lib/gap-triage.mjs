/**
 * Gap-triage judge input (pure, no I/O, no model judgment).
 *
 * The worker classified the critique's gaps; the triage judge second-opinions
 * only the classification ("genuine gap needing a rework scope?"), never the
 * routing (the impact×effort matrix stays deterministic). Split out of
 * gap-registry.mjs: shaping one atomic Score per description is a different
 * capability from parsing and validating the registry, with a different
 * reason to change.
 */

// Triage batch for escalated-gap candidates (pure): one atomic Score per
// description — "genuine gap needing a rework scope?" — plus the items and
// keyed questions a Score judge needs. Ids are synthesized once here, so
// the question keys and the reported items cannot drift apart. The worker
// classified these gaps; the judge second-opinions only the classification,
// never the routing (the impact×effort matrix stays deterministic).
export function gapsToTriageBatch(gaps) {
  const list = Array.isArray(gaps) ? gaps : [];
  const items = [];
  const questions = {};
  list.forEach((gap, index) => {
    const description = gap && typeof gap === "object" && typeof gap.description === "string"
      ? gap.description.trim()
      : "";
    if (!description) return;
    const id = typeof gap.id === "string" && gap.id.length > 0 ? gap.id : `gap-${index + 1}`;
    items.push({ id, name: description, text: description });
    questions[`gap:${id}`] = {
      type: "score",
      instructions: `Is this a genuine gap requiring a rework scope? ${description}`,
      criteria: ["Not a gap", "Unclear", "Genuine gap"],
    };
  });
  return { items, questions };
}

// Evidence budget for the triage judge: the critique's own text, capped so
// one long registry cannot crowd out the diff that follows it.
export const GAP_TRIAGE_CRITIQUE_CHARS = 6000;

// Judge state for gap triage (pure): the judgment is "is this a genuine
// gap?", which cannot be answered from the gap's wording alone — the judge
// needs the critique that claimed it AND the working-tree diff that shows
// whether the code still has them. Missing pieces degrade to the empty
// string, so a non-Git workspace still gets a (weaker) judgment instead of
// a hard failure.
export function buildGapTriageState(options) {
  const { critiqueText, diff } = options && typeof options === "object" ? options : {};
  const parts = [];
  const critique = typeof critiqueText === "string" ? critiqueText.trim() : "";
  if (critique) parts.push(`Execution critique:\n${critique.slice(0, GAP_TRIAGE_CRITIQUE_CHARS)}`);
  const patch = typeof diff === "string" ? diff.trim() : "";
  if (patch) parts.push(`Working-tree diff:\n${patch}`);
  return parts.join("\n\n");
}
