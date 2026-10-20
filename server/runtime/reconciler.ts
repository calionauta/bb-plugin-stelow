import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clearClaimWaiters, releaseAllCardClaims, sweepExpiredClaims } from "../../lib/card-claims.mjs";
import { CLAIM_TERMINAL_STATUSES, isClaimTerminal } from "../../lib/card-terminal.mjs";
import { sweepEventSeverity } from "../../lib/inbox-events.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type ReleasedFile = { workspacePath: string; file: string };
const RECONCILE_MS = 45_000;
export type Scheduler = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

type ReconcilerDeps = {
  db: Db;
  bb: BbPluginApi;
  syncThreadState: (cardId: string) => Promise<void>;
  scopeProgress: {
    sync: (cardId: string) => Promise<unknown>;
    prune: (liveIds: ReadonlySet<string>) => void;
  };
  maybeBumpSeverity: () => Promise<void>;
  notifyClaimWaiters: (workspacePath: string, files: string[]) => Promise<void>;
  now: () => number;
  onError: (phase: string, error: unknown) => void;
  scheduler?: Scheduler;
};

function notifyReleased(deps: ReconcilerDeps, released: ReleasedFile[]): void {
  const byWorkspace = new Map<string, string[]>();
  for (const row of released) {
    const files = byWorkspace.get(row.workspacePath) ?? [];
    files.push(row.file);
    byWorkspace.set(row.workspacePath, files);
  }
  for (const [workspacePath, files] of byWorkspace) {
    void deps.notifyClaimWaiters(workspacePath, files);
  }
}

/**
 * The cards this tick has anything to do for.
 *
 * `shouldSyncThread` is the one owner of "is this card live", and it excludes
 * archived, completed and blocked cards — the same three that
 * `CLAIM_TERMINAL_STATUSES` names. The query used to stop at
 * `status != 'archived'`, which selected every completed card too.
 * `syncThreadState` then filtered them out on its first line, but
 * `scopeProgress.sync` ran BEFORE that filter and pays a `projects.get` round
 * trip plus a read of `stelow.json` per card. On this fleet that was 10
 * finished cards re-read every 45 seconds to discover each time that they were
 * finished.
 *
 * The status list is derived from `CLAIM_TERMINAL_STATUSES` rather than
 * re-spelled, so the two rules cannot drift apart into two authors.
 */
const LIVE_CARD_WHERE = `worker_thread_id IS NOT NULL AND status NOT IN (${CLAIM_TERMINAL_STATUSES.map(() => "?").join(",")})`;

function reconcileLiveCards(deps: ReconcilerDeps): void {
  const rows = deps.db.prepare(
    `SELECT id FROM cards WHERE ${LIVE_CARD_WHERE}`,
  ).all(...CLAIM_TERMINAL_STATUSES) as Array<{ id: string }>;
  const liveIds = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    void deps.syncThreadState(row.id);
    void deps.scopeProgress.sync(row.id);
  }
  // Pruning against the live ids is what bounds the map: a card that reaches a
  // terminal status will never be synced again, so its fingerprint has no
  // reader left. If one ever came back the next sync would just re-seed it.
  deps.scopeProgress.prune(liveIds);
}

function releaseExpiredClaims(deps: ReconcilerDeps): void {
  const released = sweepExpiredClaims(deps.db, deps.now());
  notifyReleased(deps, released);
}

/**
 * Age escalation for rows no live sync will revisit.
 *
 * `syncThreadState` skips completed cards on purpose (a finished card has no
 * thread left to read), so its per-card severity sweep never sees a completion
 * nobody opened — and the review-wait tier could never fire. This is the fleet
 * tick that reaches them. Advisory: a failure leaves the stored tiers alone.
 */
function sweepInboxAging(deps: ReconcilerDeps): void {
  try {
    if (sweepEventSeverity(deps.db, { nowMs: deps.now() }) > 0) {
      deps.bb.realtime.publish("inbox-changed", { aged: true });
    }
  } catch (error) {
    deps.onError("sweep inbox aging", error);
  }
}

/**
 * Return what terminal cards still hold.
 *
 * The scan used to read every card and then release claims for each terminal
 * one, which ran an empty SQLite transaction per card — 17 of them on this
 * fleet, against a `card_claims` table with zero rows, every 45 seconds. A
 * release only means something for a card that HAS claims, so the query asks
 * that first and the loop can only ever see a card with work to do.
 *
 * The join is left free-standing rather than a `WHERE status IN (...)` built
 * from the terminal list: a card that reached a terminal status and then had
 * its status written back is exactly the state this sweep exists to correct,
 * and it must not be filtered out by the same predicate it is here to enforce.
 * `isClaimTerminal` stays the single owner of "is this terminal".
 */
function releaseTerminalClaims(deps: ReconcilerDeps): void {
  const holders = deps.db.prepare(
    `SELECT c.id, c.status FROM cards c
      WHERE EXISTS (SELECT 1 FROM card_claims cc WHERE cc.card_id = c.id)`,
  ).all() as Array<{ id: string; status: string }>;
  for (const holder of holders) {
    if (!isClaimTerminal(holder.status)) continue;
    let released: ReleasedFile[];
    try {
      released = releaseAllCardClaims(deps.db, holder.id);
    } catch (error) {
      deps.onError("release terminal claims", error);
      continue;
    }
    try {
      clearClaimWaiters(deps.db, { cardId: holder.id });
    } catch (error) {
      deps.onError("clear claim waiters", error);
    }
    notifyReleased(deps, released);
  }
}

/**
 * One 45s timer for both passes.
 *
 * The execution reconciler and this one used to own a timer each, at the same
 * interval and started within milliseconds of each other, so every tick read
 * the same SQLite handle twice for the same reason. `reconcileExecution` is
 * optional because a caller with no execution layer (and every test harness)
 * still gets a working card tick.
 */
export function startReconciler(deps: ReconcilerDeps, reconcileExecution?: () => Promise<void>) {
  const scheduler = deps.scheduler ?? { setInterval, clearInterval };
  const tick = () => {
    if (!(deps.db as { open?: boolean }).open) return;
    try { reconcileLiveCards(deps); } catch (error) { deps.onError("reconcile live cards", error); }
    void deps.maybeBumpSeverity();
    sweepInboxAging(deps);
    try { releaseExpiredClaims(deps); } catch (error) { deps.onError("release expired claims", error); }
    try { releaseTerminalClaims(deps); } catch (error) { deps.onError("release terminal claims", error); }
    // Last and non-blocking: the execution pass is async and owns its own
    // in-flight guard, so a slow one must not delay the next card tick.
    if (reconcileExecution) void reconcileExecution();
  };
  const timer = scheduler.setInterval(tick, RECONCILE_MS);
  return { tick, dispose: () => scheduler.clearInterval(timer) };
}
