import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The shared brief and the option rows, RENDERED — not grepped.
//
// Requirement: when every option of a question carries the same document and a
// viewer exists, the list shows ONE door to that document above the rows, named
// for what the click does ("Read the brief"), and the rows stop repeating it.
// When the documents differ, each row keeps its own `Open:` button; when no
// viewer exists (a thread), the row degrades to the bare filename — never a dead
// button pretending to open.
//
// The regression this file exists for is specific: the brief used to be a
// `<details>` disclosure that rendered the document inside the conversation,
// behind an underlined "Show brief" summary. It was a second, worse viewer (no
// diagrams, no links, no quoting) between the question and its own options. The
// assertions below refuse that shape structurally — no `<details>`, no
// `<summary>`, no "Show brief" — and assert the one button's accessible name,
// visible label, filename, and affordance.
//
// Harness note: `@get-bb/plugin-sdk/app` snapshots `useRpc`/`Markdown` from
// `globalThis.__bbPluginRuntime` at import time, so the stub must be installed
// BEFORE the component chain loads — hence the dynamic import below instead of a
// static one (a static import would evaluate the SDK first, unstubbed).
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({ content: "# brief", truncated: false }) }),
    Markdown: ({ content }) => h("div", null, content),
    experimental_SourceCode: ({ content }) => h("pre", null, content),
    experimental_FileLink: () => null,
    UrlLink: () => null,
  },
};

const { BatchOptionList } = await import("../components/conversation/batch-options.tsx");

const briefDoc = (overrides = {}) => ({
  path: "docs/brief.md",
  display: "brief.md",
  absolutePath: "/work/docs/brief.md",
  hostId: null,
  ...overrides,
});
const option = (artifact, label) => ({ label, description: "Decide after reading.", preview: null, artifact });
const question = (artifacts, labels = artifacts.map((_, index) => `Option ${index + 1}`)) => ({
  id: "q1",
  title: "Approve the brief?",
  prompt: "Read, then pick.",
  multiple: false,
  options: artifacts.map((artifact, index) => option(artifact, labels[index])),
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

function refuseDisclosure(label) {
  assert.equal(document.querySelectorAll("details").length, 0, `${label}: the brief is not a disclosure`);
  assert.equal(document.querySelectorAll("summary").length, 0, `${label}: and has no summary to open`);
  assert.equal(screen.queryByText(/Show brief/), null, `${label}: the old summary copy is gone, not restyled`);
}

/* --------------------------------------- (a) one shared document, viewer --- */

const shared = briefDoc();
const calls = [];
show(
  question([shared, shared, shared], ["Approve the brief", "Request changes", "Ask a question"]),
  (...args) => calls.push(args),
);

const briefButton = screen.getByRole("button", { name: "Open the brief brief.md in the viewer" });
assert.equal(screen.getAllByRole("button").length, 1, "the shared document renders one door, not one per row");
assert.ok(briefButton.textContent.includes("Read the brief"), "the control says what the click does");
assert.ok(briefButton.textContent.includes("brief.md"), "the filename is on the control, not only in a hover title");
assert.ok(briefButton.textContent.includes("Open ↗"), "and the affordance that it opens something is visible");
assert.equal(screen.queryAllByText(/^Open:/).length, 0, "no per-row Open button repeats the shared file");
assert.equal(screen.getByRole("radiogroup", { name: "Approve the brief?" }).firstElementChild, briefButton,
  "the brief sits above the rows it belongs to, not after the decision it is evidence for");
refuseDisclosure("shared");

fireEvent.click(briefButton);
assert.equal(calls.length, 1, "clicking the brief calls the opener once");
assert.equal(calls[0][0], shared, "with the shared document itself");
assert.equal(calls[0][1], "review", "an approval option opens the document read-only");
assert.equal(calls[0][2], "Approve the brief", "and carries the option whose control opened the viewer");
cleanup();

/* -------------------------------- (a) the mode follows the FIRST option --- */

const commentCalls = [];
show(question([shared, shared], ["Request changes", "Ask a question"]), (...args) => commentCalls.push(args));
fireEvent.click(screen.getByRole("button", { name: "Open the brief brief.md in the viewer" }));
assert.equal(commentCalls.length, 1);
assert.equal(commentCalls[0][1], "comment", "a first option that is not an approval keeps the quote-and-comment path");
assert.equal(commentCalls[0][2], "Request changes", "and the label is the first option's, not a constant");
cleanup();

/* ---------------------------------- (b) shared documents, no viewer -------- */

show(question([shared, shared, shared]), undefined);
assert.equal(screen.queryByRole("button", { name: /Open the brief/ }), null, "no viewer means no brief");
assert.equal(screen.queryAllByText(/^Open:/).length, 0, "and no dead Open button pretending to open");
assert.equal(screen.getAllByText("brief.md").length, 3, "each row still names its file as plain text");
refuseDisclosure("thread degrade");
cleanup();

/* ------------------------------- (c) genuinely different documents -------- */

const other = briefDoc({ path: "docs/plan.md", display: "plan.md", absolutePath: "/work/docs/plan.md" });
const third = briefDoc({ path: "docs/risks.md", display: "risks.md", absolutePath: "/work/docs/risks.md" });
show(question([shared, other, third]), () => {});
assert.equal(screen.queryByRole("button", { name: /Open the brief/ }), null, "mixed documents embed no shared brief");
assert.equal(screen.queryByText("Read the brief"), null, "and no shared control survives beside them");
assert.equal(screen.getAllByText(/^Open:/).length, 3, "each row keeps its own Open button for its own document");
refuseDisclosure("mixed");
cleanup();

show(question([shared, other, third]), undefined);
assert.equal(screen.queryAllByText(/^Open:/).length, 0, "without a viewer the mixed rows degrade too");
assert.equal(screen.getAllByText("plan.md").length, 1, "each row names the file it would open");
assert.equal(screen.getAllByText("risks.md").length, 1, "including the third, not just the first");
cleanup();

console.log("embedded brief ui ok: one named door for a shared document, per-row buttons only for genuinely different ones");
