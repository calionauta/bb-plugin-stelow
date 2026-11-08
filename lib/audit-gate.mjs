/**
 * The boundary gate: the four instruments that keep the upstream contract true,
 * run as one command that fails closed.
 *
 * The audit that produced this module found two blockers and both were caught by
 * an instrument that already existed and simply did not run next to the other
 * one. `check:pin-provenance` proves the pin is a commit upstream released;
 * `test:upstream-drift` proves the vendored tree equals that pin;
 * `test/helper-verbs` proves the verbs the host calls exist in the pin; and
 * `test/workflow-moves` proves the transition projection agrees with the helper
 * on the same inputs. Each one alone is honest about one axis and silent about
 * the others — a tree can match a pin that was never released, and a released
 * pin can drop the verb the host calls.
 *
 * Pure by construction: this module decides what "green" means and how a failure
 * reads. Running the commands, printing, and exiting is
 * `scripts/stelow-audit.mjs`, which is thin on purpose — the part worth testing
 * is the part with the verdict in it.
 */

/**
 * The instruments, in the order they read.
 *
 * `network: true` means the instrument asks GitHub; it is the one that cannot
 * run on a plane, and the reason `--offline` exists. Ordering is deliberate:
 * the offline instruments first, so an offline or misconfigured machine fails
 * for a reason it can fix before waiting on a network call.
 */
export const GATE_INSTRUMENTS = Object.freeze([
  Object.freeze({
    id: "drift",
    label: "vendored tree equals the pin",
    command: Object.freeze(["npm", "run", "--silent", "test:upstream-drift"]),
    network: false,
  }),
  Object.freeze({
    id: "verbs",
    label: "every declared helper verb is answered by the pin",
    command: Object.freeze(["npm", "run", "--silent", "test:helper-verbs"]),
    network: false,
  }),
  Object.freeze({
    id: "moves",
    label: "transition projection agrees with the helper",
    command: Object.freeze(["node", "tests/workflow-moves.test.mjs"]),
    network: false,
  }),
  Object.freeze({
    id: "provenance",
    label: "the pin is a commit upstream released",
    command: Object.freeze(["npm", "run", "--silent", "check:pin-provenance"]),
    network: true,
  }),
]);

/**
 * The instruments to run.
 *
 * `offline` drops the ones that need the network and names them in the summary,
 * so a local run cannot report the same green a CI run reports. The gate never
 * silently narrows: whatever it drops, it says it dropped.
 */
export function planGate({ offline = false } = {}) {
  const planned = offline ? GATE_INSTRUMENTS.filter((entry) => !entry.network) : [...GATE_INSTRUMENTS];
  const skipped = offline ? GATE_INSTRUMENTS.filter((entry) => entry.network).map((entry) => entry.id) : [];
  return { planned, skipped };
}

/** One instrument's verdict, from the exit code the command actually returned. */
export function instrumentResult(instrument, code) {
  const exitCode = typeof code === "number" ? code : 1;
  return {
    id: instrument.id,
    label: instrument.label,
    code: exitCode,
    status: exitCode === 0 ? "pass" : "fail",
  };
}

/**
 * The verdict over every result.
 *
 * Fail-closed in the only way that matters: a result that is not an explicit
 * pass counts as a failure, so a crashed runner, a timeout and a thrown assert
 * all read the same as a red instrument. `skipped` is carried through rather
 * than folded into `ok`, because "not verified" and "verified green" are
 * different claims and the summary has to keep them apart.
 */
export function summarize(results, { skipped = [] } = {}) {
  const list = Array.isArray(results) ? results : [];
  const failed = list.filter((result) => result?.status !== "pass").map((result) => String(result?.id ?? "unknown"));
  const passed = list.filter((result) => result?.status === "pass").map((result) => String(result.id));
  return { ok: failed.length === 0, passed, failed, skipped: [...skipped] };
}

/** The exit code for a summary: zero only when every planned instrument passed. */
export function exitCodeFor(summary) {
  return summary?.ok === true ? 0 : 1;
}

/** One printed line per result, aligned so a failure is the line you see first. */
export function renderLine(result) {
  const mark = result.status === "pass" ? "PASS" : "FAIL";
  const code = `exit ${String(result.code)}`.padEnd(9);
  return `${mark}  ${code}${result.label} (${result.id})`;
}

/** The closing line: green only when nothing was skipped. */
export function renderSummary(summary) {
  const skipped = summary?.skipped ?? [];
  if (!summary?.ok) {
    const failed = summary?.failed ?? [];
    return `boundary gate: RED — ${failed.length > 0 ? failed.join(", ") : "no verdict"} failed`;
  }
  if (skipped.length > 0) {
    return `boundary gate: GREEN, but ${skipped.join(", ")} not verified (--offline)`;
  }
  return `boundary gate: GREEN — ${summary.passed.length} instrument(s) passed`;
}
