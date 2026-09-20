/**
 * Golden-set agreement for semantic criteria. Humans label artifacts
 * (met/unmet per criterion); the judge scores the same files; Cohen's
 * kappa per criterion decides keep (≥0.6), repair, or drop. Pure functions
 * over file text — the CLI resolves workspace paths, never this module.
 *
 * Golden file format (English, line-scanned like criteria blocks):
 *   # Golden: <name>
 *   skill: <skill-id>
 *   judgments:
 *     <criterion-id>: met|unmet
 *   ---
 *   <artifact text>
 * Malformed files skip with a listed reason, never a throw — one bad
 * label must not invalidate the whole set.
 */

export const GOLDEN_KEEP_KAPPA = 0.6;
export const GOLDEN_DROP_KAPPA = 0.2;
export const GOLDEN_MIN_N = 5;

// Parse one golden file. Returns { ok, name, skill, judgments, artifact }
// or { ok: false, reason } for malformed files.
export function parseGoldenFile(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty file" };
  const lines = text.split("\n");
  const sepAt = lines.findIndex((line) => line.trim() === "---");
  if (sepAt < 0) return { ok: false, reason: "missing --- separator between judgments and artifact" };
  const head = lines.slice(0, sepAt);
  const artifact = lines.slice(sepAt + 1).join("\n").trim();
  if (!artifact) return { ok: false, reason: "empty artifact body" };
  const nameLine = head.find((line) => line.startsWith("# Golden:"));
  const skillLine = head.find((line) => line.startsWith("skill:"));
  const skill = skillLine ? skillLine.slice("skill:".length).trim() : "";
  if (!skill) return { ok: false, reason: "missing skill: header" };
  const judgments = {};
  const judgmentsAt = head.findIndex((line) => line.trim() === "judgments:");
  if (judgmentsAt >= 0) {
    for (const line of head.slice(judgmentsAt + 1)) {
      const match = line.match(/^\s{2}(\S+):\s*(met|unmet)\s*$/);
      if (match) judgments[match[1]] = match[2];
      else if (line.trim() !== "") break;
    }
  }
  if (Object.keys(judgments).length === 0) return { ok: false, reason: "no met/unmet judgments" };
  return {
    ok: true,
    name: nameLine ? nameLine.slice("# Golden:".length).trim() : "unnamed",
    skill,
    judgments,
    artifact,
  };
}

// Cohen's kappa over paired binary labels. Abstentions (unverifiable)
// never enter the pairs — they report separately as abstention rate.
export function cohenKappa(pairs) {
  const rows = Array.isArray(pairs) ? pairs.filter((pair) => pair && (pair.human === "met" || pair.human === "unmet") && (pair.model === "met" || pair.model === "unmet")) : [];
  const n = rows.length;
  if (n === 0) return { n: 0, agreement: null, kappa: null };
  const agree = rows.filter((pair) => pair.human === pair.model).length;
  const agreement = agree / n;
  const pHumanMet = rows.filter((pair) => pair.human === "met").length / n;
  const pModelMet = rows.filter((pair) => pair.model === "met").length / n;
  const expected = pHumanMet * pModelMet + (1 - pHumanMet) * (1 - pModelMet);
  const kappa = expected >= 1 ? (agreement >= 1 ? 1 : 0) : (agreement - expected) / (1 - expected);
  return { n, agreement, kappa };
}

// Per-criterion verdict from a kappa report: keep, repair, or drop.
// Below MIN_N the verdict is always repair (more labels first) — small
// samples never condemn a criterion.
export function goldenVerdict(report) {
  if (!report || typeof report.n !== "number" || report.n < GOLDEN_MIN_N) return "repair";
  if (typeof report.kappa !== "number") return "repair";
  if (report.kappa >= GOLDEN_KEEP_KAPPA) return "keep";
  if (report.kappa < GOLDEN_DROP_KAPPA) return "drop";
  return "repair";
}
