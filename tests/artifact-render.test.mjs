import assert from "node:assert/strict";
import { MOCKUP_SANDBOX, artifactRenderKind } from "../lib/artifact-render.mjs";

// The decision that decides how a document under decision APPEARS. It was an
// inline regex in the viewer, where nothing could test it — so a mockup
// rendered as source text and no test noticed. These pin the three kinds and
// the one that was missing.

// --- Markdown is a document to read. ----------------------------------------
for (const path of ["spec-product.md", "interfaces_v1.mdx", "PLANS/SPEC.MD", "a/b/c.md"]) {
  assert.equal(artifactRenderKind(path), "markdown", `${path} renders as prose`);
}

// --- HTML is a page to LOOK AT, not source to read. -------------------------
// This is the assertion that fails when the html branch is deleted: both
// spellings of the extension, in any case, at any depth.
for (const path of ["mockup.html", "option-a.htm", "MOCKUPS/Option B.HTML", ".stelow/x/y/mock.htm"]) {
  assert.equal(artifactRenderKind(path), "html", `${path} is a mockup to look at`);
}

// --- Everything else is code. -----------------------------------------------
for (const path of ["state.md.bak", "notes.markdown", "index.html.txt", "server.ts", "diff.patch", "README"]) {
  assert.equal(artifactRenderKind(path), "source", `${path} is not a page`);
}

// A near-miss must not pass for a mockup: the extension is the whole signal.
// `index.html.txt` above and `notes.markdown` here are the two ways a suffix
// check gets fooled, and `x.html.bak` is the same trap from the other side.
for (const path of ["x.html.bak", "mockup.htmlx", "mock.html.css"]) {
  assert.notEqual(artifactRenderKind(path), "html", `${path} is not the mockup itself`);
}

// --- Degenerate input never throws and never guesses. ------------------------
for (const value of [null, undefined, 42, {}, []]) {
  assert.equal(artifactRenderKind(value), "source", "a non-path is not a document kind");
}
assert.equal(artifactRenderKind(""), "source");
assert.equal(artifactRenderKind("  .html  "), "html", "surrounding whitespace is not part of the extension");

// --- The sandbox keeps the reader's session out of the framed page. ---------
// `allow-scripts` without `allow-same-origin` is the whole point: the pairing
// of the two lets a framed document reach its parent's origin, where the
// reader's bb session lives. A mockup is worker-authored and untrusted.
assert.equal(MOCKUP_SANDBOX, "allow-scripts", "a mockup may run, but never reach bb's origin");
assert.doesNotMatch(MOCKUP_SANDBOX, /allow-same-origin/, "the sandbox must not hand over the parent origin");

console.log("artifact render kind ok: mockups are looked at, documents are read, code is source");
