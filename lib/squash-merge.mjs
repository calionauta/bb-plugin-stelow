// Local squash-merge executed through a BB terminal. Pure and host-neutral:
// BB's SDK exposes no local squash action (only `gh pr merge --squash` via
// the PR merge), so the panel runs `git merge --squash` in the card's own
// environment shell — the same pattern as the push/sync terminals — and this
// module owns the script shape plus the marker parsing both sides agree on.
// Unit-tested in tests/squash-merge.test.mjs.

/** Reported once the script reaches its verdict, before the restore checkout. */
export const SQUASH_EXIT_MARKER = "STELOW_SQUASH_EXIT";
/** Reported with the new HEAD when the verdict is success. */
export const SQUASH_SHA_MARKER = "STELOW_SQUASH_SHA";
/** Reported after the original branch is restored: the shell is done. */
export const SQUASH_DONE_MARKER = "STELOW_SQUASH_DONE";

/** Verdicts the script can report. 0 means squashed and committed. */
export const SQUASH_EXIT_CONFLICT = 1;
export const SQUASH_EXIT_COMMIT_FAILED = 2;
export const SQUASH_EXIT_BASE_CHECKOUT_FAILED = 10;

/** Single-quote a shell word. Throws on empty input — fail fast, never quote air. */
export function shellQuote(value) {
  if (typeof value !== "string" || !value) throw new Error("shellQuote needs a non-empty string");
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One shell line that squash-merges `branch` into `base`, commits, then
 * restores `branch`. Conflict and commit-failure paths abort/reset before
 * restoring, so the checkout never strands mid-merge. Markers carry the
 * verdict; the caller polls terminal output for SQUASH_DONE_MARKER.
 */
export function buildSquashScript({ base, branch, message }) {
  const qBase = shellQuote(base);
  const qBranch = shellQuote(branch);
  const qMessage = shellQuote(message);
  return [
    `code=${SQUASH_EXIT_BASE_CHECKOUT_FAILED}`,
    `if git checkout ${qBase} >/dev/null 2>&1`,
    `then code=${SQUASH_EXIT_CONFLICT}`,
    `if git merge --squash ${qBranch} >/dev/null 2>&1`,
    `then code=${SQUASH_EXIT_COMMIT_FAILED}`,
    `git commit -m ${qMessage} >/dev/null 2>&1 && code=0`,
    `[ "$code" != "0" ] && git reset --hard HEAD >/dev/null 2>&1`,
    `else git merge --abort >/dev/null 2>&1`,
    `git reset --hard HEAD >/dev/null 2>&1`,
    `fi`,
    `fi`,
    `echo "${SQUASH_EXIT_MARKER}:$code"`,
    `[ "$code" = "0" ] && echo "${SQUASH_SHA_MARKER}:$(git rev-parse HEAD 2>/dev/null)"`,
    `git checkout ${qBranch} >/dev/null 2>&1`,
    `echo "${SQUASH_DONE_MARKER}:1"`,
  ].join("; ");
}

/**
 * Read a terminal tail for the squash verdict. `finished` means the restore
 * checkout ran — safe to close the shell. `exit`/`sha` come from the markers;
 * a finished script without an exit marker is a broken pipe, never success.
 */
export function parseSquashOutput(text) {
  if (typeof text !== "string" || !text) return { finished: false, exit: null, sha: null };
  const finished = text.includes(`${SQUASH_DONE_MARKER}:1`);
  const exitMatch = text.match(new RegExp(`${SQUASH_EXIT_MARKER}:(\\d+)`));
  const parsed = exitMatch ? Number.parseInt(exitMatch[1] ?? "", 10) : null;
  const exit = parsed !== null && !Number.isNaN(parsed) ? parsed : null;
  const shaMatch = text.match(new RegExp(`${SQUASH_SHA_MARKER}:([0-9a-f]{4,64})`, "i"));
  const sha = exit === 0 && shaMatch ? shaMatch[1] : null;
  return { finished, exit, sha };
}

/** Plain-language verdict for a non-zero exit, naming the next step. */
export function squashExitMessage(exit, branch, base) {
  if (exit === SQUASH_EXIT_CONFLICT) {
    return `Squash stopped on a conflict merging ${branch} into ${base} — the merge was aborted and ${branch} restored. Resolve the conflict by hand, then squash again.`;
  }
  if (exit === SQUASH_EXIT_COMMIT_FAILED) {
    return `Squash staged ${branch} into ${base} but the commit failed — the checkout was reset and ${branch} restored. Inspect the shell output, then squash again.`;
  }
  if (exit === SQUASH_EXIT_BASE_CHECKOUT_FAILED) {
    return `Squash could not check out ${base} — ${branch} is untouched.`;
  }
  return `Squash exited with code ${exit ?? "unknown"} — ${branch} was restored untouched.`;
}
