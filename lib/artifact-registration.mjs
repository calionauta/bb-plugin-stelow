/**
 * Host-side artifact registration: the copies a validated native run needs, and
 * the receipt that proves they were made.
 *
 * A native run writes into staging (`<stateDir>/runs/<exec id>/…`); the card
 * reads artifacts from `<stateDir>/…`. The host validated the staged files and
 * knows which ones the recipe requires — and it then asked the *model* to `cp`
 * them and write a receipt. That is a deterministic filesystem operation
 * delegated to the most expensive component in the system, and the measured
 * cost was the whole reconciliation dance: workers ran `find <run> -type f`,
 * then a `for` loop of `cp`, then `printf` the receipt, 184 of 225 run-dir
 * commands being enumeration of a directory whose contents the host already had.
 *
 * So the host does the copy. This module is the pure half: given the run and the
 * required paths it decides exactly which copies to make and what the receipt
 * says. No I/O, so the plan is testable without a filesystem.
 */

/** Where a staged artifact is copied to, or null when the root is not staging. */
export function canonicalArtifactPath(artifactRoot, relative) {
  if (typeof artifactRoot !== "string" || typeof relative !== "string") return null;
  // Staging is `<stateDir>/runs/<exec id>`; the canonical home is the same
  // relative path under `<stateDir>`. Derived, never guessed: a wrong target
  // sends the worker to the wrong file with full confidence.
  const staging = /^(.*)[/\\]runs[/\\][^/\\]+$/.exec(artifactRoot);
  if (!staging) return null;
  return `${staging[1]}/${relative}`.replace(/\/{2,}/g, "/");
}

/**
 * The copies one validated run implies, in recipe order.
 *
 * A path whose canonical home cannot be derived is reported in `unresolved`
 * rather than silently dropped: a run that would lose an artifact must fail
 * loudly, not half-register.
 */
export function registrationPlan(artifactRoot, paths) {
  const copies = [];
  const unresolved = [];
  for (const path of Array.isArray(paths) ? paths : []) {
    if (typeof path !== "string" || path.length === 0) continue;
    const to = canonicalArtifactPath(artifactRoot, path);
    if (!to) {
      unresolved.push(path);
      continue;
    }
    copies.push({ from: `${artifactRoot}/${path}`.replace(/\/{2,}/g, "/"), to, relative: path });
  }
  return { copies, unresolved };
}

/**
 * The receipt recording what was registered.
 *
 * Same shape the worker used to `printf` by hand, so an install mid-flight and a
 * reader of the old receipt both keep working: `{ runId, outputs }`. Written
 * only after every copy succeeded, so its presence means the work is done.
 */
export function registrationReceipt(runId, paths) {
  return `${JSON.stringify({ runId, outputs: paths }, null, 2)}\n`;
}

/** Where that receipt lives: inside the run's staging root. */
export function registrationReceiptPath(artifactRoot) {
  if (typeof artifactRoot !== "string" || artifactRoot.length === 0) return null;
  return `${artifactRoot.replace(/[/\\]+$/, "")}/.registered.json`;
}
