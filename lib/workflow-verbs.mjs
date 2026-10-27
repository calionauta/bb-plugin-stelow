/**
 * The one table that says how an upstream workflow verb reaches the host.
 *
 * Two surfaces exist and they are not the same thing:
 *
 *   upstream  `scripts/stelow <verb>` — the methodology helper, present in the
 *             upstream repo, absent from a card workspace.
 *   host      `bb stelow <verb>` — what a worker can actually run.
 *
 * The host used to carry the mapping in three places: the helper allow-list
 * (`helper-verbs`), the CLI registry, and a prose clause that named four verbs.
 * The lists drifted twice — `next` was in the skills but not the host, `decide`
 * was a working command nobody could find in help — and a worker paid for it
 * with a refused turn.
 *
 * So every upstream verb is classified here exactly once:
 *
 *   helper    the host wraps the pinned helper (allow-list + passthrough)
 *   host      the host implements the same verb with card integration
 *   internal  no worker-facing command; the host owns the decision path
 *
 * `scripts/stelow <verb>` maps to `bb stelow <verb>` whenever `host` is not
 * null. A verb missing from this table is not a verb this host exposes, and the
 * prompt says so instead of inviting a guess.
 */
export const WORKFLOW_VERBS = Object.freeze({
  advance: Object.freeze({ host: "advance", surface: "helper" }),
  ask: Object.freeze({ host: "ask", surface: "host" }),
  "audit-trail": Object.freeze({ host: "audit-trail", surface: "helper" }),
  check: Object.freeze({ host: "check", surface: "helper" }),
  config: Object.freeze({ host: "config", surface: "helper" }),
  decide: Object.freeze({ host: "decide", surface: "host" }),
  doctor: Object.freeze({ host: "doctor", surface: "helper" }),
  // The host decides through its Decision API; a worker never calls the
  // helper's guard-judge directly, so advertising a verb would be a door with
  // nothing behind it.
  "guard-judge": Object.freeze({ host: null, surface: "internal" }),
  lock: Object.freeze({ host: "lock", surface: "helper" }),
  next: Object.freeze({ host: "next", surface: "helper" }),
  schema: Object.freeze({ host: "schema", surface: "helper" }),
  scope: Object.freeze({ host: "scope", surface: "helper" }),
  seed: Object.freeze({ host: "seed", surface: "host" }),
  status: Object.freeze({ host: "status", surface: "host" }),
  "sync-scopes": Object.freeze({ host: "sync-scopes", surface: "helper" }),
});

/** Verbs the host may pass to the pinned helper, in declaration order. */
export const HELPER_VERBS = Object.freeze(
  Object.entries(WORKFLOW_VERBS)
    .filter(([, entry]) => entry.surface === "helper")
    .map(([verb]) => verb),
);

/** Every upstream verb with a worker-facing host command. */
export const HOST_WORKFLOW_VERBS = Object.freeze(
  Object.entries(WORKFLOW_VERBS)
    .filter(([, entry]) => entry.host !== null)
    .map(([verb]) => verb),
);

/** Why an upstream verb has no host command. Empty when every verb has one. */
export function internalVerbReason(verb) {
  const entry = WORKFLOW_VERBS[verb];
  if (!entry || entry.host !== null) return null;
  return "the host decides through its Decision API; no worker-facing command exists";
}
