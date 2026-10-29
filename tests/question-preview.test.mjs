/**
 * An option's preview: what shape it is, and which branch the row renders.
 *
 * An option's `--preview` is evidence the reader judges the option BY. Two
 * shapes are possible, and the worker chooses by what it writes:
 *
 *   - a fenced ```mermaid block is a diagram, drawn by the same viewer the brief
 *     uses;
 *   - anything else is a wireframe, kept verbatim in a monospace block.
 *
 * Progressive disclosure, not the old "Preview" disclosure. A five-line
 * wireframe is a glance and renders whole. A longer one keeps a clipped peek
 * with a fade and one labelled button ("Show preview"), so the row stays
 * scannable without hiding the evidence behind an underlined summary. A
 * diagram starts behind "Show diagram": a partial diagram is not a useful
 * glance, and drawing four of them at once is what made the question taller
 * than the screen.
 *
 * The rendered half stubs `mermaid-diagram`: `MermaidDiagram` itself is covered
 * in tests/mermaid-diagram-zoom.test.mjs and tests/artifact-viewer-diagram.test.mjs,
 * including what it does when the renderer refuses a source. What is asserted
 * here is that the row CHOOSES the component for a mermaid preview, never
 * dumps the raw fence, and applies the peek/expand rule.
 */
import assert from "node:assert/strict";
import { loadComponent, renderTree, findElementByType, treeText } from "./helpers/render-component.mjs";
import * as questionPreview from "../lib/question-preview.mjs";
import * as questionPresentation from "../lib/question-presentation.mjs";

const { previewShape } = questionPreview;

/* ------------------------------------------------------------- shapes --- */

const WIREFRAME = [
  "┌──────────────┬──────────────┐",
  "│ left panel   │ right panel  │",
  "└──────────────┴──────────────┘",
].join("\n");
assert.deepEqual(
  previewShape(WIREFRAME),
  { kind: "text", text: WIREFRAME },
  "an ASCII wireframe is text, kept exactly as written",
);
assert.deepEqual(
  previewShape("header\n    child line\n  footer"),
  { kind: "text", text: "header\n    child line\n  footer" },
  "indentation inside the wireframe survives: a wireframe whose columns move is a different layout",
);

const MERMAID = "Choose A while the flow stays linear.\n\n```mermaid\nflowchart LR\n  A-->B\n```\n";
assert.deepEqual(
  previewShape(MERMAID),
  { kind: "mermaid", source: "flowchart LR\n  A-->B", prose: "Choose A while the flow stays linear." },
  "a fenced mermaid block becomes a diagram, and the sentence around it is kept beside the picture",
);
assert.deepEqual(
  previewShape("```mermaid\nflowchart TD\n  X-->Y\n```"),
  { kind: "mermaid", source: "flowchart TD\n  X-->Y", prose: "" },
  "a preview that is only the fence has no prose to show",
);
assert.deepEqual(
  previewShape("```js\nconsole.log(1)\n```"),
  { kind: "text", text: "```js\nconsole.log(1)\n```" },
  "a non-mermaid fence is still text, and its source is kept: only the mermaid language is a diagram",
);
assert.deepEqual(
  previewShape("```mermaid\n   \n```"),
  { kind: "text", text: "```mermaid\n   \n```" },
  "an empty mermaid fence is not a diagram — and it is not silently dropped either",
);
for (const empty of [null, undefined, 42, {}, [], "", "   ", "\n\t "]) {
  assert.equal(previewShape(empty), null, `${JSON.stringify(empty)} has no preview to render`);
}

/* -------------------------------------- the retired 280-char threshold --- */

const LONG_WIREFRAME = [
  "┌────────────────────────────────────────────────────────────┐",
  ...Array.from({ length: 12 }, (_, index) => `│ row ${String(index).padStart(2, "0")} — a longer wireframe cell │`),
  "└────────────────────────────────────────────────────────────┘",
].join("\n");
assert.ok(LONG_WIREFRAME.length > 280, "the fixture really exceeds the retired auto-reveal threshold");
assert.deepEqual(
  previewShape(LONG_WIREFRAME),
  { kind: "text", text: LONG_WIREFRAME },
  "a preview over 280 characters is returned whole: the rule has no length threshold to cut on",
);

/* ------------------------------------------------------------ wiring --- */

const mermaidSources = [];
const marker = (name) => (props) => ({ type: name, props: props ?? {}, children: props?.children ?? [] });
const reactState = (initial) => [initial, () => {}];
const componentStubs = (useState) => ({
  react: { useId: () => "preview-panel", useState },
  "@/components/ui/button": { Button: marker("button") },
  "../disclosure": {
    DisclosureChevron: (props) => ({ type: "chevron", props: props ?? {}, children: [] }),
  },
  "./embedded-brief": { EmbeddedBrief: () => null, embeddedBriefFor: () => null },
  "../detail/mermaid-diagram": {
    MermaidDiagram: (props) => {
      mermaidSources.push(props.source);
      return { type: "mermaid-diagram", props, children: [] };
    },
  },
  "../../lib/question-presentation.mjs": questionPresentation,
  "../../lib/question-preview.mjs": questionPreview,
});
const BatchOptionList = loadComponent(
  "components/conversation/batch-options.tsx",
  "BatchOptionList",
  componentStubs(reactState),
);
const BatchOptionListOpen = loadComponent(
  "components/conversation/batch-options.tsx",
  "BatchOptionList",
  componentStubs(() => [true, () => {}]),
);

function renderListFrom(component, preview) {
  return renderTree(component({
    current: {
      id: "q1",
      title: "Pick one",
      prompt: "Pick one",
      multiple: false,
      options: [{ label: "Option one", description: "Decide after reading the preview.", preview }],
    },
    isSplitProposal: false,
    splitKeepLabel: "",
    selected: {},
    onPick: () => {},
  }));
}
const renderList = (preview) => renderListFrom(BatchOptionList, preview);

const textTree = renderList(WIREFRAME);
const pre = findElementByType(textTree, "pre");
assert.ok(pre, "a wireframe preview renders in a <pre>, where its columns stay aligned");
assert.equal(treeText(pre), WIREFRAME, "the <pre> carries the wireframe character for character");
assert.equal(findElementByType(textTree, "mermaid-diagram"), null, "the text branch never renders a diagram");
assert.equal(mermaidSources.length, 0, "and never touches the mermaid component — the negative control for the branch below");
assert.equal(treeText(findElementByType(textTree, "figcaption")), "What this looks like", "the preview names itself in place of a collapsed summary");
assert.doesNotMatch(treeText(textTree), /Show preview/,
  "a five-line wireframe is already a glance: no control that reveals nothing");
const pick = findElementByType(textTree, "button");
assert.ok(pick, "the row still renders its pick control");
assert.doesNotMatch(treeText(pick), /left panel/,
  "the preview is a sibling of the pick control, never inside it: a click on a wireframe must not answer the question");

mermaidSources.length = 0;
const diagramTree = renderList(MERMAID);
assert.equal(findElementByType(diagramTree, "mermaid-diagram"), null,
  "a diagram starts collapsed: partial diagrams are not a useful glance");
assert.match(treeText(diagramTree), /Show diagram/, "and names the one control that draws it");
assert.doesNotMatch(treeText(diagramTree), /```/, "the fence itself is never visible as preview text");
assert.equal(mermaidSources.length, 0, "nothing is drawn until the reader asks");

const openDiagramTree = renderListFrom(BatchOptionListOpen, MERMAID);
const diagram = findElementByType(openDiagramTree, "mermaid-diagram");
assert.ok(diagram, "opening the preview renders through the MermaidDiagram component");
assert.equal(diagram.props.source, "flowchart LR\n  A-->B", "the component receives the fence's body, without the fence");
assert.deepEqual(mermaidSources, ["flowchart LR\n  A-->B"], "the diagram component is the one that draws it, exactly once");
assert.match(treeText(openDiagramTree), /Choose A while the flow stays linear\./, "the sentence around the fence stays beside the diagram");
assert.match(treeText(openDiagramTree), /Hide diagram/, "and the same control closes it");

const longTree = renderList(LONG_WIREFRAME);
const longPre = findElementByType(longTree, "pre");
assert.ok(longPre, "a long wireframe keeps a text peek");
assert.match(longPre.props.className, /max-h-\[8\.5rem\].*overflow-hidden/,
  "the peek is clipped, not the whole document opened in the row");
assert.match(treeText(longTree), /Show preview/, "a labelled button, not an underlined summary, reveals the rest");
assert.equal(findElementByType(longTree, "details"), null, "the retired disclosure is gone");
const openLongTree = renderListFrom(BatchOptionListOpen, LONG_WIREFRAME);
assert.doesNotMatch(findElementByType(openLongTree, "pre").props.className, /max-h-\[8\.5rem\]/,
  "opening removes the clip");
assert.match(treeText(openLongTree), /Hide preview/, "and the control says what it will do");

console.log("question preview ok: short wireframes stay open, long ones peek behind a labelled toggle, and diagrams draw only on request");
