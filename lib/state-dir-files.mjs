/**
 * The fixed-name files a card's state dir holds, so the host can name them
 * instead of letting a worker search for them.
 *
 * This is the other half of remaining-fragility #6 in
 * `docs/rfc-worker-robustness.md`: the host knows the exact paths, so it should
 * tell. `bb stelow playbook` already names the state file, the playbook skills
 * and (now) the current run; what it never named were the receipts and maps
 * that live at a KNOWN name in a KNOWN directory — and workers were rebuilding
 * those paths from memory. Measured on this host: 23 `audit-trail` commands
 * across the live threads, several of them reconstructing
 * `.stelow/<date>/sw-card_<id>/audit-trail.md` by hand, and one `find` for a
 * `recon-receipt.json` whose recipe declares it under `context/`.
 *
 * Convention over configuration: the name is the identity, so this is a list of
 * names, not a discovery mechanism. Nothing here may be guessed — a path the
 * host names wrongly is worse than the search it replaces, because the worker
 * stops looking.
 */

/**
 * Receipts and maps that live directly in the card's state dir at a fixed name.
 *
 * `conditional` says whether a card may legitimately not have the file:
 * `state.md` never does (its absence is a broken install, which `playbook`
 * already reports), while `audit-trail.md` only exists once the portable trail
 * has been built. A conditional entry is therefore named WITHOUT a
 * missing-file verdict.
 */
export const STATE_DIR_FILES = [
  { name: "state.md", label: "state", conditional: false },
  { name: "session.log", label: "session-log", conditional: true },
  { name: "audit.md", label: "audit", conditional: true },
  { name: "audit-trail.md", label: "audit-trail", conditional: true },
  { name: "invariants.json", label: "invariants", conditional: true },
  { name: "scope-map.json", label: "scope-map", conditional: true },
];

/**
 * Fixed-name files that live in a subdirectory of the state dir rather than at
 * its root. Kept separate so the root list stays a plain "these sit here".
 *
 * `context/recon-receipt.json` is the one file in the measured runs that a
 * recipe writes but does not declare, so naming it here is the only way the
 * worker is ever told it exists. The four gate receipts are named for the same
 * reason at one remove: their names live in `server/runtime/gate-vocabulary.ts`
 * (`GATES`), which the board reads to decide a card is "approved" while the
 * worker writes the same file from memory. `tests/state-dir-files.test.mjs`
 * pins that this list and `GATES` cannot drift apart.
 */
export const STATE_SUBDIR_FILES = [
  { path: "context/recon-receipt.json", label: "recon-receipt", conditional: true },
  { path: "gate-approved.md", label: "gate-receipt", conditional: true },
  { path: "int-gate-approved.md", label: "int-gate-receipt", conditional: true },
  { path: "plan-gate-approved.md", label: "plan-gate-receipt", conditional: true },
  { path: "diff-gate-approved.md", label: "diff-gate-receipt", conditional: true },
];

/**
 * The subdirectories a card's state dir may contain, in the order a worker is
 * likely to want them.
 *
 * Naming files fixed the "where is X" half; this fixes the "what is even in
 * here" half, which was the larger count: 108 commands across the live threads
 * were `ls -la` / `find -type f` purely to enumerate a state or run directory.
 * A worker that is told the layout does not need to enumerate it.
 *
 * Every entry is optional by nature — a card earns `critiques/` only once it
 * critiques — so none of these is ever reported missing. The list is the union
 * of every subdirectory measured across the 44 state dirs on this host and every
 * top-level directory a recipe declares in `tasks[].output`, so it is derived
 * from both sides rather than from whichever card happened to run first.
 * `tests/state-dir-files.test.mjs` pins that both sources stay covered.
 */
export const STATE_DIR_SUBDIRS = [
  "runs",
  "context",
  "plans",
  "critiques",
  "interfaces",
  "audit",
  "audits",
  "verification",
  "architecture",
  "execution",
  "recon",
  "strategic",
  "diagnosis",
  "spikes",
  "group-context",
  "scopes",
  "locks",
  "approvals",
];

/**
 * The fixed-name entries for one card, as playbook rows.
 *
 * Returns `{ label, path, missing }` triples in the same shape `playbookEntries`
 * uses, so the caller can append them without a second render path. A
 * conditional entry is never reported as missing: the file appearing later is
 * the normal case, not a broken install, and a verdict here would train the
 * worker to ignore the verdict that is real.
 */
export function stateDirFileEntries(stateDir, exists) {
  if (!stateDir) return [];
  const root = stateDir.replace(/[/\\]+$/, "");
  const entries = [];
  for (const file of STATE_DIR_FILES) {
    const path = `${root}/${file.name}`;
    entries.push({
      label: file.label,
      path,
      missing: file.conditional ? false : !exists(path),
    });
  }
  for (const file of STATE_SUBDIR_FILES) {
    entries.push({ label: file.label, path: `${root}/${file.path}`, missing: false });
  }
  return entries;
}

/**
 * The state dir's subdirectories, as two rows rather than one per directory.
 *
 * A dozen rows would bury the files above them, which are what the worker
 * actually reads. Two lines — the whole set, then the path prefix every entry
 * in it shares — gives the layout without the noise. Absent directories are not
 * called out: the reason to name them is to stop an enumeration, and an
 * enumeration of "which of my future directories exist yet" is not a question
 * worth answering.
 */
/**
 * Workspace-root files the host owns that are not in the state dir.
 *
 * `stelow.json` is the machine-desired workflow record the tracking contracts
 * already cite as `stelow.json#workflows`; it sits at the workspace root, not in
 * the state dir, so it needs its own row. Named from the workspace path the
 * caller passes, and omitted when that path is unknown rather than guessed.
 */
export function workspaceFileEntries(workspaceRoot) {
  if (!workspaceRoot) return [];
  const root = workspaceRoot.replace(/[/\\]+$/, "");
  return [{ label: "workflow-record", path: `${root}/stelow.json`, missing: false }];
}

export function stateDirSubdirEntries(stateDir) {
  if (!stateDir) return [];
  const root = stateDir.replace(/[/\\]+$/, "");
  return [
    {
      label: "state dirs",
      path: `${root}/{${STATE_DIR_SUBDIRS.join(",")}}`,
      missing: false,
    },
  ];
}
