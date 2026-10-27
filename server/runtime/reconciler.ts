import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  clearClaimWaiters,
  releaseAllCardClaims,
  renewCardClaims,
  sweepExpiredClaims,
} from "../../lib/card-claims.mjs";
import { CLAIM_TERMINAL_STATUSES, isClaimTerminal } from "../../lib/card-terminal.mjs";
import { sweepEventSeverity } from "../../lib/inbox-events.mjs";
import type { ActionRecorder } from "./action-log-runtime.js";

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
  /** The flight recorder; absent means "no log", never "no tick". */
  actions?: ActionRecorder;
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
 * The cards that currently hold at least one claim, with the three columns the
 * two passes below disagree about.
 *
 * Asking `card_claims` first is what keeps this cheap: the sweep used to read
 * every card and run an empty SQLite transaction per terminal one — 17 of them
 * on this fleet, against a table with zero rows, every 45 seconds. A release
 * or a renewal only means something for a card that HAS claims, so the loop can
 * only ever see a card with work to do. The join is free-standing rather than a
 * `WHERE status IN (...)` built from the terminal list: a card that reached a
 * terminal status and then had its status written back is exactly the state the
 * release pass exists to correct, and it must not be filtered out by the same
 * predicate it is there to enforce.
 */
function claimHolderCards(deps: ReconcilerDeps): Array<{
  id: string;
  status: string;
  activity: string;
  worker_thread_id: string | null;
}> {
  return deps.db.prepare(
    `SELECT c.id, c.status, c.activity, c.worker_thread_id FROM cards c
      WHERE EXISTS (SELECT 1 FROM card_claims cc WHERE cc.card_id = c.id)`,
  ).all() as Array<{ id: string; status: string; activity: string; worker_thread_id: string | null }>;
}

/**
 * Slide the lease of every holder the host still supervises.
 *
 * The TTL is a crash detector, not a work limit. A research, explore or build
 * scope routinely runs past 30 minutes, and a lease that only ever counted down
 * lapsed under a worker that was still writing those files — handing the
 * exclusivity it was promised to a card that merely asked for them. Renewal is
 * what makes the two rules compatible instead of contradictory.
 *
 * It is gated on supervision — a worker thread the host owns, a status that is
 * not terminal, and an activity it has not given up on (`error` is what
 * `applyFailed` writes once retries are exhausted). A holder that fails any of
 * those is left exactly as it is: no renewal, so the lease runs out and the
 * files free up at TTL. Releasing it early instead would be faster and worse —
 * a worker resumed onto the same stage would find its own claim gone and fail
 * the done gate with no door back, while a lapsed lease is re-acquired by the
 * next `scope start` and renewed by the next tick that sees it running again.
 *
 * Runs BEFORE the expiry sweep on purpose: a supervised holder must not have
 * its lease reaped in the same tick that would have extended it.
 */
function renewLiveClaims(deps: ReconcilerDeps): void {
  for (const holder of claimHolderCards(deps)) {
    if (isClaimTerminal(holder.status)) continue;
    if (!holder.worker_thread_id || holder.activity === "error") continue;
    try {
      renewCardClaims(deps.db, { cardId: holder.id, nowMs: deps.now() });
    } catch (error) {
      deps.onError("renew live claims", error);
    }
  }
}

/**
 * Return what terminal cards still hold.
 *
 * `isClaimTerminal` stays the single owner of "is this terminal"; the query
 * that finds holders lives in `claimHolderCards`, next to the renewal pass that
 * needs the same rows for the opposite decision.
 */
function releaseTerminalClaims(deps: ReconcilerDeps): void {
  for (const holder of claimHolderCards(deps)) {
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
    const started = deps.now();
    let errors = 0;
    const phase = (name: string, run: () => void) => {
      try {
        run();
      } catch (error) {
        errors += 1;
        deps.onError(name, error);
      }
    };
    phase("reconcile live cards", () => reconcileLiveCards(deps));
    void deps.maybeBumpSeverity();
    phase("sweep inbox aging", () => sweepInboxAging(deps));
    // Renewal runs before the sweep on purpose: a holder the host still
    // supervises must not have its lease reaped in the same tick that would
    // have extended it, or the renewal would only ever fire for claims nobody
    // was about to take.
    phase("renew live claims", () => renewLiveClaims(deps));
    phase("release expired claims", () => releaseExpiredClaims(deps));
    phase("release terminal claims", () => releaseTerminalClaims(deps));
    // A heartbeat, not an event: the tick itself is what a silent reconciler
    // never left behind. `occurrences` grows per tick, so the row answers "how
    // often" without one line per 45 seconds; `last_at` is the liveness proof.
    deps.actions?.record({
      kind: "card.tick",
      outcome: errors === 0 ? "ok" : "partial",
      cause: "card.tick",
      durationMs: deps.now() - started,
    });
    // Last and non-blocking: the execution pass is async and owns its own
    // in-flight guard, so a slow one must not delay the next card tick.
    if (reconcileExecution) void reconcileExecution();
  };
  const timer = scheduler.setInterval(tick, RECONCILE_MS);
  return { tick, dispose: () => scheduler.clearInterval(timer) };
}
