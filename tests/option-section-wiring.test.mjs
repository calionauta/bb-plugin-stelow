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
// The option row and the option list moved out of the stepper, and the shared
// question shapes with them: six components take the open-artifact callback, so
// the pins below name the module each one now lives in.
const optionRows = read("components/conversation/batch-options.tsx");
const batchTypes = read("components/conversation/batch-types.ts");
const sections = read("components/detail/detail-question-sections.tsx");
const inventory = read("components/artifacts/artifact-inventory.tsx");
const detailBody = read("components/detail/build-detail-body.tsx");
// The ViewerFile type moved out of the body into the view slice that owns the
// card's presentation state, so the declaration is pinned where it now lives.
const detailView = read("components/detail/build-detail-view.ts");
const dialog = read("components/detail/artifact-viewer-dialog.tsx");
const optionSection = read("components/detail/option-section.tsx");

// The call site must pass the label it is rendering. A callback that drops it
// types fine — a function taking fewer parameters is assignable — so this
// breaks silently and only shows up as the old behaviour. The option row
// moved out of the stepper into the module that renders the options, where the
// label reaches the handler as a named prop: the row binds the option's own
// label to it, and the control forwards that same label.
assert.match(
  optionRows,
  /onOpenArtifact\(artifact, artifactViewerModeForOption\(optionLabel\), optionLabel\)/,
  "the option row opens the document WITH its own label, or the section lookup never runs",
);
assert.match(
  optionRows,
  /optionLabel=\{option\.label\}/,
  "the label the control forwards is the option's own label, not a constant",
);

// One signature end to end. A narrower callback is assignable, so a dropped
// parameter at any hop typechecks; the pin is what catches it. Six components
// accept the callback: the row's document control, the row, the option list,
// the stepper, the live batch, and the expired batch — the first three live in
// the option module, the last three in the stepper.
assert.equal(
  [...optionRows.matchAll(/onOpenArtifact\?: OpenArtifactHandler/g)].length
  + [...batch.matchAll(/onOpenArtifact\?: OpenArtifactHandler/g)].length,
  6,
  "every component that accepts the callback takes the named type, so no hop can narrow it back to two parameters",
);
assert.match(
  batchTypes,
  /export type OpenArtifactHandler = \(\s*artifact: AskArtifact,\s*mode: ArtifactViewerMode,\s*optionLabel: string,\s*\) => void;/,
  "the shared type carries the label — an inline two-parameter signature would typecheck and drop it silently",
);
assert.match(sections, /optionLabel: Parameters<typeof openAskArtifact>\[5\]/, "the card's open handler forwards the label");
assert.match(inventory, /optionLabel\?: string,/, "openAskArtifact accepts the label");
assert.match(inventory, /\n    optionLabel,\n  \}\);/, "and stores it on the viewer state");

// State to render. A ViewerFile that drops the field would typecheck the read
// as `undefined` and quietly disable the feature.
assert.match(detailView, /optionLabel\?: string;/, "the card's viewer state carries the label");
assert.match(detailBody, /optionLabel=\{view\.viewerFile\?\.optionLabel\}/, "and the dialog receives it");
assert.match(dialog, /<OptionSection content=\{content\} optionLabel=\{optionLabel\} \/>/, "the dialog renders the option's section");

// The section must be shown ABOVE the document, not appended after it: the
// reader who opened a shared brief is looking for the option, and everything
// after the full document is something they have already scrolled past.
assert.ok(
  dialog.indexOf("<OptionSection") < dialog.indexOf("<ArtifactContent"),
  "the option's section comes before the full document, not after it",
);

// And it must render nothing when there is no section, rather than a wrong
// section under this option's name.
assert.match(optionSection, /if \(section === null\) return null;/, "no section for the option renders nothing, not a wrong section");
assert.match(
  optionSection,
  /Your selection · \{optionLabel\}/,
  "the panel says which option it is quoting, so it is never read as the whole document",
);

console.log("option section wiring ok: the label reaches the viewer, and the section renders before the document");
