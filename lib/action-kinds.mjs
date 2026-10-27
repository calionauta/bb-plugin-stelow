/**
 * The closed vocabulary of the action log.
 *
 * `action_log` answers "what did this plugin experience?" — who asked, what it
 * decided, what it did outside its own database, and what the host was doing at
 * the time. That question only has an answer if the words are fixed: a kind
 * invented at a call site months later is a kind no reader, no test and no
 * query knows about, and the log quietly becomes prose again.
 *
 * So a kind is declared here with its layer and its surface, one line each, and
 * `recordActionLog` refuses anything else. Adding a kind is a one-line change
 * plus the assertion that emits it — that is the whole ceremony, and it is
 * cheaper than the archaeology it prevents.
 *
 * The layer is not a label for the reader; it is what the replay merges by:
 *
 *   intent      someone asked for something (RPC, CLI, UI)
 *   decision    the plugin chose: a stage, a gate verdict, a refusal, a retry
 *   effect      something happened outside the plugin DB: a thread, a run,
 *               a commit, a publication, a recorded verification
 *   environment what the world was doing: a host that stopped answering
 *
 * `surface` says which door a kind belongs to — rpc, cli, tick, hook, watcher
 * or system — so a spike in errors can be read as "the UI is broken" or "the
 * worker is looping" without a join. Both layer and surface are read from this
 * table at write time and cannot be overridden by a call site: a kind that
 * arrives at a second door is a second kind, declared here.
 */

/**
 * kind → { layer, surface }. Frozen so a stray assignment cannot widen it at
 * runtime; the writer reads it, nothing mutates it.
 */
export const ACTION_KINDS = Object.freeze({
  // ── intent ────────────────────────────────────────────────────────────────
  // One row per invocation, with its duration and its outcome. The wrapper does
  // this for all 120+ RPCs and all CLI verbs, so no individual handler has to
  // remember — which is why the first version of this file is the only version
  // that needs to be exhaustive.
  "rpc.call": Object.freeze({ layer: "intent", surface: "rpc" }),
  "cli.call": Object.freeze({ layer: "intent", surface: "cli" }),
  "ui.error": Object.freeze({ layer: "intent", surface: "rpc" }),

  // ── decision ──────────────────────────────────────────────────────────────
  "stage.entered": Object.freeze({ layer: "decision", surface: "system" }),
  "card.updated": Object.freeze({ layer: "decision", surface: "system" }),
  "worker.spawn": Object.freeze({ layer: "decision", surface: "system" }),
  "worker.retry": Object.freeze({ layer: "decision", surface: "system" }),
  "run.retry": Object.freeze({ layer: "decision", surface: "system" }),
  "question.asked": Object.freeze({ layer: "decision", surface: "system" }),
  "question.answered": Object.freeze({ layer: "decision", surface: "system" }),
  "question.persisted": Object.freeze({ layer: "decision", surface: "system" }),
  "question.expired": Object.freeze({ layer: "decision", surface: "system" }),
  "inbox.opened": Object.freeze({ layer: "decision", surface: "system" }),
  "inbox.resolved": Object.freeze({ layer: "decision", surface: "system" }),
  "reconcile.tick": Object.freeze({ layer: "decision", surface: "tick" }),
  "card.tick": Object.freeze({ layer: "decision", surface: "tick" }),

  // ── effect ────────────────────────────────────────────────────────────────
  "run.started": Object.freeze({ layer: "effect", surface: "system" }),
  "run.finished": Object.freeze({ layer: "effect", surface: "system" }),
  "verify.recorded": Object.freeze({ layer: "effect", surface: "cli" }),
  "publish.finished": Object.freeze({ layer: "effect", surface: "system" }),
  "github.synced": Object.freeze({ layer: "effect", surface: "watcher" }),

  // ── environment ───────────────────────────────────────────────────────────
  // A host that stops answering is not a decision and not an effect: it is the
  // weather, and it is recorded so a later "why did nothing happen?" does not
  // read as "the plugin did nothing".
  "host.read-miss": Object.freeze({ layer: "environment", surface: "tick" }),
});

export const ACTION_LAYERS = Object.freeze(["intent", "decision", "effect", "environment"]);
export const ACTION_SURFACES = Object.freeze(["rpc", "cli", "tick", "hook", "watcher", "system"]);
export const ACTION_OUTCOMES = Object.freeze(["ok", "refused", "error", "skipped", "partial"]);
export const ACTION_ACTORS = Object.freeze(["client", "agent", "plugin"]);

/**
 * A cause is a dotted code, never a sentence: `cli.refused`, `rpc.validation`,
 * `run.no-reason`. The sentence lives in `detail` or on the card, where prose
 * belongs; the code is what a query and a counter can group by.
 */
const CAUSE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)*$/;

export function isActionKind(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTION_KINDS, value);
}

export function isActionOutcome(value) {
  return typeof value === "string" && ACTION_OUTCOMES.includes(value);
}

export function isActionLayer(value) {
  return typeof value === "string" && ACTION_LAYERS.includes(value);
}

export function isActionCause(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && CAUSE_PATTERN.test(value);
}

/** The layer a kind belongs to, or null when the kind is not declared. */
export function actionLayerOf(kind) {
  return isActionKind(kind) ? ACTION_KINDS[kind].layer : null;
}

/** The surface a kind belongs to, or null when the kind is not declared. */
export function actionSurfaceOf(kind) {
  return isActionKind(kind) ? ACTION_KINDS[kind].surface : null;
}
