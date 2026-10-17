import assert from "node:assert/strict";
import * as artifactRender from "../lib/artifact-render.mjs";
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
