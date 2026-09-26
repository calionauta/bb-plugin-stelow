import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The option's section lookup is covered behaviourally in
// tests/option-anchor.test.mjs, against the real brief that started this. What
// cannot be tested there is the WIRING: the label has to travel from the option
// row, through the open-artifact callback, into the viewer state, or the lookup
// never runs and the reader lands on the document's first line — which is
// exactly the bug it fixes, silently.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const batch = read("components/conversation/question-batch.tsx");
const sections = read("components/detail/detail-question-sections.tsx");
const inventory = read("components/artifacts/artifact-inventory.tsx");
const detailBody = read("components/detail/build-detail-body.tsx");
const dialog = read("components/detail/artifact-viewer-dialog.tsx");
const optionSection = read("components/detail/option-section.tsx");

// The call site must pass the label it is rendering. A callback that drops it
// types fine — a function taking fewer parameters is assignable — so this
// breaks silently and only shows up as the old behaviour.
assert.match(
  batch,
  /onOpenArtifact\(artifact, artifactViewerModeForOption\(option\.label\), option\.label\)/,
  "the option row opens the document WITH its own label, or the section lookup never runs",
);

// One signature end to end. A narrower callback is assignable, so a dropped
// parameter at any hop typechecks; the pin is what catches it.
assert.equal(
  (batch.match(/onOpenArtifact\?: OpenArtifactHandler/g) ?? []).length,
  5,
  "every component that accepts the callback takes the named type, so no hop can narrow it back to two parameters",
);
assert.match(
  batch,
  /export type OpenArtifactHandler = \(\s*artifact: AskArtifact,\s*mode: ArtifactViewerMode,\s*optionLabel: string,\s*\) => void;/,
  "the shared type carries the label — an inline two-parameter signature would typecheck and drop it silently",
);
assert.match(sections, /optionLabel: Parameters<typeof openAskArtifact>\[5\]/, "the card's open handler forwards the label");
assert.match(inventory, /optionLabel\?: string,/, "openAskArtifact accepts the label");
assert.match(inventory, /\n    optionLabel,\n  \}\);/, "and stores it on the viewer state");

// State to render. A ViewerFile that drops the field would typecheck the read
// as `undefined` and quietly disable the feature.
assert.match(detailBody, /optionLabel\?: string;/, "the card's viewer state carries the label");
assert.match(detailBody, /optionLabel=\{view\.viewerFile\?\.optionLabel\}/, "and the dialog receives it");
assert.match(
  dialog,
  /<OptionSection content=\{content\} optionLabel=\{optionLabel\} containerRef=\{scrollRef\} \/>/,
  "the dialog renders the option's section",
);

// The option is scrolled to INSIDE the document, not quoted above it. Lifting
// the section duplicates the reader's own text and makes the brief read as two
// documents; the host already rendered the headings inside a scroll container
// this component owns, so one scrollIntoView is enough.
assert.match(
  optionSection,
  /target\.scrollIntoView\(\{ block: "start" \}\)/,
  "the reader is taken to the option's heading inside the document",
);
assert.match(
  dialog,
  /scrollRef=\{scrollRef\}/,
  "the document's scroll container is handed to the option lookup, or there is nothing to scroll",
);
assert.match(
  dialog,
  /<div ref=\{scrollRef\} className="max-h-\[46dvh\] overflow-auto/,
  "the container the headings live in is the one that scrolls",
);

// The DOM comparison reuses the pure matcher's key. A second, looser copy in
// the UI is how the scroll starts disagreeing with the anchor.
assert.match(
  optionSection,
  /import \{ optionSectionExcerpt, sectionHeadingsMatch \} from "\.\.\/\.\.\/lib\/option-anchor\.mjs";/,
  "the UI calls the pure matcher instead of restating its rule inline",
);
// The import alone is not enough: an inline predicate leaves the import in
// place while the comparison stops being the tested one. Pin the call, with
// both operands, so replacing it with any local heuristic fails here. The DOM
// path itself cannot be unit-tested, so this is the only place the two can be
// caught drifting apart.
assert.match(
  optionSection,
  /\.find\(\(node\) => sectionHeadingsMatch\(node\.textContent, section\.heading\)\)/,
  "the rendered heading is compared with the SHARED matcher, on the heading the scan resolved",
);

// The lifted section is the FALLBACK, not the primary: shown only when the
// heading is absent from the rendered DOM, never on top of a working scroll,
// and never a wrong section under this option's name.
assert.match(
  optionSection,
  /if \(!target\) \{\s*setNeedsFallback\(true\);/,
  "a missing heading is what promotes the excerpt, not the default path",
);
assert.match(
  optionSection,
  /if \(!section \|\| !needsFallback\) return null;/,
  "a working scroll shows nothing extra — the document is not quoted twice",
);
assert.match(
  optionSection,
  /Your selection · \{optionLabel\}/,
  "the fallback says which option it is quoting, so it is never read as the whole document",
);

console.log("option section wiring ok: the label reaches the viewer, the option is scrolled to, and the excerpt is only a fallback");
