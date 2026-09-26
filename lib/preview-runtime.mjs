/**
 * Preview runtime: the process behind a running dev server, the store that owns
 * it, and the Connect calls that make it reachable.
 *
 * Every effect is injected, so this module is the WHOLE lifecycle — start,
 * absorb output, expose, stop, dispose — and a node test drives all of it with
 * a fake process and a fake Connect. `server.ts` supplies the real effects and
 * nothing else; a lifecycle that lives inside a request handler is a lifecycle
 * nothing can test.
 *
 * The identity is the CHECKOUT (host + path), never the card: two cards on one
 * project's source are the same code, so they share one server instead of
 * racing for the same port. That is also why a session is found by its checkout
 * and not by asking which card started it — a card whose worktree was recreated
 * must not be handed the server of the directory it used to own.
 *
 * This file is the wiring and nothing else. Each collaborator owns one rule:
 * lib/preview-session-store.mjs (the checkout is the identity),
 * lib/preview-app-root.mjs (where the app is, probed from the host),
 * lib/preview-process.mjs (bounded starting, log, stop-vs-crash),
 * lib/preview-connect.mjs (exposure is a bonus, never a gate), and
 * lib/preview-lifecycle.mjs (the five operations, over the context below).
 *
 * Nothing is configured per card. The workspace is probed, the stack answers,
 * and `.stelow/preview.json` is the only override.
 */
import { createAppRootResolver } from "./preview-app-root.mjs";
import { createConnectBridge } from "./preview-connect.mjs";
import { createPreviewLifecycle } from "./preview-lifecycle.mjs";
import { createSessionStore } from "./preview-session-store.mjs";

/**
 * How long a spawn may stay `starting` before the host calls it. A dev server
 * that never announces an address (wrong command, silent crash, output the
 * readiness scan does not recognize) used to sit in "Starting…" forever with no
 * way to debug it. Past the timeout the session fails with the last log lines
 * attached, so the log viewer becomes the diagnosis.
 */
export const PREVIEW_START_TIMEOUT_MS = 60_000;

/**
 * @param {object} effects
 * @param {(path: string) => Promise<string | null>} effects.readFile      one file's text, or null
 * @param {(dir: string) => string[]}               effects.listDirs      child directory names
 * @param {(...parts: string[]) => string}          effects.joinPath      path join for the host running the server
 * @param {(command: string, options: { cwd: string, env: Record<string, string> }) => object} effects.spawnProcess
 * @param {(args: string[]) => Promise<object | null>} effects.runConnect `bb connect <args> --json`, parsed
 * @param {() => number}                            [effects.now]
 * @param {Record<string, string>}                  [effects.baseEnv]
 * @param {number}                                  [effects.startTimeoutMs] bound on `starting` (default 60s)
 */
export function createPreviewRuntime({
  readFile,
  listDirs,
  joinPath,
  spawnProcess,
  runConnect,
  now = () => Date.now(),
  baseEnv = {},
  startTimeoutMs = PREVIEW_START_TIMEOUT_MS,
}) {
  /** One context, handed to every operation. Built here, nowhere else. */
  const { appRootAt } = createAppRootResolver({ readFile, listDirs, joinPath });
  return createPreviewLifecycle({
    now,
    baseEnv,
    startTimeoutMs,
    spawnProcess,
    store: createSessionStore(),
    connect: createConnectBridge({ runConnect, now }),
    appRootAt,
  });
}
