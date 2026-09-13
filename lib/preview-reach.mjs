/**
 * Preview reach: turn a running dev server into a URL the user's client can
 * actually open, and say whether that URL may live in a panel iframe.
 *
 * Pure by design. Starting the server, exposing the port and unexposing it
 * again are effects and live in server.ts; every decision about *which* URL to
 * hand the user is here, so it is testable without a host or a network.
 *
 * Why a Connect share URL is the remote answer, not a port hand-off or a
 * tunnel we invent: BB's own builtin `share-server-links` skill says to give
 * the user a connect share URL rather than a localhost URL, and the connect
 * plugin owns the surface (`bb connect expose <port>` → `expose`/`unexpose`,
 * `bb connect shares`). Reusing it keeps this plugin from re-implementing
 * remote access, and it is the only rung that works for a bb on a server with
 * no other network arrangement.
 */

/**
 * The ladder, in priority order: the project's own words, then the share URL
 * (works from any client), then loopback (works when the client is the host).
 */
export const PREVIEW_PROVIDERS = ["declared", "share", "local"];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1", "::"]);

/** True for an address that names the machine itself, not a remote host. */
export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host ?? "").toLowerCase());
}

/**
 * A dev server binds to announce reachability, not to be browsed: `0.0.0.0`
 * and `[::]` mean "every interface". A browser cannot open those, so they
 * resolve to loopback — the address that is true for whoever runs the server.
 */
export function browseHost(host) {
  const value = String(host ?? "").trim().toLowerCase();
  if (!value || value === "0.0.0.0" || value === "::" || value === "[::]") return "localhost";
  return value;
}

/** A loopback URL for a port — the one address that needs no configuration. */
export function localPreviewUrl(port) {
  return Number.isInteger(port) && port > 0 && port < 65536 ? `http://localhost:${port}` : null;
}

/**
 * Read `bb connect expose <port> --json`. The command is the sanctioned
 * surface, so a shape this build does not recognize is ignored rather than
 * guessed at — the caller falls back to the next rung.
 */
export function parseShareExpose(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const share = Array.isArray(value?.shares) ? value.shares.find((entry) => typeof entry?.url === "string" && entry.url.trim()) : value;
  const url = typeof share?.url === "string" && /^https?:\/\//.test(share.url.trim()) ? share.url.trim().replace(/\/$/, "") : null;
  if (!url) return null;
  const port = Number.isInteger(share.port) ? share.port : null;
  return { url, port, hostId: typeof share.hostId === "string" ? share.hostId : null };
}

function originProtocol(origin) {
  const match = /^(https?):\/\//.exec(String(origin ?? ""));
  return match ? match[1] : null;
}

function sameOrigin(left, right) {
  try {
    return new URL(String(left)).origin === new URL(String(right)).origin;
  } catch {
    return false;
  }
}

/**
 * Resolve the URL to show for a running preview, and why.
 *
 * `paired` is Connect's own answer (`bb connect status --json`). It is what
 * separates the two loopback outcomes: a paired server can be reached from
 * another device, an unpaired one can only be reached from the host itself —
 * and the caller needs to say which of those the user is looking at.
 */
export function resolvePreviewReach({ port, declared, share, paired, localOnly } = {}) {
  const declaredUrl = declared && typeof declared.url === "string" && /^https?:\/\//.test(declared.url) ? declared.url : null;
  if (declaredUrl) {
    return { provider: "declared", url: declaredUrl, port: Number.isInteger(declared.port) ? declared.port : null, reason: "URL declared in .stelow/preview.json" };
  }
  const local = localPreviewUrl(port);
  if (localOnly) {
    return local
      ? { provider: "local", url: local, port, reason: "localhost — the workspace asked for local-only access" }
      : null;
  }
  const shared = paired ? parseShareExpose(share) : null;
  if (shared) {
    return { provider: "share", url: shared.url, port: shared.port ?? (Number.isInteger(port) ? port : null), reason: "bb connect share URL — reachable from any signed-in device" };
  }
  if (local) {
    return {
      provider: "local",
      url: local,
      port,
      reason: paired ? "localhost — this client is on the host" : "localhost only — pair bb connect to reach this from another device",
    };
  }
  return null;
}

/**
 * How the panel may use the resolved URL.
 *
 * - `frame` — a sandboxed iframe is safe.
 * - `open`  — hand it to `navigate.openUrl` instead: the app refused framing,
 *             or an http origin cannot be mixed into an https page.
 * - `copy`  — not a URL we can act on; show it as text.
 *
 * Loopback http survives an https app because browsers treat loopback as a
 * trustworthy origin (mixed-content checks exempt it). Some older WebKit builds
 * are stricter, which is why the panel keeps an open-in-tab fallback on every
 * framed preview rather than trusting this verdict alone.
 *
 * The same-origin refusal is a security rule, not a cosmetic one. The panel
 * frames with `allow-same-origin` so a dev app keeps its own localStorage and
 * cookies; that is safe only while the framed document is a DIFFERENT origin
 * from bb's. Framing bb's own origin with that sandbox would hand the framed
 * page bb's session.
 */
export function previewFrameVerdict(url, { appOrigin, frames } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { mode: "copy", reason: "not an HTTP(S) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { mode: "copy", reason: "not an HTTP(S) URL" };
  if (frames === false) return { mode: "open", reason: "the app refuses framing (X-Frame-Options / frame-ancestors)" };
  if (appOrigin && sameOrigin(parsed.origin, appOrigin)) {
    return { mode: "open", reason: "never frame this app's own origin" };
  }
  if (appOrigin && originProtocol(appOrigin) === "https" && parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    return { mode: "open", reason: "an https app cannot frame a plain-http origin" };
  }
  return { mode: "frame", reason: "same-scheme origin, safe to frame" };
}

/** A short label for where the URL came from, shown beside the address. */
export function reachLabel(reach) {
  if (!reach) return "No address yet";
  return { declared: "Declared", share: "Shared", local: "Local" }[reach.provider] ?? reach.provider;
}
