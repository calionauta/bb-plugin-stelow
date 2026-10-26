/**
 * The route a card is expected to walk, and how to read the helper's refusal.
 *
 * `transition-totality` proves the table has no dead ends and `workflow-moves`
 * proves the panel and the helper agree about which move is legal. Neither asks
 * the question a person actually has — *can a card get from triage to audit
 * using only what the workflow says it needs* — and neither reads a refusal to
 * see whether it names a way out.
 *
 * So this module owns the two pure projections the walk needs:
 *
 *   - `plannedRoute` is the stage order a card of a given intent should follow
 *     in a given review mode, computed from the same catalog the helper parses
 *     (route minus the stages that mode does not run).
 *   - `refusalKind` / `refusalDoor` classify the helper's stderr. A refusal is
 *     the workflow talking back, and the repository's rule is that it always
 *     names a valid exit. A refusal that does not is a deadlock with a good
 *     error message, which is why it is counted rather than trusted.
 *
 * Nothing here spawns a process or reads a file: the driver in
 * `tests/helpers/workflow-walk-driver.mjs` does that, and `.auto/measure.sh`
 * reuses both so the conformance number in the loop is the number CI gates.
 */
import { INTENT_ROUTES, stagesAbsentByPolicy } from "./workflow-moves.mjs";
import { WORKFLOW_ROUTES } from "./workflow-catalog.mjs";

export const WALK_INTENTS = Object.freeze(Object.keys(INTENT_ROUTES));
export const WALK_MODES = Object.freeze(Object.keys(WORKFLOW_ROUTES.review_modes ?? {}));

/** Stages that never run under this review mode + policy, for one intent. */
function absentStages({ intent, reviewMode, quality, explorationCount }) {
  const route = INTENT_ROUTES[intent] ?? [];
  const modeSkips = WORKFLOW_ROUTES.review_modes?.[reviewMode]?.skipped ?? [];
  const policySkips = stagesAbsentByPolicy({
    review_mode: reviewMode,
    quality,
    exploration_count: explorationCount,
  });
  return new Set([...modeSkips, ...policySkips].filter((stage) => route.includes(stage)));
}

/**
 * The stage order the card should follow, or `null` for an unknown intent or
 * review mode — never an invented route. The helper refuses an unknown review
 * mode outright, so returning an empty route here would make the walk look
 * complete while checking nothing.
 */
export function plannedRoute({ intent, reviewMode, quality = "production", explorationCount = 3 } = {}) {
  const route = INTENT_ROUTES[intent];
  if (!Array.isArray(route)) return null;
  if (!WORKFLOW_ROUTES.review_modes?.[reviewMode]) return null;
  const absent = absentStages({ intent, reviewMode, quality, explorationCount });
  return route.filter((stage) => !absent.has(stage));
}

/** The move a walk takes from `stage`: the next stage on the planned route. */
export function forwardTarget(route, stage) {
  const index = route.indexOf(stage);
  if (index < 0) return null;
  return route[index + 1] ?? null;
}

/** Every refusal the helper can produce that the walk has a rule for. */
export const REFUSAL_KINDS = Object.freeze([
  "missing-artifact",
  "policy-skip",
  "unknown-mode",
  "off-route",
  "artifact-invalid",
  "other",
]);

const DOOR_PATTERNS = {
  artifact: /missing required artifact: (\S+)/,
  redirect: /advance directly to ([a-z][a-z0-9-]*) instead/,
  allowed: /\(allowed: ([^)]*)\)/,
  known: /\(known: ([^)]*)\)/,
  file: /([^\s:]+\.(?:json|md|ya?ml)):/,
};

/** Which rule refused the advance. The order matters: a message can mention
 * an artifact AND a policy, and the policy is the reason the advance stopped. */
export function refusalKind(text) {
  const message = String(text ?? "");
  if (/unknown review_mode/.test(message)) return "unknown-mode";
  if (/is skipped in .* review mode|does not run under this workflow's policy/.test(message)) return "policy-skip";
  if (/missing required artifact:/.test(message)) return "missing-artifact";
  if (/invalid transition /.test(message)) return "off-route";
  if (/breadboard check failed|contract — /.test(message)) return "artifact-invalid";
  return "other";
}

/**
 * The exit a refusal names, or `null` when it names none.
 *
 * The doors are the ways the helper can be satisfied: write the missing
 * artifact, advance to the stage it redirected to, pick one of the allowed
 * targets, use one of the known review modes, or fix the file whose contract it
 * rejected. Anything else returning `null` is the deadlock this counts.
 */
export function refusalDoor(text) {
  const message = String(text ?? "");
  const kind = refusalKind(message);
  if (kind === "policy-skip") {
    const redirect = message.match(DOOR_PATTERNS.redirect)?.[1];
    return redirect ? { kind, door: redirect } : { kind, door: null };
  }
  if (kind === "off-route") {
    const allowed = splitList(message.match(DOOR_PATTERNS.allowed)?.[1]);
    return allowed.length ? { kind, door: allowed } : { kind, door: null };
  }
  if (kind === "unknown-mode") {
    const known = splitList(message.match(DOOR_PATTERNS.known)?.[1]);
    return known.length ? { kind, door: known } : { kind, door: null };
  }
  if (kind === "missing-artifact") {
    const artifact = message.match(DOOR_PATTERNS.artifact)?.[1];
    return artifact ? { kind, door: artifact } : { kind, door: null };
  }
  if (kind === "artifact-invalid") {
    // The contract reader prints `<file>: contract — <violation>`, so the door
    // is the file. A contract error that names no file has no exit to offer,
    // and inventing one (a truncated message) is how a tautological cell passes.
    const file = message.match(DOOR_PATTERNS.file)?.[1];
    return file ? { kind, door: file } : { kind, door: null };
  }
  return { kind, door: null };
}

function splitList(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** Convenience for the counter: does this refusal name a way out? */
export function refusalNamesDoor(text) {
  return refusalDoor(text).door !== null;
}
