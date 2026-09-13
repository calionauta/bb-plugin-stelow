import assert from "node:assert/strict";
import { browseHost, isLoopbackHost, localPreviewUrl, parseShareExpose, previewFrameVerdict, reachLabel, resolvePreviewReach } from "../lib/preview-reach.mjs";

// --- Bind addresses are not browse addresses. --------------------------------
assert.equal(browseHost("0.0.0.0"), "localhost");
assert.equal(browseHost("[::]"), "localhost");
assert.equal(browseHost(""), "localhost");
assert.equal(browseHost("dev.internal"), "dev.internal");
assert.equal(isLoopbackHost("127.0.0.1"), true);
assert.equal(isLoopbackHost("example.com"), false);
assert.equal(localPreviewUrl(5173), "http://localhost:5173");
assert.equal(localPreviewUrl(70000), null, "an impossible port is not a URL");
assert.equal(localPreviewUrl(null), null);

// --- The share URL is read from connect's own output, not guessed. -----------
const exposed = parseShareExpose('{"hostId":"host_a","port":5173,"url":"https://srv--5173.getbb.app"}');
assert.deepEqual(exposed, { url: "https://srv--5173.getbb.app", port: 5173, hostId: "host_a" });
assert.equal(parseShareExpose('{"url":"https://srv--5173.getbb.app"}').url, "https://srv--5173.getbb.app", "a bare share object works");
assert.equal(parseShareExpose("not json"), null);
assert.equal(parseShareExpose('{"port":5173}'), null, "no url is no share");
assert.equal(parseShareExpose('{"url":"ftp://x"}'), null, "only http(s) is a preview URL");

// --- The ladder: declared > share > local. ----------------------------------
const declared = { url: "https://staging.example.com", port: null };
assert.equal(resolvePreviewReach({ port: 5173, declared, paired: true }).provider, "declared", "the project's own words win");
assert.equal(resolvePreviewReach({ port: 5173, declared: { url: "not-a-url" } }).provider, "local", "an unusable declaration is skipped, not obeyed");

const paired = resolvePreviewReach({ port: 5173, paired: true, share: '{"url":"https://srv--5173.getbb.app","port":5173}' });
assert.equal(paired.provider, "share");
assert.equal(paired.url, "https://srv--5173.getbb.app");

// The question this answers: a server with no Tailscale and no share falls back
// to loopback — still a real URL, with the reason saying why it is only local.
const unpaired = resolvePreviewReach({ port: 5173, paired: false, share: '{"url":"https://srv--5173.getbb.app"}' });
assert.equal(unpaired.provider, "local");
assert.equal(unpaired.url, "http://localhost:5173");
assert.match(unpaired.reason, /pair bb connect/, "an unpaired server says how to become reachable");
assert.equal(resolvePreviewReach({ port: null, paired: false }), null, "no port yet is no URL");
const forced = resolvePreviewReach({ port: 5173, paired: true, share: '{"url":"https://srv--5173.getbb.app"}', localOnly: true });
assert.equal(forced.provider, "local", "a workspace that asked for local-only keeps loopback");
assert.equal(resolvePreviewReach({ port: null, paired: true, share: null, localOnly: true }), null);

// A share whose port differs from the announced one is trusted over the guess.
assert.equal(resolvePreviewReach({ port: 3000, paired: true, share: '{"url":"https://srv--5174.getbb.app","port":5174}' }).port, 5174);

// --- Framing: the rule that avoids a silently blank panel. ------------------
assert.equal(previewFrameVerdict("https://srv--5173.getbb.app", { appOrigin: "https://bb.example.com" }).mode, "frame");
assert.equal(previewFrameVerdict("http://localhost:5173", { appOrigin: "https://bb.example.com" }).mode, "frame", "loopback http is exempt from mixed-content blocking");
assert.equal(previewFrameVerdict("http://dev.internal:8080", { appOrigin: "https://bb.example.com" }).mode, "open", "a plain-http remote origin cannot be framed by an https app");
assert.equal(previewFrameVerdict("http://dev.internal:8080", { appOrigin: "http://127.0.0.1:38886" }).mode, "frame", "an http app may frame an http origin");
assert.equal(previewFrameVerdict("https://legacy.example.com", { frames: false }).mode, "open", "a stack that refuses framing is opened, not framed");
// The security rule: the panel frames with `allow-same-origin` so a dev app
// keeps its own storage, which is safe only while the framed document is a
// different origin from bb's own. Framing bb's origin would hand it bb's session.
const own = previewFrameVerdict("https://bb.example.com/dashboard", { appOrigin: "https://bb.example.com" });
assert.equal(own.mode, "open");
assert.match(own.reason, /own origin/);
assert.equal(previewFrameVerdict("https://srv--5173.getbb.app", { appOrigin: "https://bb.example.com" }).mode, "frame", "a different origin is exactly what the sandbox is for");
assert.equal(previewFrameVerdict("https://bb.example.com.evil.test", { appOrigin: "https://bb.example.com" }).mode, "frame", "a lookalike host is not the same origin");
assert.equal(previewFrameVerdict("not a url").mode, "copy");
assert.equal(previewFrameVerdict("file:///tmp/index.html").mode, "copy");

assert.equal(reachLabel({ provider: "share" }), "Shared");
assert.equal(reachLabel(null), "No address yet");

console.log("preview reach test ok: declared/share/local ladder, unpaired fallback, framing verdict");
