import assert from "node:assert/strict";
import * as artifactRender from "../lib/artifact-render.mjs";
import * as artifactDiagram from "../lib/artifact-diagram.mjs";
import { findElementByType, loadComponent, renderTree } from "./helpers/render-component.mjs";

/**
 * The derived-diagram branch of the viewer, asked of the RENDERED tree.
 *
 * The decision (which path derives what) is covered behaviourally in
 * tests/artifact-diagram.test.mjs. What that cannot cover is the WIRING: the
 * viewer has to consult `derivedDiagram` at view time and render the
 * `MermaidDiagram` element with the source beside it. A viewer that renders
 * the file as prose-or-source alone keeps every lib pin green and fails here,
 * because no `mermaid-diagram` element ever appears.
 *
 * This file carries its own loadComponent with the full stub set, mirroring
 * tests/artifact-viewer-mockup.test.mjs. The dialog imports
 * `../../lib/artifact-diagram.mjs`, so that specifier is stubbed here like
 * the artifact-render spy: a missing stub throws rather than resolving to
 * nothing, which is the test failing closed instead of green.
 */

const SANDBOX_SENTINEL = "sandbox-sentinel-from-shared-module";
assert.notEqual(
  SANDBOX_SENTINEL,
  artifactRender.MOCKUP_SANDBOX,
  "the sentinel must differ from the real sandbox, or the sandbox claim would be vacuous",
);

const PELE_PLAYGROUND_SENTINEL = "https://pele-run-sentinel.example/playground";
assert.match(PELE_PLAYGROUND_SENTINEL, /^https:\/\//, "the sentinel stays a plausible link");

const kindCalls = [];
const diagramCalls = [];
const marker = (name) => (props, ...children) => ({ type: name, props, children });

const DiagramArtifactContent = loadComponent(
  "components/detail/artifact-content.tsx",
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
    "../../lib/diagram-strategy.mjs": { PELE_PLAYGROUND: PELE_PLAYGROUND_SENTINEL },
    "../../lib/artifact-diagram.mjs": {
      derivedDiagram: (...args) => {
        diagramCalls.push(args);
        return artifactDiagram.derivedDiagram(...args);
      },
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
  return renderTree(DiagramArtifactContent({
    file: null,
    content: null,
    truncated: false,
    loadError: null,
    loading: false,
    scrollRef: undefined,
    ...props,
  }));
}

const SCOPE_MAP = JSON.stringify({
  scopes: [
    { id: "s1", title: "Capture" },
    { id: "s2", title: "Shape", dependsOn: ["s1"] },
  ],
});
const FENCED_TECH = "# Tech\n\n```mermaid\nflowchart TB\n  A-->B\n```\n";
const PLAIN_TECH = "# Tech\nNo fence here, just prose.\n";

// A valid scope map derives the flowchart beside its source.
const scopeMap = render({ file: { display: "scope-map.json", path: "scope-map.json" }, content: SCOPE_MAP });
const scopeDiagram = findElementByType(scopeMap, "mermaid-diagram");
assert.ok(scopeDiagram, "a scope map renders the MermaidDiagram branch");
assert.match(String(scopeDiagram.props.source), /flowchart TB/, "the branch receives the derived flowchart");
assert.ok(String(scopeDiagram.props.source).includes("s1"), "the flowchart names the scopes");
assert.ok(findElementByType(scopeMap, "source-code"), "the map stays beside the diagram as source");

// Diagrammable prose with an authored fence renders the fence beside the prose.
const fenced = render({ file: { display: "spec-tech_v1.md", path: "plans/spec-tech_v1.md" }, content: FENCED_TECH });
const fencedDiagram = findElementByType(fenced, "mermaid-diagram");
assert.ok(fencedDiagram, "a fenced tech spec renders the MermaidDiagram branch");
assert.equal(fencedDiagram.props.source, "flowchart TB\n  A-->B", "the branch receives the authored block");
assert.ok(findElementByType(fenced, "markdown"), "the prose stays beside the diagram");

// The same prose without a fence stays prose: no authored block, no picture.
const plain = render({ file: { display: "spec-tech_v1.md", path: "plans/spec-tech_v1.md" }, content: PLAIN_TECH });
assert.equal(findElementByType(plain, "mermaid-diagram"), null, "a fence-less tech spec never takes the diagram branch");
assert.ok(findElementByType(plain, "markdown"), "it still reads as prose");

// The breadboard owns its views upstream: the viewer never derives a second.
const breadboard = render({
  file: { display: "breadboard.json", path: "interfaces/breadboard.json" },
  content: JSON.stringify({ places: [] }),
});
assert.equal(
  findElementByType(breadboard, "mermaid-diagram"),
  null,
  "a breadboard never takes the diagram branch",
);
assert.ok(findElementByType(breadboard, "source-code"), "it still reads as code");

// A truncated map is not the map: a partial DAG would present a hole as a decision.
const truncated = render({
  file: { display: "scope-map.json", path: "scope-map.json" },
  content: SCOPE_MAP,
  truncated: true,
});
assert.equal(
  findElementByType(truncated, "mermaid-diagram"),
  null,
  "a truncated scope map never takes the diagram branch",
);

assert.ok(diagramCalls.length > 0, "the branch is chosen through the shared derivation, called per file");

console.log("artifact viewer wiring ok: scope maps and fenced prose derive diagrams, breadboards and truncations do not");
