import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, cleanup } from "@testing-library/react";

// BatchOptionList's embedded-brief rule, rendered — not grepped.
//
// Content-loading (rpc) is deliberately unasserted here: the rpc stub below
// answers with canned content, and every assertion targets structural markers
// (the "Brief for this question:" header, the per-row "Open:" buttons) that
// render on the first pass regardless of when the async load resolves. What
// this guards is the decision — one reader vs per-row buttons — not the file
// bytes inside the reader.
//
// Harness note: `@get-bb/plugin-sdk/app` snapshots `useRpc`/`Markdown` from
// `globalThis.__bbPluginRuntime` at import time, so the stub must be installed
// BEFORE the component chain loads — hence the dynamic import below instead
// of a static one (a static import would evaluate the SDK first, unstubbed).
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({ content: "# brief", truncated: false }) }),
    Markdown: ({ content }) => h("div", null, content),
    experimental_SourceCode: ({ content }) => h("pre", null, content),
    experimental_FileLink: () => null,
  },
};

const { BatchOptionList } = await import("../components/conversation/batch-options.tsx");

const briefDoc = (overrides = {}) => ({ path: "docs/brief.md", display: "brief.md", absolutePath: "/work/docs/brief.md", hostId: null, ...overrides });
const option = (artifact, label) => ({ label, description: "Decide after reading.", preview: null, artifact });
const question = (artifacts) => ({
  id: "q1",
  title: "Approve the brief?",
  prompt: "Read, then pick.",
  multiple: false,
  options: artifacts.map((artifact, index) => option(artifact, `Option ${index + 1}`)),
});
function show(current, onOpenArtifact) {
  return render(h(BatchOptionList, {
    cardId: "card-1",
    current,
    isSplitProposal: false,
    splitKeepLabel: "",
    selected: {},
    onPick: () => {},
    onOpenArtifact,
  }));
}

// (a) Three options sharing one artifact + a viewer: one embedded brief above
// the rows, and NO per-row Open buttons repeating the same file.
show(question([briefDoc(), briefDoc(), briefDoc()]), () => {});
assert.ok(screen.getByText("Brief for this question: brief.md"), "the shared brief embeds one reader above the rows");
assert.ok(screen.getByText("Open full viewer ↗"), "the full viewer stays one click away");
assert.ok(screen.getByText("Option 1"), "the rows still render under the brief");
assert.equal(screen.queryAllByText(/Open:/).length, 0, "no per-row Open button repeats the shared file");
cleanup();

// (b) Same shared artifact but no viewer (thread degrade path): no brief, the
// rows render with bare filenames, never a dead button pretending to open.
show(question([briefDoc(), briefDoc(), briefDoc()]), undefined);
assert.equal(screen.queryByText(/Brief for this question/), null, "no viewer means no embedded brief");
assert.ok(screen.getByText("Option 1"), "the rows still render without a viewer");
assert.equal(screen.queryAllByText(/Open:/).length, 0, "no dead Open buttons without a viewer");
assert.ok(screen.getAllByText("brief.md").length >= 3, "each row still names its file as plain text");
cleanup();

// (c) Genuinely different artifacts + a viewer: no brief, every row keeps its
// own Open button for its own document.
const varied = question([
  briefDoc(),
  briefDoc({ path: "docs/plan.md", display: "plan.md", absolutePath: "/work/docs/plan.md" }),
  briefDoc({ path: "docs/risks.md", display: "risks.md", absolutePath: "/work/docs/risks.md" }),
]);
show(varied, () => {});
assert.equal(screen.queryByText(/Brief for this question/), null, "mixed documents embed no shared reader");
assert.equal(screen.queryAllByText(/Open:/).length, 3, "each row keeps its own Open button for its own document");
cleanup();

console.log("embedded-brief-ui: ok");
