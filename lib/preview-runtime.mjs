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
 * racing for the same port. That is also why a session is found by its
 * checkout and not by asking which card started it — a card whose worktree was
 * recreated must not be handed the server of the directory it used to own.
 *
 * Nothing here is configured per card. The workspace is probed, the stack
 * answers, and `.stelow/preview.json` is the only override.
 */

import {
  PREVIEW_CONFIG_REL,
  PREVIEW_PROBE_FILES,
  detectPreview,
  parseDeclaredPreview,
  pickAppDir,
  previewAppDirs,
  previewCommand,
  previewFailed,
  previewReady,
  previewSnapshot,
} from "./preview-detect.mjs";
import { parseShareExpose } from "./preview-reach.mjs";
import {
  PREVIEW_LOG_LIMIT,
  PREVIEW_MAX_SESSIONS,
  appendLog,
  pickPort,
  previewKey,
  previewLogText,
  previewShape,
} from "./preview-session.mjs";

/** Connect's own answer moves only when the user pairs; the panel asks often. */
const PAIRED_TTL_MS = 30_000;

/** How long a TERMed process gets to exit before it is killed outright. */
const KILL_GRACE_MS = 5_000;

/**
 * @param {object} effects
 * @param {(path: string) => Promise<string | null>} effects.readFile      one file's text, or null
 * @param {(dir: string) => string[]}               effects.listDirs      child directory names
 * @param {(...parts: string[]) => string}          effects.joinPath      path join for the host running the server
 * @param {(command: string, options: { cwd: string, env: Record<string, string> }) => object} effects.spawnProcess
 * @param {(args: string[]) => Promise<object | null>} effects.runConnect `bb connect <args> --json`, parsed
 * @param {() => number}                            [effects.now]
 * @param {Record<string, string>}                  [effects.baseEnv]
 */
export function createPreviewRuntime({ readFile, listDirs, joinPath, spawnProcess, runConnect, now = () => Date.now(), baseEnv = {} }) {
  /** Live previews by checkout. A stopped one is gone, not remembered. */
  const sessions = new Map();
  let pairedCache = null;

  const isLive = (session) => session.state === "starting" || session.state === "running";

  /**
   * Every session belonging to a checkout — the checkout itself, or a
   * subdirectory of it, which is where `previewAppDirs` allows the app to sit.
   * Resolving this by path is what keeps a stale session from answering for a
   * worktree that has since been recreated somewhere else.
   */
  function sessionsUnder(hostId, checkout) {
    const prefix = previewKey(hostId, checkout);
    return [...sessions.values()].filter((session) => session.key === prefix || session.key.startsWith(`${prefix}/`));
  }

  /** Detection for one directory, with that directory's declared override applied. */
  async function detectionAt(dir) {
    const entries = await Promise.all(PREVIEW_PROBE_FILES.map(async (rel) => [rel, await readFile(joinPath(dir, rel))] ));
    const snapshot = previewSnapshot(new Map(entries.filter((entry) => typeof entry[1] === "string")));
    const declared = snapshot.read(PREVIEW_CONFIG_REL);
    return { detection: detectPreview(snapshot, { declared, allowStatic: true }), declared: parseDeclaredPreview(declared) };
  }

  /**
   * Where the app actually is, and what it is. The checkout root first; when
   * nothing there is a web app, exactly one level down — agents routinely put
   * the deliverable in a subdirectory named after the work, and a root-only
   * search would answer "nothing to preview" for a finished product.
   *
   * A self-contained `index.html` counts: it is a deliverable, and it is served
   * from its own directory, so nothing above it is ever exposed.
   */
  async function appRootAt(checkout, slug) {
    const atRoot = await detectionAt(checkout);
    if (atRoot.detection) return { ...atRoot, root: checkout };
    const probes = new Map();
    // Sequential on purpose: each probe fans out over PREVIEW_PROBE_FILES, so
    // scanning every directory at once would be hundreds of concurrent reads
    // against a host that may be across a network.
    for (const name of previewAppDirs(listDirs(checkout))) {
      const probe = await detectionAt(joinPath(checkout, name));
      if (probe.detection) probes.set(name, probe);
    }
    const chosen = pickAppDir([...probes.keys()], slug);
    const probe = chosen ? probes.get(chosen) : null;
    return probe ? { ...probe, root: joinPath(checkout, chosen) } : { detection: null, declared: null, root: checkout };
  }

  function kill(session) {
    const child = session.child;
    if (!child || child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, KILL_GRACE_MS);
    timer.unref?.();
  }

  /** Drop the port's share. Best-effort and idempotent: a missing tunnel is fine. */
  async function unexpose(session) {
    await runConnect(["unexpose", String(session.port)]).catch(() => null);
  }

  /** Connect's own answer, read and briefly cached. Fail-soft: unpaired is safe. */
  async function isPaired() {
    if (pairedCache && now() - pairedCache.at < PAIRED_TTL_MS) return pairedCache.value;
    const parsed = await runConnect(["status"]).catch(() => null);
    const value = Boolean(parsed && parsed.paired);
    pairedCache = { at: now(), value };
    return value;
  }

  /** A live server asks Connect for a share URL. A bonus, never a gate. */
  async function goLive(session) {
    session.state = "running";
    const parsed = await runConnect(["expose", String(session.port)]);
    session.share = parsed ? parseShareExpose(parsed) : null;
  }

  /**
   * The process ended. A close after our own stop must not read as a crash, so
   * a deliberately stopped session is already out of the store by then.
   */
  function settle(session, code) {
    session.child = null;
    if (!sessions.has(session.key)) return;
    if (code === 0) sessions.delete(session.key);
    else if (session.state !== "failed") {
      session.state = "failed";
      session.error = `The dev server exited with code ${code ?? "unknown"}.`;
    }
    void unexpose(session);
  }

  /** Start the checkout's dev server, or report the one next action that blocks it. */
  async function start(target) {
    if (sessionsUnder(target.hostId, target.checkout).some(isLive)) return { ok: true, error: null };
    const app = await appRootAt(target.checkout, target.slug);
    if (!app.detection) return { ok: false, error: "No web app detected in this workspace." };
    const live = [...sessions.values()].filter(isLive);
    if (live.length >= PREVIEW_MAX_SESSIONS) {
      return { ok: false, error: `Stop one of the ${PREVIEW_MAX_SESSIONS} running previews first.` };
    }
    const port = pickPort(app.detection.port, live.map((session) => session.port));
    if (port === null) return { ok: false, error: "No free port is available." };

    const session = {
      key: previewKey(target.hostId, app.root),
      checkout: app.root,
      command: previewCommand(app.detection, port),
      port,
      state: "starting",
      detection: app.detection,
      declared: app.declared,
      log: { lines: [], carry: "" },
      error: null,
      startedAt: now(),
      share: null,
      child: null,
    };
    sessions.set(session.key, session);

    // Loopback only: Connect shares loopback ports, and a dev server bound to
    // every interface would be reachable without the account gate that makes a
    // share safe.
    const env = { ...baseEnv, PORT: String(port), HOST: "127.0.0.1", BROWSER: "none", CI: "1" };
    let child;
    try {
      child = spawnProcess(session.command, { cwd: app.root, env });
    } catch (error) {
      session.state = "failed";
      session.error = error instanceof Error ? error.message : "Unable to start the dev server.";
      return { ok: false, error: session.error };
    }
    session.child = child;

    const absorb = (chunk) => {
      session.log = appendLog(session.log, String(chunk ?? ""), PREVIEW_LOG_LIMIT);
      // Once a server is up its output is a log, not a verdict: a later line
      // must never flip a running preview to failed.
      if (session.state !== "starting") return;
      const text = previewLogText(session.log);
      const failure = previewFailed(text);
      if (failure) {
        session.state = "failed";
        session.error = failure;
        return;
      }
      if (previewReady(text, port)) void goLive(session);
    };
    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);
    child.on("error", (error) => {
      session.state = "failed";
      session.error = error instanceof Error ? error.message : "Unable to start the dev server.";
    });
    child.on("close", (code) => settle(session, code));
    return { ok: true, error: null };
  }

  /** Stop everything this checkout owns. */
  async function stop(target) {
    for (const session of sessionsUnder(target.hostId, target.checkout)) {
      // Mark it stopped BEFORE signalling: a stop the user asked for must not
      // read as a crash when the process closes with a signal code.
      session.state = "stopped";
      session.error = null;
      sessions.delete(session.key);
      kill(session);
      await unexpose(session);
    }
    return { ok: true, error: null };
  }

  /**
   * The one join the panel (RPC) and the CLI both render, so the two cannot
   * describe the same run differently.
   *
   * A session answers from what it already knows, so refreshing a running
   * preview re-probes nothing and shells out to nothing; only "nothing is
   * running" asks the workspace what it is.
   */
  async function view(target, appOrigin = null) {
    const paired = await isPaired();
    const candidates = sessionsUnder(target.hostId, target.checkout);
    const session = candidates.find(isLive) ?? candidates[0] ?? null;
    if (session) {
      return previewShape({
        detection: session.detection,
        declared: session.declared,
        session,
        paired,
        share: session.share,
        checkout: session.checkout,
        appOrigin,
        source: target.source ?? null,
      });
    }
    const app = await appRootAt(target.checkout, target.slug);
    if (!app.detection) return previewShape({ detection: null, checkout: app.root });
    return previewShape({
      detection: app.detection,
      declared: app.declared,
      paired,
      checkout: app.root,
      appOrigin,
      source: target.source ?? null,
    });
  }

  /**
   * A reload or disable must not leave a dev server running behind the user's
   * back: the processes are ours, so shutting them down is ours too.
   */
  function dispose() {
    for (const session of sessions.values()) {
      kill(session);
      void unexpose(session);
    }
    sessions.clear();
  }

  return { start, stop, view, dispose };
}
