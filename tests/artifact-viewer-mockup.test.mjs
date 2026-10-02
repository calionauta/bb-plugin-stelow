import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The decision (which kind a path is) is covered behaviourally in
// tests/artifact-render.test.mjs. What cannot be tested there is the WIRING:
// the viewer has to ask for that decision and render the mockup as a page. A
// viewer that keeps its own inline extension test typechecks fine and shows
// source text — which is exactly the gap this closes, silently.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dialog = readFileSync(join(root, "components/detail/artifact-viewer-dialog.tsx"), "utf8");

// The viewer asks the shared module instead of restating the rule. The import
// alone is not enough — an inline regex would leave it in place while the
// rendering stopped being the tested one.
assert.match(
  dialog,
  /import \{ MOCKUP_SANDBOX, artifactRenderKind \} from "\.\.\/\.\.\/lib\/artifact-render\.mjs";/,
  "the viewer calls the pure kind function rather than restating the extension rule",
);
assert.match(
  dialog,
  /const kind = artifactRenderKind\(path\);/,
  "the render decision comes from the module, on the document's own path",
);
assert.doesNotMatch(
  dialog,
  /\/\\\.mdx\?\$\/i\.test/,
  "the old inline markdown test is gone, not merely shadowed by the new branch",
);

// A mockup is rendered as a page, and the branch that does it is reachable:
// `asMockup` is what the ternary actually reads.
assert.match(dialog, /const asMockup = kind === "html" && !truncated;/, "only a complete html file is framed");
assert.match(dialog, /: asMockup \? <MockupFrame html=\{content\} title=\{`\$\{path\} — interface mockup`\} \/>/, "the mockup branch renders the frame");
assert.match(dialog, /kind === "markdown" \? <div className="text-sm leading-relaxed">/, "markdown keeps rendering as prose");

// The sandbox is the security-relevant half, and it must come from the shared
// constant: a hand-typed string here is how `allow-same-origin` gets added
// later without anyone noticing it was load-bearing.
assert.match(dialog, /sandbox=\{MOCKUP_SANDBOX\}/, "the frame uses the shared sandbox constant");
assert.doesNotMatch(dialog, /sandbox="[^"]*allow-same-origin/, "the viewer never hand-writes a sandbox that grants bb's origin");

// A truncated page is not the artifact. A partial mockup renders as a broken
// layout presented as evidence, so it degrades to source — and says why.
assert.match(
  dialog,
  /Truncated — shown as source, because a partial page is not the mockup\./,
  "a truncated mockup says it was not framed, instead of quietly showing a broken page",
);

console.log("artifact viewer wiring ok: a mockup is looked at, a document is read, and the sandbox is the shared one");
