/**
 * Skill criteria blocks. Upstream playbooks carry Completeness contracts in
 * prose; a mirrored fenced `criteria:` block lists the same minima as
 * machine-readable items (id, kind, text). Kinds: presence/count route to
 * the existing deterministic validators; semantic routes to one Score
 * question each via the Decision API (advisory until calibrated — see
 * skills-criteria-plan.md). Pure parsing (no host dependency); the caller
 * supplies file text, so sync pipelines and tests feed fixtures directly.
 *
 * Consumers: Phase 2 verify-advisory output (planned). Until then this
 * module is the tested contract the consumer will be pinned against.
 */

export const SKILL_CRITERION_KINDS = ["presence", "count", "semantic"];

// Parse the first `criteria:` list in a markdown file. Malformed items
// (missing id/kind/text, unknown kind) are skipped, never thrown;
// duplicate ids keep the first occurrence. Returns [] when absent.
export function parseCriteriaBlock(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "criteria:");
  if (start < 0) return [];
  const items = [];
  const seen = new Set();
  let current = null;
  const flush = () => {
    if (current && current.id && SKILL_CRITERION_KINDS.includes(current.kind) && current.text && !seen.has(current.id)) {
      seen.add(current.id);
      items.push({ id: current.id, kind: current.kind, text: current.text });
    }
    current = null;
  };
  for (const line of lines.slice(start + 1)) {
    const itemMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (itemMatch) {
      flush();
      current = { id: itemMatch[1], kind: "", text: "" };
      continue;
    }
    if (!current) {
      if (line.trim() !== "") break;
      continue;
    }
    const kindMatch = line.match(/^\s*kind:\s*(.+?)\s*$/);
    if (kindMatch) {
      current.kind = kindMatch[1];
      continue;
    }
    const textMatch = line.match(/^\s*text:\s*["']?(.+?)["']?\s*$/);
    if (textMatch) {
      current.text = textMatch[1];
      continue;
    }
    if (line.trim() === "") continue;
    flush();
    break;
  }
  flush();
  return items;
}

export function groupCriteriaByKind(items) {
  const groups = { presence: [], count: [], semantic: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (Object.hasOwn(groups, item?.kind)) groups[item.kind].push(item);
  }
  return groups;
}

// One atomic Score per semantic criterion (Autorubric: separate calls avoid
// conflation). Fixed 3-level anchors quoting the criterion — calibration
// refines anchors per criterion later; the question always names its id.
export function semanticCriterionToScore(criterion) {
  const text = typeof criterion?.text === "string" && criterion.text.length > 0 ? criterion.text : "the stated criterion";
  return {
    [`criterion:${criterion?.id ?? "unknown"}`]: {
      type: "score",
      instructions: `Judge ONLY this criterion against the artifact excerpt: ${text}`,
      criteria: ["Not met", "Partially met", "Clearly met"],
    },
  };
}
