import assert from "node:assert/strict";
import * as zoomLib from "../lib/diagram-zoom.mjs";
import { findElementByType, loadComponent, renderTree, treeText, walk } from "./helpers/render-component.mjs";

/**
 * The zoom controls of the derived-diagram view, asked of the RENDERED tree.
 *
 * The viewer-level pins (`tests/artifact-viewer-diagram.test.mjs`) stub
 * `./mermaid-diagram` as a marker, so the zoom controls — which live inside
 * the real `MermaidDiagram` — are unreachable there: a viewer test can only
 * see that the branch was taken, never what the branch draws. This file
 * renders `MermaidDiagram` directly with the same stub discipline (a missing
 * stub throws instead of resolving to nothing).
 *
 * Two states. Pre-render (`useState` as-is, `useEffect` noop) shows the
 * loading text without crashing. Loaded is driven by answering the svg slot
 * — the `useState(null)` call the renderer resolves — with a sentinel, the
 * way the async pele render would: no real render runs, and the stub keys on
 * the initial value (not call order), so a hook reorder cannot silently
 * re-target it. The zoom wiring itself is the REAL `lib/diagram-zoom.mjs`,
 * so the percent readout and the zoomed predicate are exercised, not mimicked.
 */

const SVG_SENTINEL = "<svg>zoom-sentinel</svg>";
const PELE_PLAYGROUND_SENTINEL = "https://pele-run-sentinel.example/playground";
assert.match(PELE_PLAYGROUND_SENTINEL, /^https:\/\//, "the sentinel stays a plausible link");

function stubs(useState) {
  return {
    react: {
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
      useState,
    },
    "@get-bb/plugin-sdk/app": {
      UrlLink: (props, ...children) => ({ type: "url-link", props, children }),
    },
    "@/components/ui/button": {
      Button: (props, ...children) => ({ type: "button", props, children }),
    },
    "../../lib/diagram-strategy.mjs": { PELE_PLAYGROUND: PELE_PLAYGROUND_SENTINEL },
    "../../lib/diagram-zoom.mjs": zoomLib,
  };
}

function collect(tree, predicate) {
  const found = [];
  walk(tree, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

const props = { source: "flowchart TD\n  A-->B", title: "scope.mmd" };

// Pre-render: the reader gets the loading text, never a blank box or a crash.
const Loading = loadComponent("components/detail/mermaid-diagram.tsx", "MermaidDiagram", stubs((initial) => [initial, () => {}]));
const loading = renderTree(Loading(props));
assert.match(treeText(loading), /Rendering diagram/, "pre-render shows the loading text");
assert.ok(findElementByType(loading, "p"), "pre-render is a paragraph, not a crash-shaped hole");

// Loaded: the svg sits beside a zoom group with all three controls.
const Loaded = loadComponent(
  "components/detail/mermaid-diagram.tsx",
  "MermaidDiagram",
  stubs((initial) => [initial === null ? SVG_SENTINEL : initial, () => {}]),
);
const loaded = renderTree(Loaded(props));

const groups = collect(loaded, (node) => node.props?.role === "group");
assert.equal(groups.length, 1, "exactly one zoom group renders");
assert.equal(groups[0].props["aria-label"], "Diagram zoom", "the group names itself for assistive tech");

const titles = collect(loaded, (node) => node.type === "button").map((node) => node.props.title).sort();
assert.deepEqual(titles, ["Reset zoom", "Zoom in", "Zoom out"], "all three zoom controls render");

const readout = collect(loaded, (node) => node.props?.["aria-live"] === "off");
assert.equal(readout.length, 1, "exactly one percent readout renders");
assert.equal(readout[0].children.join(""), "100%", "the readout opens at 100% for the resting view");

let html = null;
walk(loaded, (node) => {
  if (!html && node.props?.dangerouslySetInnerHTML) html = node.props.dangerouslySetInnerHTML.__html;
});
assert.ok(String(html).includes(SVG_SENTINEL), "the rendered svg is the source the renderer produced");

console.log("mermaid diagram zoom ok: loading text pre-render, zoom group with three controls and 100% readout when loaded");
