/**
 * The recorder's runtime skin: one object the surfaces call, with the two
 * properties the rest of the plugin depends on.
 *
 * **It never throws.** A logging failure must read as a missing row, never as a
 * refused card. The lib validates and throws (that is where a test catches a
 * typo); this wrapper catches and reports once per distinct message.
 *
 * **It is one object, built once.** Every surface receives the same instance
 * from the runtime core, so the kill switch, the failure de-duplication and the
 * clock are decided in one place rather than per module.
 *
 * The kill switch is `STELOW_ACTION_LOG=0`: an operator debugging a runaway
 * log disables the writes without a redeploy, and every reader keeps working
 * against whatever the table already holds.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  ensureActionLogTable,
  listActionLog,
  pruneActionLog,
  recordActionLog,
  summarizeActionLog,
} from "../../lib/action-log.mjs";
import type {
  ActionLogEntry,
  ActionLogFilter,
  ActionLogRow,
} from "../../lib/action-log.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type ActionRecorder = {
  readonly enabled: boolean;
  record: (entry: ActionLogEntry) => { id: string; occurrences: number; deduped: boolean } | null;
  list: (filter?: ActionLogFilter) => ActionLogRow[];
  summarize: (filter?: ActionLogFilter) => ReturnType<typeof summarizeActionLog>;
  prune: (options?: { olderThanMs?: number; maxRows?: number }) => { deleted: number; kept: number };
};

export type ActionRecorderDeps = {
  db: Db;
  now: () => number;
  /** Wiring passes `bb.log.warn`; tests pass a collector. */
  onFailure?: (message: string) => void;
  enabled?: boolean;
};

/** Table creation is separate from construction: the recorder is built before
 * the migration pass in some test harnesses, and `CREATE TABLE IF NOT EXISTS`
 * is idempotent, so both orders are safe. */
export function ensureActionLog(db: Db): void {
  ensureActionLogTable(db);
}

export function createActionRecorder(deps: ActionRecorderDeps): ActionRecorder {
  const enabled = deps.enabled ?? process.env.STELOW_ACTION_LOG !== "0";
  const reported = new Set<string>();

  return {
    enabled,
    record(entry) {
      if (!enabled) return null;
      try {
        return recordActionLog(deps.db, entry, { now: deps.now });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A broken recorder must not write a row per failure either: once per
        // distinct message is enough to notice, and silence after that is what
        // keeps a bug in this file from becoming the incident.
        if (!reported.has(message) && deps.onFailure) {
          reported.add(message);
          deps.onFailure(`action log: ${message}`);
        }
        return null;
      }
    },
    list(filter = {}) {
      return listActionLog(deps.db, filter);
    },
    summarize(filter = {}) {
      return summarizeActionLog(deps.db, filter);
    },
    prune(options = {}) {
      return pruneActionLog(deps.db, { now: deps.now(), ...options });
    },
  };
}
