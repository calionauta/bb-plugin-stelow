/**
 * The helper verbs this host is allowed to call.
 *
 * One list, because the failure it prevents has a shape. The host called
 * `artifacts add` for a whole release cycle while the pinned helper answered
 * `unknown subcommand 'artifacts'` and exited 2. Nothing noticed, because the
 * host reaches the helper through one generic runner: at the call site, a verb
 * that does not exist is indistinguishable from a verb whose contract changed.
 *
 * So the runner refuses *before* spawning (`server/runtime/helper-script.ts`),
 * and two guards keep this list honest (`tests/helper-verbs.test.mjs`):
 *
 *   - every verb here is answered by the pinned binary;
 *   - a verb that is not here never reaches the helper.
 *
 * A third guard — a source scan over `server/` asserting every literal call
 * names a declared verb — was written and deleted on purpose: it is a
 * source-text pin, the class `tests/source-pins-guard.test.mjs` ratchets down.
 * The funnel is what covers a new call site, at first execution, with a refusal
 * that names the verb and the declared set.
 *
 * Adding a verb is therefore one deliberate edit, after proving the pinned
 * helper answers it — never a guess about what upstream meant to ship. Verbs the
 * helper supports and this host does not call (`ask`, `decide`, `seed`, `check`,
 * `guard-judge`, `status`) stay out on purpose: this is the set the host proved
 * it needs, not a mirror of the helper's dispatcher.
 */
export const HELPER = Object.freeze({
  advance: "advance",
  auditTrail: "audit-trail",
  config: "config",
  doctor: "doctor",
  lock: "lock",
  next: "next",
  schema: "schema",
  scope: "scope",
  syncScopes: "sync-scopes",
});

/** Every verb the host may pass to the helper, in the order this file declares. */
export const HOST_HELPER_VERBS = Object.freeze(Object.values(HELPER));

export function isDeclaredVerb(verb) {
  return typeof verb === "string" && HOST_HELPER_VERBS.includes(verb);
}

/**
 * The refusal for a verb the host never proved.
 *
 * It names the exit, like every other refusal in this repository: prove the
 * verb against the pinned helper and declare it, or fix the call site. A
 * refusal that only says "unknown" is one the reader learns to work around.
 */
export function undeclaredVerbRefusal(verb) {
  return [
    `stelow helper: '${String(verb)}' is not a declared host verb.`,
    `Declared: ${HOST_HELPER_VERBS.join(", ")}.`,
    "Prove the pinned helper answers it (`bash data/stelow <verb> --help`), then",
    "declare it in lib/helper-verbs.mjs — or fix the call site.",
  ].join(" ");
}
