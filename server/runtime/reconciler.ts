import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clearClaimWaiters, releaseAllCardClaims, sweepExpiredClaims } from "../../lib/card-claims.mjs";
import { isClaimTerminal } from "../../lib/card-terminal.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type ReleasedFile = { workspacePath: string; file: string };
const RECONCILE_MS = 45_000;
export type Scheduler = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

type ReconcilerDeps = {
  db: Db;
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

function reconcileLiveCards(deps: ReconcilerDeps): void {
  const rows = deps.db.prepare(
    "SELECT id FROM cards WHERE worker_thread_id IS NOT NULL AND status != 'archived'",
  ).all() as Array<{ id: string }>;
  const liveIds = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    void deps.syncThreadState(row.id);
    void deps.scopeProgress.sync(row.id);
  }
  deps.scopeProgress.prune(liveIds);
}

function releaseExpiredClaims(deps: ReconcilerDeps): void {
  const released = sweepExpiredClaims(deps.db, deps.now());
  notifyReleased(deps, released);
}

function releaseTerminalClaims(deps: ReconcilerDeps): void {
  const holders = deps.db.prepare("SELECT id, status FROM cards").all() as Array<{
    id: string;
    status: string;
  }>;
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

export function startReconciler(deps: ReconcilerDeps) {
  const scheduler = deps.scheduler ?? { setInterval, clearInterval };
  const tick = () => {
    if (!(deps.db as { open?: boolean }).open) return;
    try { reconcileLiveCards(deps); } catch (error) { deps.onError("reconcile live cards", error); }
    void deps.maybeBumpSeverity();
    try { releaseExpiredClaims(deps); } catch (error) { deps.onError("release expired claims", error); }
    try { releaseTerminalClaims(deps); } catch (error) { deps.onError("release terminal claims", error); }
  };
  const timer = scheduler.setInterval(tick, RECONCILE_MS);
  return { tick, dispose: () => scheduler.clearInterval(timer) };
}
