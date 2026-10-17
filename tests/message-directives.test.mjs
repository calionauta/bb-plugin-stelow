import assert from "node:assert/strict";
import {
  artifactDirectiveView,
  attemptWorkspaceFileOpen,
  normalizeOpenCardTarget,
  openCardTargetForThread,
  workspaceDirectivePath,
} from "../lib/message-directives.mjs";
import { consumeStelowReturnFocusCardId, rememberStelowReturnFocusCardId } from "../components/panel/stelow-focus.mjs";

assert.equal(workspaceDirectivePath("./docs/./brief.md"), "docs/brief.md", "relative paths lose only leading dot segments");
assert.equal(workspaceDirectivePath("docs/brief.md"), "docs/brief.md", "a normal workspace-relative path stays unchanged");
for (const value of [
  undefined,
  null,
  42,
  "",
  "   ",
  "/tmp/brief.md",
  "C:\\tmp\\brief.md",
  "C:brief.md",
  "\\\\server\\share\\brief.md",
  "\\secret.txt",
  "\\?\\C:\\secret.txt",
  "file:///etc/passwd",
  "../brief.md",
  "docs/../brief.md",
  "docs/\0brief.md",
]) {
  assert.equal(workspaceDirectivePath(value), null, `malformed path is refused: ${String(value)}`);
}
assert.deepEqual(
  artifactDirectiveView({ path: "./output/report.md", display: "  Report  " }),
  { kind: "ready", path: "output/report.md", display: "Report" },
  "artifact display trims the optional label",
);
assert.deepEqual(
  artifactDirectiveView({ path: "output/report.md" }),
  { kind: "ready", path: "output/report.md", display: "report.md" },
  "artifact display falls back to the basename",
);
assert.deepEqual(
  artifactDirectiveView({ path: "output/report.md", display: 42 }),
  { kind: "ready", path: "output/report.md", display: "report.md" },
  "a non-string display falls back to the basename",
);
assert.deepEqual(
  artifactDirectiveView({ path: "output/report.md", display: "   " }),
  { kind: "ready", path: "output/report.md", display: "report.md" },
  "a blank display falls back to the basename",
);
assert.deepEqual(artifactDirectiveView({ path: "../report.md" }), { kind: "invalid" }, "an unsafe artifact path never becomes a link");
assert.deepEqual(artifactDirectiveView(null), { kind: "invalid" }, "a malformed attribute object never becomes a link");

assert.equal(attemptWorkspaceFileOpen(() => true, "docs/brief.md"), "opened", "an accepted host open reports opened");
assert.equal(attemptWorkspaceFileOpen(() => false, "docs/brief.md"), "dead", "a declined host open reports a dead link");
assert.equal(attemptWorkspaceFileOpen(null, "docs/brief.md"), "unavailable", "a message without a workspace viewer is unavailable");
assert.equal(attemptWorkspaceFileOpen(() => { throw new Error("gone"); }, "docs/brief.md"), "failed", "a throwing host open is contained as a failed link");
assert.deepEqual(
  normalizeOpenCardTarget({ cardId: "card_123", kind: "research" }),
  { cardId: "card_123", kind: "research" },
  "a valid worker target keeps its track",
);
assert.deepEqual(
  normalizeOpenCardTarget({ cardId: "card_123", kind: "unknown" }),
  { cardId: "card_123", kind: "build" },
  "an unknown track safely defaults to build",
);
assert.equal(normalizeOpenCardTarget({ cardId: "not-a-card" }), null, "a malformed worker target never navigates");
const loadedTarget = { threadId: "thread_a", target: { cardId: "card_123", kind: "build" } };
assert.deepEqual(
  openCardTargetForThread(loadedTarget, "thread_a"),
  loadedTarget.target,
  "the card target is available for the thread that loaded it",
);
assert.equal(
  openCardTargetForThread(loadedTarget, "thread_b"),
  null,
  "a stale target from the previous thread cannot be clicked in the new thread header",
);

rememberStelowReturnFocusCardId("card_123");
assert.equal(consumeStelowReturnFocusCardId("card_456"), false, "another card cannot consume the remembered focus");
assert.equal(consumeStelowReturnFocusCardId("card_123"), true, "the opened card consumes its remembered focus");
assert.equal(consumeStelowReturnFocusCardId("card_123"), false, "return focus is consumed only once");

console.log("message directives test ok: malformed attributes, host refusals, and worker targets");
