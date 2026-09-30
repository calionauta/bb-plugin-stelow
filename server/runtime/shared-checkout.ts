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
import { isManagedWorktree, sharedCheckoutExposure } from "../../lib/shared-checkout-exposure.mjs";
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
  /** Why the answer is empty when nothing is wrong — the reader can tell. */
  reason: "isolated" | "no-checkout" | "no-threads" | "no-overlap" | "unavailable" | "shared";
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
 * the reader asked for something advisory on.
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
 * The report once the host has been asked. Two branches, and the difference
 * matters to the reader: threads-in-the-checkout with no overlap in my files is
 * a clean answer, while an empty list is a statement about the host instead.
 */
async function exposureReport(
  deps: SharedCheckoutDeps,
  input: { cardId: string; checkoutPath: string; list: unknown[] },
): Promise<SharedCheckoutReport> {
  const held = heldFilesFor(deps.db, input.cardId, input.checkoutPath, deps.now());
  if (held.length === 0) return EMPTY("no-overlap");
  const dirty = await deps.dirtyStatusIn(input.checkoutPath).catch(() => "");
  const exposure = sharedCheckoutExposure({
    heldFiles: held,
    dirtyPaths: dirty,
    threads: input.list,
    checkoutPath: input.checkoutPath,
  });
  const others = exposure.threads.length;
  if (others === 0) return EMPTY("no-threads");
  if (exposure.files.length === 0) return { ...EMPTY("no-overlap"), threads: others };
  return {
    isolated: false,
    threads: others,
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
