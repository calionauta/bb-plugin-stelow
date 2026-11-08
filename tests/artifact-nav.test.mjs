/**
 * The path arithmetic behind "follow the link inside the brief".
 *
 * A brief names the stage's other documents by RELATIVE path (`alternatives.md`,
 * `../plans/spec.md`, `./contrast.json#proposal-b`). The viewer turns that into
 * the next document instead of a filename the reader has to find on the card,
 * and the server jails every read again — but the client-side rule is the one
 * that decides whether a click is navigation at all. It is also the rule that
 * must refuse to walk out of the workspace, because a worker wrote the link.
 *
 * Pure, so every refusal and every resolution is asserted without a DOM or a
 * filesystem. The wiring (a click reaching this rule) is guarded in
 * tests/artifact-viewer-navigation.test.mjs.
 */
import assert from "node:assert/strict";
import { artifactFileName, artifactLinkTarget, isViewableArtifactPath, resolveArtifactLink } from "../lib/artifact-nav.mjs";

const resolve = (currentPath, href) => resolveArtifactLink(currentPath, href);

/* ------------------------------------------------------ resolves links --- */

assert.equal(
  resolve("docs/plans/spec.md", "alternatives.md"),
  "docs/plans/alternatives.md",
  "a bare filename resolves beside the file that contains the link",
);
assert.equal(
  resolve("docs/plans/spec.md", "../briefs/contrast.md"),
  "docs/briefs/contrast.md",
  "`..` resolves up one directory from the current file, not from the workspace root",
);
assert.equal(
  resolve("docs/plans/spec.md", "./alternatives.md#proposal-a"),
  "docs/plans/alternatives.md",
  "the fragment is dropped: the viewer opens the document, never the browser's in-page anchor",
);
assert.equal(
  resolve("docs/plans/spec.md", "alternatives.md?view=raw"),
  "docs/plans/alternatives.md",
  "a query string is not part of the path",
);
assert.equal(
  resolve("docs/plans/spec.md", "my%20brief.md"),
  "docs/plans/my brief.md",
  "percent-encoded spaces resolve to the real filename",
);
assert.equal(
  resolve("docs/plans/spec.md", "/plans/spec.md"),
  "/plans/spec.md",
  "an absolute target stays absolute — the server, not the client, decides whether it is reachable",
);
assert.equal(
  resolve("docs\\plans\\spec.md", "alternatives.md"),
  "docs/plans/alternatives.md",
  "a Windows separator is normalized rather than producing a mixed path",
);

/* ------------------------------------------------------- refuses links --- */

const REFUSED = [
  ["an https URL", "docs/plans/spec.md", "https://example.com/spec.md"],
  ["a mailto address", "docs/plans/spec.md", "mailto:someone@example.com"],
  ["a protocol-relative host", "docs/plans/spec.md", "//example.com/spec.md"],
  ["a bare in-page anchor", "docs/plans/spec.md", "#proposal-a"],
  ["an empty href", "docs/plans/spec.md", ""],
  ["a whitespace href", "docs/plans/spec.md", "   "],
  ["a non-viewable image", "docs/plans/spec.md", "diagram.png"],
  ["a percent-encoded traversal", "spec.md", "%2E%2E/secret.md"],
  ["a climb above the workspace root", "spec.md", "../secret.md"],
  ["a climb above a nested root", "plans/spec.md", "../../secret.md"],
  ["a climb from an absolute root", "/plans/spec.md", "../../etc/passwd.md"],
  ["a climb buried in the middle", "a/b/spec.md", "../../../x.md"],
  ["malformed percent-encoding", "docs/spec.md", "bad%ZZ.md"],
];
for (const [name, currentPath, href] of REFUSED) {
  assert.equal(resolve(currentPath, href), null, `${name} is not a workspace document link`);
}

assert.equal(
  resolve("docs/spec.md", "spec.md"),
  "docs/spec.md",
  "a self-link still resolves — refusing it would break a table of contents",
);
for (const [currentPath, href] of [[null, "a.md"], [undefined, "a.md"], ["", "a.md"], [42, "a.md"]]) {
  assert.equal(resolve(currentPath, href), null, "a missing current path has no directory to resolve against");
}
for (const href of [null, undefined, 42, {}, []]) {
  assert.equal(resolve("docs/spec.md", href), null, "a non-string href is refused instead of throwing during a click");
}

/* ---------------------------------------------------- viewable kinds ----- */

for (const extension of ["md", "mdx", "mmd", "json", "html", "htm", "txt", "csv"]) {
  const path = `docs/document.${extension}`;
  assert.equal(isViewableArtifactPath(path), true, `.${extension} is a document the viewer can show`);
  assert.equal(resolve("docs/brief.md", `document.${extension}`), path, `.${extension} resolves as a sibling document`);
}
for (const extension of ["png", "jpg", "gif", "pdf", "zip", "ts", "js"]) {
  assert.equal(isViewableArtifactPath(`docs/file.${extension}`), false, `.${extension} is not a viewable artifact`);
}
assert.equal(isViewableArtifactPath("docs/README"), false, "a file with no extension is not classified as a document");
assert.equal(isViewableArtifactPath(null), false, "a missing path is not viewable");
assert.equal(isViewableArtifactPath(42), false, "a non-string path is not viewable");

/* ------------------------------------------------------ display name ----- */

assert.equal(artifactFileName("docs/plans/spec.md"), "spec.md", "the label is the last segment");
assert.equal(artifactFileName("docs/plans/"), "plans", "a trailing separator does not produce an empty label");
assert.equal(artifactFileName("docs\\plans\\spec.md"), "spec.md", "a Windows path labels the same file");
assert.equal(artifactFileName(null), "", "a missing path has no label");
assert.equal(artifactFileName(42), "", "a non-string path has no label");

/* ------------------------------------------------ click semantics --- */

const CLICK = { defaultPrevented: false, button: 0, href: "alternatives.md" };
assert.equal(
  artifactLinkTarget(CLICK, "docs/brief.md"),
  "docs/alternatives.md",
  "a plain primary click on a relative document link is navigation",
);
for (const [name, patch] of [
  ["meta-click", { metaKey: true }],
  ["ctrl-click", { ctrlKey: true }],
  ["shift-click", { shiftKey: true }],
  ["alt-click", { altKey: true }],
  ["middle-click", { button: 1 }],
  ["already-prevented", { defaultPrevented: true }],
  ["external", { href: "https://example.com/x.md" }],
  ["anchor", { href: "#proposal-a" }],
  ["no href", { href: null }],
]) {
  assert.equal(
    artifactLinkTarget({ ...CLICK, ...patch }, "docs/brief.md"),
    null,
    `${name} keeps the browser's own behavior instead of opening the viewer`,
  );
}

console.log("artifact nav ok: relative links resolve inside the workspace, external and escaping links refuse");
