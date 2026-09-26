/**
 * The five operations of a preview, as functions over an injected context.
 *
 * Nothing here reaches for module state: every effect and every collaborator
 * arrives on `deps` (see lib/preview-runtime.mjs, which is the only place that
 * builds one), so each operation can be read — and failed — on its own. The
 * rules they share are stated once, in lib/preview-process.mjs.
 */
import { previewCommand } from "./preview-detect.mjs";
import { createProcessSupervisor } from "./preview-process.mjs";
import { isLive } from "./preview-session-store.mjs";
import { PREVIEW_MAX_SESSIONS, pickPort, previewKey, previewShape } from "./preview-session.mjs";

/** A new session's fields. `state` is the only thing the panel reads to act. */
function newSession(deps, target, app, port) {
  return {
    key: previewKey(target.hostId, app.root),
    checkout: app.root,
    command: previewCommand(app.detection, port),
    port,
    state: "starting",
    detection: app.detection,
    declared: app.declared,
    log: { lines: [], carry: "" },
    error: null,
    startedAt: deps.now(),
    share: null,
    child: null,
    timer: null,
  };
}

/** A live server asks Connect for a share URL, then answers from it. */
async function goLive(deps, session) {
  deps.supervisor.clearTimer(session);
  session.state = "running";
  session.share = await deps.connect.exposeUrl(session.port);
}

/** Code 0 is a clean exit and leaves nothing behind; anything else failed. */
function settle(deps, session, code) {
  if (!deps.store.has(session.key)) return;
  if (code === 0) deps.store.delete(session.key);
  else if (session.state !== "failed") {
    session.state = "failed";
    session.error = `The dev server exited with code ${code ?? "unknown"}.`;
  }
  void deps.connect.unexpose(session.port);
}

/**
 * The lifecycle a host installs: it wires the process supervisor (which needs
 * the two transitions below) to the five operations, and returns them bound to
 * this context. `deps.startTimeoutMs` is the bound on `starting`.
 */
export function createPreviewLifecycle(deps) {
  deps.supervisor = createProcessSupervisor({
    onReady: (session) => goLive(deps, session),
    onSettled: (session, code) => settle(deps, session, code),
    startTimeoutMs: deps.startTimeoutMs,
  });
  return {
    start: (target) => startPreview(deps, target),
    stop: (target) => stopPreviews(deps, target),
    view: (target, appOrigin) => previewView(deps, target, appOrigin),
    dispose: () => disposePreviews(deps),
    share: (target) => sharePreview(deps, target),
  };
}

/** Start the checkout's dev server, or report the one next action that blocks it. */
export async function startPreview(deps, target) {
  const { store } = deps;
  if (store.liveUnder(target.hostId, target.checkout).length > 0) return { ok: true, error: null };
  const app = await deps.appRootAt(target.checkout, target.slug);
  if (!app.detection) return { ok: false, error: "No web app detected in this workspace." };
  const live = store.live();
  if (live.length >= PREVIEW_MAX_SESSIONS) {
    return { ok: false, error: `Stop one of the ${PREVIEW_MAX_SESSIONS} running previews first.` };
  }
  const port = pickPort(app.detection.port, live.map((session) => session.port));
  if (port === null) return { ok: false, error: "No free port is available." };

  const session = newSession(deps, target, app, port);
  store.set(session);

  // Loopback only: Connect shares loopback ports, and a dev server bound to
  // every interface would be reachable without the account gate that makes a
  // share safe.
  const env = { ...deps.baseEnv, PORT: String(port), HOST: "127.0.0.1", BROWSER: "none", CI: "1" };
  return deps.supervisor.spawn(session, { spawnProcess: deps.spawnProcess, cwd: app.root, env });
}

/** Stop everything this checkout owns. */
export async function stopPreviews(deps, target) {
  for (const session of deps.store.under(target.hostId, target.checkout)) {
    // Mark it stopped BEFORE signalling: a stop the user asked for must not
    // read as a crash when the process closes with a signal code.
    deps.supervisor.clearTimer(session);
    session.state = "stopped";
    session.error = null;
    deps.store.delete(session.key);
    deps.supervisor.kill(session);
    await deps.connect.unexpose(session.port);
  }
  return { ok: true, error: null };
}

/**
 * Retry the Connect share for a live preview. Exposing already runs on every
 * start, but a transient failure leaves a paired host with a localhost-only
 * address and a dead "Share this port" button — this is what that button calls.
 */
export async function sharePreview(deps, target) {
  const session = deps.store.liveUnder(target.hostId, target.checkout)[0] ?? null;
  if (!session) return { ok: false, error: "No live preview to share." };
  session.share = await deps.connect.exposeUrl(session.port);
  if (!session.share) return { ok: false, error: "bb connect expose returned no share URL." };
  return { ok: true, error: null };
}

/** The view a live session answers with: what it already knows, no re-probe. */
function shapeFromSession(session, paired, appOrigin, source) {
  return previewShape({
    detection: session.detection,
    declared: session.declared,
    session,
    paired,
    share: session.share,
    checkout: session.checkout,
    appOrigin,
    source,
  });
}

/** The view an idle checkout answers with: what WOULD run, from the workspace. */
async function shapeFromProbe(deps, target, appOrigin) {
  const app = await deps.appRootAt(target.checkout, target.slug);
  if (!app.detection) return previewShape({ detection: null, checkout: app.root });
  return previewShape({
    detection: app.detection,
    declared: app.declared,
    paired: await deps.connect.isPaired(),
    checkout: app.root,
    appOrigin,
    source: target.source ?? null,
  });
}

/**
 * The one join the panel (RPC) and the CLI both render, so the two cannot
 * describe the same run differently. A session answers from what it already
 * knows, so refreshing a running preview re-probes nothing and shells out to
 * nothing; only "nothing is running" asks the workspace what it is.
 */
export async function previewView(deps, target, appOrigin = null) {
  const paired = await deps.connect.isPaired();
  const candidates = deps.store.under(target.hostId, target.checkout);
  const session = candidates.find(isLive) ?? candidates[0] ?? null;
  if (session) return shapeFromSession(session, paired, appOrigin, target.source ?? null);
  return shapeFromProbe(deps, target, appOrigin);
}

/**
 * A reload or disable must not leave a dev server running behind the user's
 * back: the processes are ours, so shutting them down is ours too.
 */
export function disposePreviews(deps) {
  for (const session of deps.store.all()) {
    deps.supervisor.clearTimer(session);
    deps.supervisor.kill(session);
    void deps.connect.unexpose(session.port);
  }
  deps.store.clear();
}
