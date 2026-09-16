/**
 * Stelow owns the portable audit trail: `scripts/stelow audit-trail build`
 * writes it and `check` re-derives it. The plugin never invents a second
 * format, so this module is the ONE place that decides what a host may
 * conclude from that output — which is what keeps the Build completion gate
 * and the card's freshness badge from disagreeing about the same file.
 *
 * Pure: every function takes the helper's own stdout, so the rules are unit
 * testable without spawning bash.
 */

/**
 * The projection shape this plugin knows how to read. Bumped upstream only
 * when `audit-trail.md` changes shape; a host that meets a newer one must
 * refuse rather than complete against a receipt it cannot interpret.
 */
export const AUDIT_TRAIL_CONTRACT = "v2";
/** The receipt's file name inside the workflow's state directory. */
export const AUDIT_TRAIL_FILE = "audit-trail.md";

/**
 * What this receipt is, next to the host's audit.md in the card's Audit group.
 * The CLI owns this projection and never registers its own output (it would
 * have to digest itself), so the host is the one that attributes and labels it.
 */
export const AUDIT_TRAIL_NOTE = "Portable receipt — workflow state, artifacts, worktree snapshot";

/** One helper JSON envelope, or null when the output is not a contract. */
export function parseAuditTrailResult(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.ok !== "boolean") return null;
  return parsed;
}

/** The most specific explanation a failed helper run offers. */
function helperFailure(run) {
  if (!run) return "The Stelow helper did not run.";
  const stderr = typeof run.stderr === "string" ? run.stderr.trim() : "";
  if (stderr) return stderr;
  if (run.code === null) return "The Stelow helper could not be started.";
  return `The Stelow helper exited ${run.code} without a readable result.`;
}

/**
 * What a host may conclude from one `build` or `check` run:
 *
 *   verified    — the projection is current and its shape is known
 *   changed     — its inputs moved (workflow state, artifacts, or worktree)
 *   missing     — it was never built
 *   refused     — the helper declined with a named reason (e.g. an
 *                 unregistered document under --strict)
 *   unsupported — a shape this plugin cannot read; never treat as verified
 *   unavailable — the helper failed without a readable result
 */
export function auditTrailOutcome(run, { contract = AUDIT_TRAIL_CONTRACT } = {}) {
  const result = parseAuditTrailResult(run?.stdout);
  if (!result) return { state: "unavailable", detail: helperFailure(run), result: null };
  if (result.contract !== contract) {
    // Either side can be the older one: the plugin ships a vendored helper and
    // the helper can be refreshed under a released plugin. Name both exits
    // instead of guessing which moved.
    const fix = `Update this plugin, or pin the vendored Stelow helper to one that declares "${contract}".`;
    return {
      state: "unsupported",
      detail: typeof result.contract === "string"
        ? `${AUDIT_TRAIL_FILE} uses audit-trail contract "${result.contract}", which this plugin cannot read (it reads "${contract}"). ${fix}`
        : `${AUDIT_TRAIL_FILE} reports no audit-trail contract version, which this plugin cannot read (it reads "${contract}"). ${fix}`,
      result,
    };
  }
  if (result.ok === true) return { state: "verified", detail: null, result };
  const message = typeof result.error === "string" ? result.error.trim() : "";
  if (/is missing/i.test(message)) return { state: "missing", detail: message || helperFailure(run), result };
  // "stale" is the helper's word for "these inputs changed since it was built".
  if (/stale/i.test(message)) return { state: "changed", detail: message, result };
  // A refusal is a decision, not a crash: the helper named what must change.
  if (message) return { state: "refused", detail: message, result };
  return { state: "unavailable", detail: helperFailure(run), result };
}

function shortSha(value) {
  return typeof value === "string" && value.length > 12 ? value.slice(0, 12) : String(value ?? "");
}

/**
 * The Build completion gate. Two independent things must hold at once:
 *
 * 1. the trail builds and re-validates under a contract this host reads, and
 * 2. the receipt's own snapshot names the same repository and commit the host
 *    verified — otherwise the portable trail and the audit receipt would
 *    attest two different trees, and Done would carry evidence for neither.
 *
 * `verifiedGit` is the host's freshly sampled Git evidence (lib/audit-verification
 * already binds that to the test run); sampling it again is the caller's job,
 * so a checkout that moved while the trail was written fails here.
 */
export function auditTrailGate({ build, check, verifiedGit, contract = AUDIT_TRAIL_CONTRACT } = {}) {
  const built = auditTrailOutcome(build, { contract });
  if (built.state === "unsupported") return { ready: false, error: built.detail, trailer: null };
  if (built.state !== "verified") {
    return { ready: false, error: `Could not generate the portable audit trail (${built.state}). ${built.detail}`, trailer: null };
  }
  const checked = auditTrailOutcome(check, { contract });
  if (checked.state !== "verified") {
    return { ready: false, error: `The portable audit trail did not validate (${checked.state}). ${checked.detail}`, trailer: null };
  }
  const snapshot = checked.result?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { ready: false, error: `The portable audit trail reported no repository snapshot. Re-run \`bb stelow done\`; if this repeats, update the vendored Stelow helper.`, trailer: null };
  }
  const head = typeof snapshot.head === "string" ? snapshot.head : "";
  const root = typeof snapshot.root === "string" ? snapshot.root : "";
  if (verifiedGit?.headSha && head !== verifiedGit.headSha) {
    return {
      ready: false,
      error: `The audit trail attests HEAD ${shortSha(head)} but this card's audit receipt was verified at ${shortSha(verifiedGit.headSha)}. The checkout moved during completion. Re-run the audit, then done.`,
      trailer: null,
    };
  }
  if (verifiedGit?.gitRoot && root && root !== verifiedGit.gitRoot) {
    return {
      ready: false,
      error: `The audit trail attests the repository at ${root} but the verified checkout is ${verifiedGit.gitRoot}. Completion is blocked so a Done card cannot carry evidence for a different checkout.`,
      trailer: null,
    };
  }
  return {
    ready: true,
    error: null,
    trailer: {
      head: head || null,
      root: root || null,
      artifacts: typeof checked.result.artifacts === "number" ? checked.result.artifacts : null,
      path: typeof checked.result.path === "string" ? checked.result.path : null,
      contract: checked.result.contract,
    },
  };
}
