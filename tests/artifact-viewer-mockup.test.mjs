import assert from "node:assert/strict";
import * as artifactRender from "../lib/artifact-render.mjs";
import * as artifactDiagram from "../lib/artifact-diagram.mjs";
import { PELE_PLAYGROUND } from "../lib/diagram-strategy.mjs";
import { findElementByType, loadComponent, renderTree, treeText } from "./helpers/render-component.mjs";

/**
 * How the viewer shows a document, asked of the RENDERED tree rather than of
 * the source text that produced it.
 *
 * The decision (which kind a path is) is covered behaviourally in
 * tests/artifact-render.test.mjs. What that cannot cover is the WIRING: the
 * viewer has to ask that module for the decision and render a mockup as a page.
 * A viewer that keeps its own inline extension test typechecks fine, and a
 * source grep cannot tell the two apart — so `artifactRenderKind` is a spy
 * here. If the viewer decides the extension itself the spy is never called and
 * this file fails; a spy that is not consulted cannot be satisfied by prose.
 *
 * The sandbox is the security-relevant half. It is stubbed with a sentinel, so
 * a hand-typed sandbox string in the viewer cannot pass as the shared constant.
 */

const SANDBOX_SENTINEL = "sandbox-sentinel-from-shared-module";
assert.notEqual(
  SANDBOX_SENTINEL,
  artifactRender.MOCKUP_SANDBOX,
  "the sentinel must differ from the real sandbox, or the sandbox claim would be vacuous",
);

const kindCalls = [];
const marker = (name) => (props, ...children) => ({ type: name, props, children });

const ArtifactContent = loadComponent(
  "components/detail/artifact-viewer-dialog.tsx",
  "ArtifactContent",
  {
    react: {
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    },
    "@get-bb/plugin-sdk/app": {
      Markdown: marker("markdown"),
      UrlLink: marker("url-link"),
      experimental_SourceCode: marker("source-code"),
      experimental_FileLink: marker("file-link"),
      useRpc: () => ({ call: async () => ({}) }),
    },
    sonner: { toast: { message: () => {}, error: () => {}, success: () => {} } },
    "./option-section": { OptionSection: () => null },
    "../../lib/artifact-render.mjs": {
      MOCKUP_SANDBOX: SANDBOX_SENTINEL,
      artifactRenderKind: (path) => {
        kindCalls.push(path);
        return artifactRender.artifactRenderKind(path);
      },
    },
    "../../lib/diagram-strategy.mjs": { PELE_PLAYGROUND },
    "../../lib/artifact-diagram.mjs": {
      derivedDiagram: (...args) => artifactDiagram.derivedDiagram(...args),
    },
    "./mermaid-diagram": { MermaidDiagram: marker("mermaid-diagram") },
    "@/components/ui/button": { Button: marker("button") },
    "@/components/ui/dialog": {
      Dialog: marker("dialog"),
      DialogContent: marker("dialog-content"),
      DialogDescription: marker("dialog-description"),
      DialogFooter: marker("dialog-footer"),
      DialogHeader: marker("dialog-header"),
      DialogTitle: marker("dialog-title"),
    },
  },
);

function render(props) {
  return renderTree(ArtifactContent({
    file: null,
    content: null,
    truncated: false,
    loadError: null,
    loading: false,
    scrollRef: undefined,
    ...props,
  }));
}

// A complete html file is rendered as the page it is, with the shared sandbox.
kindCalls.length = 0;
const mockup = render({
  file: { display: "mockup.html", path: "mockup.html" },
  content: "<html><body>hi</body></html>",
});
const frame = findElementByType(mockup, "iframe");
assert.ok(frame, "a complete html document is framed as a page");
assert.equal(frame.props.srcDoc, "<html><body>hi</body></html>", "the framed page is the file's own content");
assert.equal(frame.props.sandbox, SANDBOX_SENTINEL, "the frame uses the shared sandbox constant");
assert.doesNotMatch(
  String(frame.props.sandbox),
  /allow-same-origin/,
  "the viewer never grants the framed page bb's origin",
);
assert.match(String(frame.props.title), /mockup\.html/, "the frame names the document it shows");
assert.deepEqual(
  kindCalls,
  ["mockup.html"],
  "the render kind comes from the shared module, called on the document's own path",
);

// Markdown stays prose; a truncated page degrades to source, because a partial
// page presented as the mockup is a broken layout shown as evidence.
kindCalls.length = 0;
const prose = render({ file: { display: "notes.md", path: "notes.md" }, content: "# Notes" });
assert.ok(findElementByType(prose, "markdown"), "a markdown document renders as prose");
assert.deepEqual(kindCalls, ["notes.md"], "and its kind, too, comes from the shared module");

const truncated = render({
  file: { display: "mockup.html", path: "mockup.html" },
  content: "<html>",
  truncated: true,
});
assert.equal(findElementByType(truncated, "iframe"), null, "a truncated page is never framed");
assert.ok(findElementByType(truncated, "source-code"), "it degrades to the source instead");
assert.match(
  treeText(truncated),
  /a partial page is not the mockup/,
  "and says why it was not framed",
);

// Anything the module does not call a document or a page is read as code.
const code = render({ file: { display: "main.ts", path: "main.ts" }, content: "const x = 1;" });
assert.ok(findElementByType(code, "source-code"), "an unclassified file renders as source");

console.log("artifact viewer wiring ok: a mockup is looked at, a document is read, and the sandbox is the shared one");

// --- A derived diagram (`.mmd`) renders the diagram branch, not plain source.
// Asked of the RENDERED tree, like the mockup pin above: the viewer has to ask
// `artifactRenderKind` for the decision (the spy), and the `.mmd` branch has
// to be the `MermaidDiagram` element with the source beside it — a viewer that
// renders the file as source alone keeps the spy green and fails here, because
// no `mermaid-diagram` element ever appears. The playground link reads the
// shared constant through the same sentinel shape as the sandbox: a hand-typed
// URL in the viewer cannot pass as the module's value.
//
// This block carries its own loadComponent with the full stub set (notably
// `./mermaid-diagram` and the diagram-strategy constant), so it does not
// depend on the stub set above.
const PELE_PLAYGROUND_SENTINEL = "https://pele-run-sentinel.example/playground";
assert.match(PELE_PLAYGROUND_SENTINEL, /^https:\/\//, "the sentinel stays a plausible link");

const mmdKindCalls = [];
const MmdArtifactContent = loadComponent(
  "components/detail/artifact-viewer-dialog.tsx",
  "ArtifactContent",
  {
    react: {
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState: (initial) => [initial, () => {}],
    },
    "@get-bb/plugin-sdk/app": {
      Markdown: marker("markdown"),
      UrlLink: marker("url-link"),
      experimental_SourceCode: marker("source-code"),
      experimental_FileLink: marker("file-link"),
      useRpc: () => ({ call: async () => ({}) }),
    },
    sonner: { toast: { message: () => {}, error: () => {}, success: () => {} } },
    "./option-section": { OptionSection: () => null },
    "../../lib/artifact-render.mjs": {
      MOCKUP_SANDBOX: SANDBOX_SENTINEL,
      artifactRenderKind: (path) => {
        mmdKindCalls.push(path);
        return artifactRender.artifactRenderKind(path);
      },
    },
    "../../lib/diagram-strategy.mjs": { PELE_PLAYGROUND: PELE_PLAYGROUND_SENTINEL },
    "../../lib/artifact-diagram.mjs": {
      derivedDiagram: (...args) => artifactDiagram.derivedDiagram(...args),
    },
    "./mermaid-diagram": { MermaidDiagram: marker("mermaid-diagram") },
    "@/components/ui/button": { Button: marker("button") },
    "@/components/ui/dialog": {
      Dialog: marker("dialog"),
      DialogContent: marker("dialog-content"),
      DialogDescription: marker("dialog-description"),
      DialogFooter: marker("dialog-footer"),
      DialogHeader: marker("dialog-header"),
      DialogTitle: marker("dialog-title"),
    },
  },
);

function renderMmd(props) {
  return renderTree(MmdArtifactContent({
    file: null,
    content: null,
    truncated: false,
    loadError: null,
    loading: false,
    scrollRef: undefined,
    ...props,
  }));
}

mmdKindCalls.length = 0;
const mmd = renderMmd({
  file: { display: "scope.mmd", path: "scope.mmd" },
  content: "flowchart TD\n  A-->B",
});
const mmdDiagram = findElementByType(mmd, "mermaid-diagram");
assert.ok(mmdDiagram, "a .mmd file renders the MermaidDiagram branch, not plain source alone");
assert.equal(mmdDiagram.props.source, "flowchart TD\n  A-->B", "the branch receives the file's own source");
assert.match(String(mmdDiagram.props.title), /scope\.mmd/, "the branch names the diagram it shows");
assert.ok(findElementByType(mmd, "source-code"), "the source stays beside the diagram");
const mmdLink = findElementByType(mmd, "url-link");
assert.ok(mmdLink, "the branch links the playground");
assert.equal(
  mmdLink.props.href,
  PELE_PLAYGROUND_SENTINEL,
  "the link reads the shared constant, not a hand-typed URL",
);
assert.deepEqual(
  mmdKindCalls,
  ["scope.mmd"],
  "and the branch is chosen through the shared kind, called on the document's own path",
);

// Plain source stays plain: the diagram branch is exclusive to the kind.
mmdKindCalls.length = 0;
const mmdPlain = renderMmd({ file: { display: "main.ts", path: "main.ts" }, content: "const x = 1;" });
assert.equal(
  findElementByType(mmdPlain, "mermaid-diagram"),
  null,
  "a non-diagram file never takes the diagram branch",
);
assert.ok(findElementByType(mmdPlain, "source-code"), "it still reads as code");
assert.deepEqual(mmdKindCalls, ["main.ts"], "through the same shared kind");

console.log("artifact viewer wiring ok: a .mmd renders the diagram branch beside its source, through the shared kind");
