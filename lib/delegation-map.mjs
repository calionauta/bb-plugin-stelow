/**
 * Delegation registry: every LLM/thread contact point in one place.
 *
 * Each entry names the site, its tier, how its preset resolves, which
 * spawn path it takes, whether it writes, and who judges its output.
 * Worker spawns are registered but routed by their own cascade
 * (getReliablePresetForBand) — the registry documents them, it does not
 * rewire them. Disposable spawns validate through assertDisposableSpawn
 * before any SDK call: unknown site, visible spawn, or full permission
 * throws (fail fast). A new spawn site without a marker comment
 * (`// delegation-site: <site>`) fails the topology pin in
 * tests/delegation-map.test.mjs.
 */

export const DELEGATION_TIERS = ["generation", "reliable", "review", "preset"];

export const DELEGATION_SITES = [
  {
    site: "draft-burst",
    tier: "generation",
    spawn: "disposable",
    presetSource: "generation_preset designation → band fallback (resolveDraftPreset)",
    writes: false,
    judgedBy: "card worker judges 100% before use",
  },
  {
    site: "card-title",
    tier: "generation",
    spawn: "disposable",
    presetSource: "generation_preset designation → band fallback (resolveDraftPreset)",
    writes: "display_name only",
    judgedBy: "user renames inline; heuristic stays on failure",
  },
  {
    site: "review",
    tier: "review",
    spawn: "disposable",
    presetSource: "review_preset singleton, refuse-no-fallback",
    writes: false,
    judgedBy: "human via fingerprint policy",
  },
  {
    site: "preset-judge",
    tier: "preset",
    spawn: "direct",
    presetSource: "decision point presetId",
    writes: false,
    judgedBy: "confidence floor (routeAt)",
  },
  {
    site: "worker-spawn",
    tier: "reliable",
    spawn: "direct",
    presetSource: "card pin > reliable override > band > default",
    writes: true,
    judgedBy: "boards, gates, done",
  },
];

export function getDelegationSite(site) {
  const entry = DELEGATION_SITES.find((candidate) => candidate.site === site);
  if (!entry) {
    throw new Error(`Unknown delegation site "${site}". Register it in lib/delegation-map.mjs.`);
  }
  return entry;
}

// Pure guardrails for disposable spawns (no bb dependency, unit-tested).
// Throws before any SDK call: unknown site, non-hidden visibility, or full
// permission. Disposables read, never write — a site needing tools or
// writes is not disposable and must not route here.
export function assertDisposableSpawn({ site, args }) {
  const entry = getDelegationSite(site);
  if (entry.spawn !== "disposable") {
    throw new Error(`Delegation site "${site}" spawns ${entry.spawn}, not disposable — do not route it through spawnDisposable.`);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`Delegation site "${site}" needs a spawn args object.`);
  }
  if (args.visibility !== "hidden") {
    throw new Error(`Delegation site "${site}" must spawn hidden — visible disposables leak worker internals.`);
  }
  if (args.permissionMode === "full") {
    throw new Error(`Delegation site "${site}" must not spawn with full permission — disposables read, never write.`);
  }
  return args;
}
