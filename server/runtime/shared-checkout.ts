/**
 * The cross-thread half of "who is in this card's files".
 *
 * `lib/file-occupancy.mjs` answers the CARD half from the claim ledger. This
 * answers the THREAD half, which no claim can answer: a thread outside the
 * plugin never acquires a claim, so a card working in a shared project
 * checkout sees "nobody" while another agent edits the same file two metres
 * away. That is not a rare configuration — a card's spawn environment comes
 * from its preset, and the built-in fallback preset is `project-default`, the
 * shared checkout. A host with no New-worktree preset configured puts every
 * card in one working tree.
 *
 * Three constraints shape this, and all three are about not paying for an
 * answer nobody asked for:
 *
 * 1. A MANAGED WORKTREE short-circuits before any subprocess. Isolation
 *    already answers the question, and a scan that could never find anything
 *    is theatre that costs 700ms.
 * 2. The thread list is cached, because `bb thread list --json` costs ~0.6s
 *    every call and the answer changes on a human timescale.
 * 3. Every read is fail-soft. This is a report: a missing `bb`, an unreadable
 *    working tree, or a malformed payload reads as "no exposure", never as an
 *    error, because a card detail must not fail over an advisory line.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { liveClaimsForWorkspace } from "../../lib/card-claims.mjs";
import { resolveClaimCheckout } from "../../lib/card-claim-key.mjs";
import {
  EXPOSURE_REASONS,
  isManagedWorktree,
  sharedCheckoutExposure,
  threadsSharingCheckout,
} from "../../lib/shared-checkout-exposure.mjs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorkerCard } from "../workers-types.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

const execFileAsync = promisify(execFile);
const bbBin = process.env.BB_CLI || "bb";

/**
 * How long a thread list stays fresh. Long enough that opening a card twice
 * costs one call, short enough that an agent which just arrived is seen.
 * A stale answer here is a missing warning, not a wrong one, so the floor is
 * generosity rather than precision.
 */
const THREAD_LIST_TTL_MS = 30_000;

export type SharedCheckoutReport = {
  /** True when the card works in a managed worktree: unreachable by others. */
  isolated: boolean;
  threads: number;
  files: string[];
  lines: string[];
  /**
   * Why the answer is empty when nothing is wrong — the reader can tell.
   *
   * Derived from the lib's one list, never restated: a reason written out here
   * and forgotten in the schema or the reader is a reason with no sentence, and
   * a reason with no sentence falls through to "nobody is working here".
   */
  reason: (typeof EXPOSURE_REASONS)[number];
};

const EMPTY = (reason: SharedCheckoutReport["reason"]): SharedCheckoutReport => ({
  isolated: reason === "isolated",
  threads: 0,
  files: [],
  lines: [],
  reason,
});

type SharedCheckoutDeps = {
  db: Db;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string | null } | null>;
  dirtyStatusIn: (checkoutPath: string) => Promise<string>;
  listThreads: () => Promise<unknown[]>;
  now: () => number;
};

export function createSharedCheckoutReader(deps: SharedCheckoutDeps) {
  // One cache for the whole host process: the thread list is a property of the
  // host, not of a card, so caching it per card would multiply the cost by
  // exactly the number of cards being read.
  let cached: { at: number; threads: unknown[] } | null = null;

  async function threads(): Promise<unknown[]> {
    if (cached && deps.now() - cached.at < THREAD_LIST_TTL_MS) return cached.threads;
    // A throw here is the host failing, not the card: the caller cannot act on
    // it, so it is cached as the empty answer it means and the section says it
    // could not read the host's threads.
    const fresh = await deps.listThreads().catch(() => [] as unknown[]);
    cached = { at: deps.now(), threads: fresh };
    return fresh;
  }

  return {
    /** Drop the cache — for tests, and for anything that must see a new thread. */
    invalidate: () => {
      cached = null;
    },
    reportFor: async (cardId: string): Promise<SharedCheckoutReport> => {
      const card = deps.getCard(cardId);
      if (!card) return EMPTY("no-checkout");
      const workspace = await deps.cardWorkspace(card).catch(() => null);
      const rawPath = workspace?.path ?? null;
      if (isManagedWorktree(rawPath, cardId)) return EMPTY("isolated");
      const checkoutPath = resolveClaimCheckout({ checkoutPath: rawPath });
      if (!checkoutPath) return EMPTY("no-checkout");

      const list = await threads();
      if (!Array.isArray(list) || list.length === 0) return EMPTY("unavailable");
      return exposureReport(deps, { cardId, checkoutPath, list });
    },
  };
}

/**
 * The claim ledger, narrowed to this card — the same read the card-occupancy
 * section performs, so both halves of the answer agree about which files this
 * card holds. A ledger mid-migration answers nothing rather than failing a load
 * the reader asked for something advisory on; because overlap is now only ever
 * measured after the checkout's population is known, an empty answer here lands
 * on the honest label (`unknown-footprint`) instead of on "nothing overlaps".
 */
function heldFilesFor(db: Db, cardId: string, checkoutPath: string, nowMs: number): string[] {
  try {
    return liveClaimsForWorkspace(db, { workspacePath: checkoutPath, nowMs })
      .filter((row) => row.card_id === cardId)
      .map((row) => String(row.file_path ?? ""));
  } catch {
    return [];
  }
}

/**
 * The report once the host has been asked, and the order IS the rule.
 *
 * How many other agents share this checkout is a question about the host alone:
 * it reads the cached thread list, costs no subprocess, and is true whatever
 * this card happens to hold. So it is asked first, and everything after it is
 * only reachable if there is somebody to compare against. Reading the order the
 * other way is what produced the defect this replaces — an empty claim set
 * short-circuited on `held.length === 0`, which suppressed the thread count and
 * answered `no-overlap`: a measurement nobody made, rendered as a clean one.
 *
 * `threadsSharingCheckout` runs a second time inside `sharedCheckoutExposure`,
 * over the same in-memory array. That is deliberate rather than an oversight:
 * it filters on `environmentPath`, so pre-shaped threads would filter to `[]`.
 */
async function exposureReport(
  deps: SharedCheckoutDeps,
  input: { cardId: string; checkoutPath: string; list: unknown[] },
): Promise<SharedCheckoutReport> {
  const others = threadsSharingCheckout(input.list, { checkoutPath: input.checkoutPath });
  // Nobody else here is a complete answer whatever this card holds, so it costs
  // no ledger read and no subprocess to reach it.
  if (others.length === 0) return EMPTY("no-threads");
  const held = heldFilesFor(deps.db, input.cardId, input.checkoutPath, deps.now());
  // Overlap is a relation between two sets, and one empty set is not the same
  // thing as an empty relation. The count of others is still worth reporting.
  if (held.length === 0) return { ...EMPTY("unknown-footprint"), threads: others.length };
  // The one `git status`, spent only on the question that can be answered by it.
  const dirty = await deps.dirtyStatusIn(input.checkoutPath).catch(() => "");
  const exposure = sharedCheckoutExposure({
    heldFiles: held,
    dirtyPaths: dirty,
    threads: input.list,
    checkoutPath: input.checkoutPath,
  });
  const count = exposure.threads.length;
  if (exposure.files.length === 0) return { ...EMPTY("no-overlap"), threads: count };
  return {
    isolated: false,
    threads: count,
    files: exposure.files,
    lines: exposure.lines,
    reason: "shared",
  };
}

/**
 * `bb thread list --json`, read through the CLI because the SDK exposes no
 * thread list — a gap, not a design. Fail-soft by contract: the caller cannot
 * distinguish "no threads" from "the CLI is missing", and neither should the
 * card, because both mean the same honest thing here — no exposure reported.
 */
export async function listBbThreads(): Promise<unknown[]> {
  try {
    const { stdout } = await execFileAsync(bbBin, ["thread", "list", "--json"], {
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    // The CLI returns a bare array in some versions and `{threads: []}` in
    // others; both are the same answer and guessing wrong must read as empty.
    const list = Array.isArray(parsed) ? parsed : (parsed as { threads?: unknown })?.threads;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export type SharedCheckoutReader = ReturnType<typeof createSharedCheckoutReader>;
