/**
 * Preview session bookkeeping: who owns a running dev server, what to show,
 * and what stands between the user and a URL.
 *
 * Pure by design — the spawn, the port wait and the Connect expose/unexpose
 * are effects and live in server.ts. Everything here is a decision, so it is
 * testable without a host, a process, or a network.
 *
 * The identity is the CHECKOUT (host + path), not the card. That is the thing
 * that actually owns a port: two cards on one project's source are the same
 * code, so they must share one server rather than race for the same port.
 *
 * `previewShape` is the one place detection, reach and session state meet. The
 * panel (RPC) and the CLI both render its result, so the two can never describe
 * the same run differently — and because it is pure, that join is testable
 * without a host, a process, or a network.
 */

import { previewCommand, previewLabel } from "./preview-detect.mjs";
import { previewFrameVerdict, resolvePreviewReach } from "./preview-reach.mjs";

/** How many log lines the panel keeps. A dev server is chatty; memory is not. */
export const PREVIEW_LOG_LIMIT = 200;

/** Ports below this are privileged or effectively reserved on every platform. */
export const PREVIEW_PORT_MIN = 1024;
export const PREVIEW_PORT_MAX = 65535;

/**
 * How many dev servers may run at once. A preview is started by hand, so this is
 * a ceiling on forgetting — not a scheduling policy — and it keeps one machine
 * from accumulating servers nobody is looking at.
 */
export const PREVIEW_MAX_SESSIONS = 3;

/**
 * Where the preview runs, in the user's words. The worker's own checkout is the
 * default because that is where the agent wrote the code; the project source is
 * the fallback when that environment is gone.
 */
export function previewSourceLabel(environment) {
  if (!environment) return "Project source";
  if (environment.isWorktree || environment.workspaceProvisionType === "managed-worktree") {
    return environment.branchName ? `Worker worktree · ${environment.branchName}` : "Worker worktree";
  }
  return "Project source";
}

/** The stable identity of a preview: the checkout that owns it. */
export function previewKey(hostId, path) {
  const host = typeof hostId === "string" && hostId.trim() ? hostId.trim() : "local";
  return `${host}:${String(path ?? "").trim().replace(/\/+$/, "")}`;
}

/**
 * A bounded log. Chunks arrive mid-line, so the incomplete tail is carried
 * forward instead of being split into a fake line the user would read as real
 * output.
 */
export function appendLog(state, chunk, limit = PREVIEW_LOG_LIMIT) {
  const carry = typeof state?.carry === "string" ? state.carry : "";
  const text = carry + String(chunk ?? "");
  const parts = text.split(/\r?\n/);
  const nextCarry = parts.pop() ?? "";
  const lines = [...(Array.isArray(state?.lines) ? state.lines : []), ...parts];
  return { lines: lines.slice(-limit), carry: nextCarry.slice(-4000) };
}

/** The complete text of the log, including the unfinished trailing line. */
export function previewLogText(state) {
  const lines = Array.isArray(state?.lines) ? state.lines : [];
  const carry = typeof state?.carry === "string" ? state.carry : "";
  // No carry means no unfinished line: joining an empty one would invent a
  // trailing blank line the server never printed.
  return carry ? [...lines, carry].join("\n") : lines.join("\n");
}

/**
 * Choose a port deterministically: the stack's own default when it is free,
 * otherwise the next free one — never a random port, so a restart reuses the
 * same URL and a stale share stays valid.
 */
export function pickPort(preferred, taken = [], { min = PREVIEW_PORT_MIN, max = PREVIEW_PORT_MAX } = {}) {
  const used = new Set(taken.filter((port) => Number.isInteger(port)));
  const usable = (port) => Number.isInteger(port) && port >= min && port <= max;
  // An out-of-range request is not a preference, it is a mistake: fall back to
  // the conventional port rather than honouring something unusable.
  const anchor = usable(preferred) ? preferred : 8080;
  if (!used.has(anchor)) return anchor;
  for (let offset = 1; offset <= max - min; offset += 1) {
    const candidate = min + ((anchor - min + offset) % (max - min + 1));
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * What to tell the user, in plain words, at the moment they need it. Each hint
 * names the ONE next action; nothing here is a guess, and nothing is a blocker.
 *
 * `paired` comes from bb itself (`bb connect status --json`), so the copy that
 * depends on it is never invented.
 */
export function previewHints({ paired, reach } = {}) {
  const hints = [];
  if (!paired) {
    // Lay-user copy: what works now, what is missing, and a button that
    // does something real (opens the pairing dashboard). The old text
    // highlighted "Pair bb connect" as if it were tappable and led
    // nowhere — a highlighted span is not an affordance.
    hints.push({
      tone: "info",
      text: "Only this device opens this preview — it runs on the server. To open it on your phone too, pair the server first.",
      action: "Pair the server",
      href: "https://getbb.app",
    });
  }
  if (reach?.provider === "local" && paired) {
    hints.push({
      tone: "info",
      text: "This client is on the host, so the address is localhost. Expose the port for a shareable URL.",
      action: "Share this port",
      href: null,
    });
  }
  if (reach?.provider === "declared") {
    hints.push({ tone: "info", text: "Using the URL declared in .stelow/preview.json.", action: null, href: null });
  }
  return hints;
}

/**
 * The exact command and address, rendered for the transparency line. Showing
 * this is the whole point: the user can copy it, run it themselves, and see
 * that nothing hidden happened.
 */
export function previewTransparency({ detection, command, port, checkout, provider }) {
  if (!detection) return null;
  return {
    stack: detection.framework,
    evidence: detection.evidence,
    command,
    port: Number.isInteger(port) ? port : null,
    checkout,
    provider: provider ?? null,
  };
}

/** A preview's lifecycle — the panel renders it and the RPC validates it. */
export const PREVIEW_STATES = ["stopped", "starting", "running", "failed"];

/** What an unavailable preview looks like. One shape, so callers never branch. */
export const EMPTY_PREVIEW = {
  available: false,
  error: null,
  checkout: null,
  source: null,
  label: null,
  evidence: null,
  state: "stopped",
  command: null,
  port: null,
  url: null,
  provider: null,
  reason: null,
  frame: null,
  frameReason: null,
  paired: false,
  hints: [],
  log: "",
  startedAt: null,
};

/**
 * The single join: a workspace's detection, its session (if any), and whether
 * the address is shareable, into one flat view.
 */
export function previewShape({ detection, declared = null, session = null, paired = false, share = null, checkout = null, error = null, appOrigin = null, source = null } = {}) {
  if (!detection) return { ...EMPTY_PREVIEW, checkout, error };
  const port = session?.port ?? detection.port ?? null;
  const reach = resolvePreviewReach({ port, declared, paired, share });
  // `appOrigin` is what the requesting client is served from, so the mixed-content
  // rule is decided here, against a real origin, instead of by every caller.
  const frame = reach ? previewFrameVerdict(reach.url, { appOrigin, frames: detection.frames }) : null;
  const shown = previewTransparency({
    detection,
    command: session?.command ?? previewCommand(detection, port),
    port,
    checkout,
    provider: reach?.provider ?? null,
  });
  return {
    available: true,
    error: session?.error ?? error,
    checkout,
    source: source ?? null,
    label: previewLabel(detection),
    evidence: shown?.evidence ?? null,
    state: session?.state ?? "stopped",
    command: shown?.command ?? null,
    port: shown?.port ?? null,
    url: reach?.url ?? null,
    provider: reach?.provider ?? null,
    reason: reach?.reason ?? null,
    frame: frame?.mode ?? null,
    frameReason: frame?.reason ?? null,
    paired: Boolean(paired),
    hints: previewHints({ paired, reach }),
    log: session ? previewLogText(session.log) : "",
    startedAt: session?.startedAt ?? null,
  };
}

/**
 * The same view the panel shows, as text a worker or terminal can read. One
 * renderer for both keeps the two from ever describing a run differently — and
 * it always names the command and the checkout, so nothing about the run is
 * hidden from whoever is looking at it.
 */
export function previewText(view) {
  if (!view) return "No preview.\n";
  if (!view.available) return `${view.error ?? "No web app detected in this workspace."}\n`;
  const lines = [`${view.label ?? "Web app"} — ${view.state}`];
  if (view.source) lines.push(`  running in ${view.source}`);
  if (view.checkout) lines.push(`  workspace  ${view.checkout}`);
  if (view.evidence) lines.push(`  detected   ${view.evidence}`);
  if (view.command) lines.push(`  command    ${view.command}`);
  if (Number.isInteger(view.port)) lines.push(`  port       ${view.port}`);
  if (view.url) lines.push(`  address    ${view.url}${view.provider ? `  [${view.provider}]` : ""}`);
  if (view.reason) lines.push(`  note       ${view.reason}`);
  if (view.error) lines.push(`  error      ${view.error}`);
  for (const hint of Array.isArray(view.hints) ? view.hints : []) {
    lines.push(`\n  ${hint.text}${hint.action ? ` → ${hint.action}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}


/** Whether the panel should offer Start or Stop for a state. */
export function previewAction(state, hasDetection) {
  if (!hasDetection) return "none";
  if (state === "running" || state === "starting") return "stop";
  return "start";
}
