/**
 * Whether another agent shares this card's checkout, and which of the card's
 * files they are touching.
 *
 * The lock protocol answers "is another CARD holding this file", from the claim
 * ledger. It cannot answer "is another THREAD in this directory", because a
 * thread outside the plugin never acquires a claim. That is not a small gap:
 * a card's spawn environment comes from its preset, and the built-in fallback
 * preset is `project-default` — the SHARED project checkout. A host with no
 * New-worktree preset configured therefore puts every card in one working tree,
 * and the claim ledger sees no collision while two agents edit the same file.
 *
 * So this is the cross-thread half, and it is deliberately narrow:
 *
 * - A card in a MANAGED WORKTREE is skipped. Isolation already answers it, and
 *   a scan that could never find anything is theatre.
 * - Under a shared checkout, the working tree is shared by definition, so one
 *   `git status` of that checkout names every file ANY agent there is touching.
 *   There is no per-thread file ownership to read, and this never pretends to
 *   have one: the claim is "N other threads use this checkout, and these files
 *   you hold are dirty", not "thread X changed file Y", which nothing here can
 *   prove.
 * - The thread list is a report, not an enforcement. It never blocks, and it
 *   never resolves anything.
 *
 * Pure: the caller supplies the threads and the dirty files, so this is testable
 * without a host, a subprocess, or a database.
 */

/**
 * Every answer the cross-thread report can give, in the order the report is
 * allowed to ask for them: how many others share the checkout is a question
 * about the host, and what their work touches is a question about this card, so
 * the population decides what may be asked next.
 *
 * Exported rather than written out per surface, because the RPC schema, the
 * server's own type and the reader's copy all have to agree. A reason invented
 * in one of them and forgotten in another is a reason the UI has no sentence
 * for, and an unmeasured answer with no sentence is exactly the silence this
 * list exists to prevent.
 */
export const EXPOSURE_REASONS = [
  "isolated", "no-checkout", "no-threads", "no-overlap",
  "unavailable", "shared", "unknown-footprint", "unreadable-tree",
];

/**
 * The sentence for an answer whose own lines do not already say it.
 *
 * The single rule: a reason that could not be measured never renders as a
 * clean one. `unknown-footprint` and `unreadable-tree` say how many other
 * agents are in the checkout and what could not be compared — they are not the
 * absence of an overlap, they are the absence of the measurement, and the
 * difference is the whole point of the report. `shared` and `isolated` return
 * "" because their lines, or the absence of the section, already said it.
 */
export function sharedCheckoutVerdict(report) {
  if (!report || typeof report !== "object") return "";
  const count = Number.isInteger(report.threads) && report.threads > 0 ? report.threads : 0;
  if (count > 0) {
    const who = count === 1 ? "1 other agent is" : `${count} other agents are`;
    if (report.reason === "unknown-footprint") {
      return `${who} in this checkout. This card has not claimed any files, so `
        + "nothing here can say whether their work overlaps yours.";
    }
    if (report.reason === "unreadable-tree") {
      return `${who} in this checkout, but the working tree could not be read, `
        + "so no file overlap was measured.";
    }
  }
  if (report.reason === "no-threads") return "No other agent is working in this checkout.";
  if (report.reason === "no-overlap") {
    return "Other agents are in this checkout, but none of the files you hold are dirty there.";
  }
  if (report.reason === "unavailable") {
    return "Could not read this host's threads, so nothing is known about other agents here.";
  }
  if (report.reason === "no-checkout") {
    return "This card has no checkout Stelow can read, so nothing is known about other agents here.";
  }
  // `shared` and `isolated` speak for themselves, and a reason this function
  // does not know says nothing at all: a wrong sentence is worse than none,
  // because the reader has no way to tell a confident lie from a fact.
  return "";
}

const ACTIVE = new Set(["active", "running", "idle", "queued", "awaiting-answer"]);

/**
 * Whether this card works in a managed worktree the host made for it.
 *
 * A rule, not a detail, so it lives here and both readers ask it: the card's
 * own file-occupancy section and the cross-thread reader below. Two copies of
 * this predicate is how one surface ends up reporting "nobody is in your files"
 * on a card the other says is isolated.
 *
 * The directory name is the host's convention (`sw-<cardId>`) and matching on
 * it is deliberately conservative: a false negative costs a scan that finds
 * nothing, and a false positive hides a real collision. When in doubt, report.
 */
export function isManagedWorktree(workspacePath, cardId) {
  if (typeof workspacePath !== "string" || !workspacePath) return false;
  if (typeof cardId !== "string" || !cardId) return false;
  return workspacePath.includes(`sw-${cardId}`);
}

function threadShape(thread) {
  if (!thread || typeof thread !== "object") return null;
  const id = typeof thread.id === "string" && thread.id ? thread.id : null;
  const path = typeof thread.environmentPath === "string" && thread.environmentPath ? thread.environmentPath : null;
  if (!id || !path) return null;
  const status = typeof thread.status === "string" ? thread.status : "active";
  return {
    id,
    path: path.replace(/\/+$/, ""),
    status,
    title: typeof thread.title === "string" && thread.title ? thread.title : null,
    isStelow: typeof thread.originPluginId === "string" && thread.originPluginId.length > 0,
  };
}

/**
 * Live threads whose checkout is the same directory as the card's.
 *
 * Stelow's own threads are excluded when the host says who they are: a card's
 * worker is not an intruder, and reporting it as one is noise on every card.
 * The host does not always report `originPluginId`, so when it is absent for
 * every thread the set is simply empty and the section stays closed rather than
 * guessing from a title.
 */
export function threadsSharingCheckout(threads, { checkoutPath, excludeThreadId = null } = {}) {
  const target = typeof checkoutPath === "string" ? checkoutPath.replace(/\/+$/, "") : null;
  if (!target) return [];
  const out = [];
  for (const raw of Array.isArray(threads) ? threads : []) {
    const thread = threadShape(raw);
    if (!thread) continue;
    if (thread.id === excludeThreadId) continue;
    if (thread.path !== target) continue;
    if (thread.isStelow) continue;
    if (raw?.archivedAt || raw?.deletedAt) continue;
    if (!ACTIVE.has(thread.status)) continue;
    out.push(thread);
  }
  return out;
}

/**
 * Dirty paths in a porcelain v1 status, normalised to forward slashes.
 *
 * Porcelain's format is two status columns then the path, and a rename carries
 * a second NUL-separated path that is not a file of its own. `src/a.ts` and
 * `a b.ts` are both parseable only if the two-column prefix is stripped by
 * position rather than by splitting on the first space.
 */
export function dirtyPathsFromPorcelain(status) {
  if (typeof status !== "string") return [];
  const out = new Set();
  for (const record of status.split("\0")) {
    // Porcelain v1 is two status columns, then a space, then the path. The
    // third character is the invariant, and it is what makes `record.slice(3)`
    // the right cut: splitting on the first space would truncate a path that
    // contains one. A record without it is not porcelain and never becomes a
    // path claim, because a wrong path here names the wrong file as mine.
    if (record.length < 4 || record[2] !== " ") continue;
    const path = record.slice(3).replace(/\\/g, "/").replace(/^"(.*)"$/, "$1");
    if (!path) continue;
    // `R  old -> new`: the arrow target is the current path.
    const arrow = path.split(" -> ");
    out.add((arrow.length > 1 ? arrow[1] : arrow[0]).trim());
  }
  return [...out].filter(Boolean).sort();
}

/**
 * The overlap: the card's held files that are dirty in a shared checkout, and
 * who else is there.
 *
 * `heldFiles` is the card's own claim set — the same normalized paths the lock
 * protocol uses — so the two halves of the answer cannot disagree about what a
 * file is called.
 */
export function sharedCheckoutExposure(input = {}) {
  const {
    heldFiles = [], dirtyPaths = [], threads = [],
    checkoutPath = null, excludeThreadId = null,
  } = input;
  const others = threadsSharingCheckout(threads, { checkoutPath, excludeThreadId });
  if (others.length === 0) return { threads: [], files: [], lines: [] };
  const strip = (value) => value.replace(/^\.\//, "");
  const dirty = new Set(dirtyPathsFromPorcelain(dirtyPaths).map(strip));
  const held = Array.isArray(heldFiles) ? heldFiles : [];
  const files = [...new Set(
    held.filter((file) => typeof file === "string" && file).map(strip),
  )]
    .filter((file) => dirty.has(file))
    .sort();
  if (files.length === 0) return { threads: others, files: [], lines: [] };
  return { threads: others, files, lines: exposureLines(others.length, files) };
}

/**
 * The sentence, then one line per file.
 *
 * Split rather than interpolated whole because the two halves answer different
 * questions and the reader should be able to act on the first one alone: WHO is
 * here is a fact about the host, and WHICH files are involved is a fact about
 * this card. Fused into one sentence, a reader who only cares about the second
 * has to re-read the first.
 */
function exposureLines(others, files) {
  const who = others === 1 ? "1 other thread" : `${others} other threads`;
  const count = files.length;
  const noun = count === 1 ? "file" : "files";
  const verb = count === 1 ? "has" : "have";
  return [
    `This card shares its checkout with ${who}.`,
    `${count} ${noun} you hold ${verb} uncommitted changes there.`,
    ...files.map((file) => `${file} is dirty in a shared working tree`),
  ];
}
