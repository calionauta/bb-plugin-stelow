/**
 * Supervision of the dev-server process behind one preview session: the spawn,
 * the bounded wait for an address, the log, and the close. It is the part of the
 * lifecycle that must never leave a user staring at "Starting…" or at a crash
 * that was really a stop, so the three rules live here and are stated once:
 *
 * - silence fails loudly, with the log attached, instead of waiting forever;
 * - output after startup is a log, not a verdict — a later line never fails a
 * - running preview;
 * - a close after our own stop is not a crash, because a deliberately stopped
 *   session is already out of the store by then.
 *
 * Each rule is a module function over an injected context, so a test can drive
 * one of them without a host; `createProcessSupervisor` only binds them.
 */
import { previewFailed, previewReady } from "./preview-detect.mjs";
import { PREVIEW_LOG_LIMIT, appendLog, previewLogText } from "./preview-session.mjs";

/** How long a TERMed process gets to exit before it is killed outright. */
export const PREVIEW_KILL_GRACE_MS = 5_000;

export function clearStartTimer(session) {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
}

export function killPreviewProcess(session, killGraceMs = PREVIEW_KILL_GRACE_MS) {
  const child = session.child;
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* gone */
    }
  }, killGraceMs);
  timer.unref?.();
}

/** A log line: kept always, judged only while the server is still starting. */
function absorbOutput(session, { logLimit, onReady }, chunk) {
  session.log = appendLog(session.log, String(chunk ?? ""), logLimit);
  if (session.state !== "starting") return;
  const text = previewLogText(session.log);
  const failure = previewFailed(text);
  if (failure) {
    session.state = "failed";
    session.error = failure;
    return;
  }
  if (previewReady(text, session.port)) void onReady(session);
}

/** Bounded starting: a server that never announces an address must fail. */
function armStartTimer(session, startTimeoutMs) {
  const timer = setTimeout(() => {
    session.timer = null;
    if (session.state !== "starting") return;
    session.state = "failed";
    const seconds = Math.round(startTimeoutMs / 1000);
    session.error = `The dev server did not announce an address within ${seconds}s. `
      + "The last output is in the log — inspect it, then Stop and Start again.";
  }, startTimeoutMs);
  timer.unref?.();
  session.timer = timer;
}

/**
 * Spawn the session's dev server and wire every event it will ever emit.
 * A host that cannot spawn at all (missing command, no permission) answers with
 * the failure inline instead of throwing into an RPC handler.
 */
export function spawnPreviewProcess(session, {
  spawnProcess,
  cwd,
  env,
  startTimeoutMs,
  logLimit = PREVIEW_LOG_LIMIT,
  onReady,
  onSettled,
}) {
  let child;
  try {
    child = spawnProcess(session.command, { cwd, env });
  } catch (error) {
    session.state = "failed";
    session.error = error instanceof Error ? error.message : "Unable to start the dev server.";
    return { ok: false, error: session.error };
  }
  session.child = child;
  armStartTimer(session, startTimeoutMs);
  const absorb = (chunk) => absorbOutput(session, { logLimit, onReady }, chunk);
  child.stdout?.on("data", absorb);
  child.stderr?.on("data", absorb);
  child.on("error", (error) => {
    session.state = "failed";
    session.error = error instanceof Error ? error.message : "Unable to start the dev server.";
  });
  child.on("close", (code) => {
    session.child = null;
    clearStartTimer(session);
    onSettled(session, code);
  });
  return { ok: true, error: null };
}

/**
 * @param {object} effects
 * @param {(session: object) => void|Promise<void>} effects.onReady    the session announced its address
 * @param {(session: object, code: number|null) => void} effects.onSettled the process ended
 */
export function createProcessSupervisor({
  onReady,
  onSettled,
  startTimeoutMs,
  logLimit = PREVIEW_LOG_LIMIT,
  killGraceMs = PREVIEW_KILL_GRACE_MS,
}) {
  return {
    spawn: (session, { spawnProcess, cwd, env }) => spawnPreviewProcess(session, {
      spawnProcess,
      cwd,
      env,
      startTimeoutMs,
      logLimit,
      onReady,
      onSettled,
    }),
    clearTimer: clearStartTimer,
    kill: (session) => killPreviewProcess(session, killGraceMs),
  };
}
