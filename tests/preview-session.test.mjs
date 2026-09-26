import assert from "node:assert/strict";
import { PREVIEW_MAX_SESSIONS, appendLog, pickPort, previewAction, previewHints, previewKey, previewLogText, previewShape, previewSourceLabel, previewText, previewTransparency } from "../lib/preview-session.mjs";

// --- The identity is the checkout, so two cards on one source share a server.
assert.equal(previewKey("host_a", "/srv/app/"), previewKey("host_a", "/srv/app"), "a trailing slash is the same checkout");
assert.notEqual(previewKey("host_a", "/srv/app"), previewKey("host_b", "/srv/app"), "the same path on another host is another server");
assert.equal(previewKey(null, "/srv/app"), "local:/srv/app");
assert.notEqual(previewKey("host_a", "/srv/app"), previewKey("host_a", "/srv/app-worktree"), "a worktree is its own checkout");

// --- The log is bounded and never fabricates a line from a partial read. ----
let log = appendLog(null, "first line\nsecond");
assert.deepEqual(log.lines, ["first line"]);
assert.equal(log.carry, "second");
log = appendLog(log, " line done\nthird\n");
assert.deepEqual(log.lines, ["first line", "second line done", "third"]);
assert.equal(previewLogText(log), "first line\nsecond line done\nthird", "a complete log has no invented trailing line");
assert.equal(previewLogText({ lines: ["a"], carry: "half" }), "a\nhalf", "the unfinished tail is still shown");
const capped = appendLog({ lines: Array.from({ length: 200 }, () => "x"), carry: "" }, "overflow\n");
assert.equal(capped.lines.length, 200, "a chatty server cannot grow the state without bound");
assert.equal(capped.lines.at(-1), "overflow");

// --- Ports are deterministic: a restart reuses the address the user bookmarked.
assert.equal(pickPort(5173, []), 5173, "the framework's own default wins when free");
assert.equal(pickPort(5173, [5173]), 5174, "a taken port steps to the next one");
assert.equal(pickPort(5173, [5173, 5174, 5175]), 5176);
assert.equal(pickPort(null, []), 8080, "an unknown stack gets a conventional port");
assert.equal(pickPort(80, []), 8080, "a privileged request is not a preference; it falls back to the conventional port");
assert.equal(pickPort(65535, [65535]), 1024, "the scan wraps instead of overflowing");
assert.equal(pickPort(5173, [5173]), pickPort(5173, [5173]), "the choice is stable, so the URL is stable");

// --- Hints: one next action each, and none of them a blocker. ---------------
assert.equal(previewHints({ paired: true, reach: { provider: "share" } }).length, 0, "a paired server reachable by share needs no instruction");
const unpaired = previewHints({ paired: false, reach: { provider: "local" } });
assert.equal(unpaired.length, 1);
assert.equal(unpaired[0].action, "Pair the server");
assert.equal(unpaired[0].href, "https://getbb.app", "the pair action navigates somewhere real");
assert.match(unpaired[0].text, /only this device opens/i, "the unpaired hint says what works and what is missing");
const localPaired = previewHints({ paired: true, reach: { provider: "local" } });
assert.equal(localPaired[0].action, "Share this port");
const declared = previewHints({ paired: true, reach: { provider: "declared" } });
assert.equal(declared.length, 1);
assert.equal(declared[0].text, "Using the URL declared in .stelow/preview.json.");

// --- Transparency: the exact thing that will run, copyable by the user. -----
assert.equal(previewTransparency({ detection: null, command: "x", port: 1, checkout: "/x" }), null);
const shown = previewTransparency({ detection: { framework: "vite", evidence: "vite in dependencies, npm run dev" }, command: "npm run dev --port 5174", port: 5174, checkout: "/srv/app", provider: "share" });
assert.equal(shown.command, "npm run dev --port 5174");
assert.equal(shown.checkout, "/srv/app");
assert.equal(shown.provider, "share");

// --- The button is only ever Start or Stop. --------------------------------
assert.equal(previewAction("stopped", true), "start");
assert.equal(previewAction("failed", true), "start");
assert.equal(previewAction("starting", true), "stop");
assert.equal(previewAction("running", true), "stop");
assert.equal(previewAction("running", false), "none", "no web app, no button");

// --- The text view the CLI prints names everything the panel shows. ---------
const text = previewText({
  available: true, label: "Vite", state: "running", checkout: "/srv/app",
  evidence: "vite in dependencies, npm run dev", command: "npm run dev --port 5174",
  port: 5174, url: "https://srv--5174.getbb.app", provider: "share",
  reason: "bb connect share URL — reachable from any signed-in device",
  hints: [{ tone: "info", text: "Only this device opens", action: "Pair the server", href: "https://getbb.app" }],
});
assert.match(text, /Vite — running/);
assert.match(text, /workspace {2}\/srv\/app/);
assert.match(text, /command {4}npm run dev --port 5174/, "the exact command is never hidden");
assert.match(text, /address {4}https:\/\/srv--5174\.getbb\.app {2}\[share\]/);
assert.equal(previewText({ available: false, error: "No web app detected in this workspace." }), "No web app detected in this workspace.\n");
assert.equal(previewText({ available: false }), "No web app detected in this workspace.\n", "an unavailable preview still says why");
assert.equal(previewText(null), "No preview.\n");

// --- The join: detection + session + reach, which is what the panel renders. --
const vite = { framework: "vite", evidence: "vite in dependencies, npm run dev", command: "npm run dev", port: 5173, portFlag: "--port", frames: true, tier: "framework" };
const django = { framework: "django", evidence: "manage.py", command: "python3 manage.py runserver", port: 8000, portFlag: "arg", frames: false, tier: "framework" };

// Nothing to run is an honest "no", not an empty panel.
const none = previewShape({ detection: null, checkout: "/srv/lib" });
assert.equal(none.available, false);
assert.equal(none.checkout, "/srv/lib");
assert.equal(none.url, null);
assert.equal(none.state, "stopped");
assert.equal(previewShape({ error: "Workspace path is unavailable." }).error, "Workspace path is unavailable.");

// A stopped preview still shows what WOULD run and where it would be — the
// user decides from that, so it must be visible before pressing anything.
const stopped = previewShape({ detection: vite, checkout: "/srv/app" });
assert.equal(stopped.available, true);
assert.equal(stopped.state, "stopped");
assert.equal(stopped.label, "Vite");
assert.equal(stopped.command, "npm run dev --port 5173", "the command is shown before it is run");
assert.equal(stopped.url, "http://localhost:5173");
assert.equal(stopped.provider, "local");
assert.equal(stopped.frame, "frame");
assert.equal(stopped.hints[0].action, "Pair the server");

// Paired and shared: the address is the share, and the hint disappears.
const shared = previewShape({ detection: vite, session: { port: 5174, command: "npm run dev --port 5174", state: "running", startedAt: 42 }, paired: true, share: { url: "https://srv--5174.getbb.app", port: 5174 }, checkout: "/srv/app" });
assert.equal(shared.state, "running");
assert.equal(shared.url, "https://srv--5174.getbb.app");
assert.equal(shared.provider, "share");
assert.equal(shared.frame, "frame");
assert.equal(shared.hints.length, 0, "a working share needs no instruction");
assert.equal(shared.startedAt, 42);
assert.equal(shared.port, 5174, "the session's port beats the framework's default");

// The rule that would otherwise be dead code: a client served over https cannot
// frame a plain-http origin, and the verdict has to be decided for that client.
assert.equal(previewShape({ detection: vite, session: { port: 8080, state: "running" }, paired: true, share: { url: "http://dev.internal:8080" } }).frame, "frame", "without an app origin there is nothing to refuse");
const mixed = previewShape({ detection: vite, session: { port: 8080, state: "running" }, paired: true, share: { url: "http://dev.internal:8080" }, appOrigin: "https://bb.example.com" });
assert.equal(mixed.frame, "open");
assert.match(mixed.frameReason, /https app cannot frame/);

// A stack that refuses framing is opened, because a blank iframe is worse.
assert.equal(previewShape({ detection: django, checkout: "/srv/dj" }).frame, "open");
assert.equal(previewShape({ detection: django, checkout: "/srv/dj" }).command, "python3 manage.py runserver 8000", "a command with no port flag still gets the port it needs");

// The project's declared URL wins over the share, and the session's failure is
// reported without hiding the address the user could still try.
const declaredWins = previewShape({ detection: vite, declared: { url: "https://staging.example.com" }, paired: true, share: { url: "https://srv--5173.getbb.app" } });
assert.equal(declaredWins.provider, "declared");
assert.equal(declaredWins.url, "https://staging.example.com");
const failed = previewShape({ detection: vite, session: { port: 5173, state: "failed", error: "Error: listen EADDRINUSE", log: { lines: ["boom"], carry: "" } } });
assert.equal(failed.state, "failed");
assert.equal(failed.error, "Error: listen EADDRINUSE");
assert.equal(failed.url, "http://localhost:5173", "a failure still says where the address would be");
assert.equal(failed.log, "boom", "the log is what explains the failure");
assert.equal(previewShape({ detection: vite, session: { port: 5173, state: "running", log: { lines: ["a"], carry: "b" } } }).log, "a\nb", "the unfinished line is part of the log");

// --- The preview names the codebase it runs, and the cap is a real ceiling. --
// A `new-worktree` card's code is elsewhere; without this label the user would
// have no way to know which checkout they are looking at.
assert.equal(previewSourceLabel({ isWorktree: true, branchName: "bb/fix-login-thr_ab12" }), "Worker worktree · bb/fix-login-thr_ab12");
assert.equal(previewSourceLabel({ workspaceProvisionType: "managed-worktree" }), "Worker worktree");
assert.equal(previewSourceLabel({ workspaceProvisionType: "unmanaged", isWorktree: false }), "Project source");
assert.equal(previewSourceLabel(null), "Project source", "no environment means the project source is what is running");
assert.ok(PREVIEW_MAX_SESSIONS >= 1 && PREVIEW_MAX_SESSIONS <= 5, "the cap must be small enough to stay light on the machine");
const labelled = previewShape({ detection: vite, checkout: "/srv/wt", source: "Worker worktree · bb/x" });
assert.equal(labelled.source, "Worker worktree · bb/x");
assert.match(previewText(labelled), /running in Worker worktree · bb\/x/);
assert.equal(previewShape({ detection: vite }).source, null);

console.log("preview session test ok: checkout identity, bounded log, stable port, hints, transparency, text view, composition, source label");
