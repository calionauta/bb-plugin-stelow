import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  artifactDirectiveView,
  attemptWorkspaceFileOpen,
  normalizeOpenCardTarget,
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

rememberStelowReturnFocusCardId("card_123");
assert.equal(consumeStelowReturnFocusCardId("card_456"), false, "another card cannot consume the remembered focus");
assert.equal(consumeStelowReturnFocusCardId("card_123"), true, "the opened card consumes its remembered focus");
assert.equal(consumeStelowReturnFocusCardId("card_123"), false, "return focus is consumed only once");

const appSource = readFileSync("app.tsx", "utf8");
const artifactSource = readFileSync("components/messages/stelow-artifact-directive.tsx", "utf8");
const qualitySource = readFileSync("components/messages/stelow-quality-directive.tsx", "utf8");
const linkSource = readFileSync("components/messages/directive-link-button.tsx", "utf8");
assert.match(appSource, /component: OpenStelowAction/, "the extracted header action remains registered");
assert.match(appSource, /id: "stelow-artifact"[\s\S]*component: StelowArtifactDirective/, "the extracted artifact directive remains wired to its id");
assert.match(appSource, /id: "stelow-quality"[\s\S]*component: StelowQualityDirective/, "the extracted quality directive remains wired to its id");
assert.match(
  artifactSource,
  /if \(view\.kind === "invalid"\) return <InvalidDirective source=\{source\} \/>/,
  "only an invalid artifact view renders the original directive",
);
assert.match(qualitySource, /if \(!path\) return <InvalidDirective source=\{source\} \/>/, "only a malformed quality path renders the original directive");
assert.match(linkSource, /setState\(attemptWorkspaceFileOpen\(openWorkspaceFile, path\)\)/, "the shared link control stores host acceptance or refusal");
assert.match(linkSource, /unavailable \?\? children/, "a refused link replaces the normal chip content with an unavailable label");
assert.match(linkSource, /disabled=\{blocked\}/, "a refused link cannot be clicked again as if it were live");
assert.match(appSource, /ref\.current && consumeStelowReturnFocusCardId\(cardId\)/, "return focus survives a card surface without a mounted element");

console.log("message directives test ok: malformed attributes, host refusals, and worker targets");
