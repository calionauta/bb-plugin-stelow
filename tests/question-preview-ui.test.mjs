/**
 * The preview's progressive disclosure, RENDERED.
 *
 * `tests/question-preview.test.mjs` owns the shape decision and the wiring.
 * This file owns the interaction: nothing about a preview is visible until the
 * reader opens it. The label "What this looks like" is inside the panel, not a
 * teaser above it, and no clipped fragment is shown while closed.
 *
 * Reported from card_g89gtmwt: every option carried a preview block open; the
 * first fix added a peek, which still spent the row's height on evidence the
 * reader had not asked for. The rule now is the simplest one: closed means the
 * control, and only the control.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { BatchOptionList } = await import("../components/conversation/batch-options.tsx");

const LONG_PREVIEW = Array.from(
  { length: 12 },
  (_, index) => `│ row ${index} of the wireframe │`,
).join("\n");

function renderPreview(preview) {
  render(h(BatchOptionList, {
    current: {
      id: "q1",
      title: "Pick one",
      prompt: "Pick one",
      multiple: false,
      options: [{ label: "Wireframe option", description: "Trade-off.", preview, artifact: null }],
    },
    isSplitProposal: false,
    splitKeepLabel: "",
    selected: {},
    onPick: () => {},
  }));
}

test.afterEach(() => cleanup());

test("a preview is closed: no label, no content, only the control", () => {
  renderPreview(LONG_PREVIEW);
  assert.equal(screen.queryByText("What this looks like"), null,
    "the label is inside the panel, never a teaser above it");
  assert.equal(screen.queryByText(/row 0 of the wireframe/), null,
    "no fragment of the evidence is visible while the panel is closed");
  const toggle = screen.getByRole("button", { name: "Show preview" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "the control says the panel is closed");
  fireEvent.click(toggle);
  const close = screen.getByRole("button", { name: "Hide preview" });
  assert.equal(close.getAttribute("aria-expanded"), "true", "and updates its state after the click");
  assert.equal(screen.getByText("What this looks like").tagName, "FIGCAPTION",
    "the label appears only inside the opened panel");
  const pre = document.querySelector("pre");
  assert.equal(pre.textContent, LONG_PREVIEW,
    "the full wireframe, character for character, once opened");
  fireEvent.click(close);
  assert.equal(screen.queryByText("What this looks like"), null, "closing hides the label again");
  assert.equal(document.querySelector("pre"), null, "and unmounts the content, not merely clips it");
});

test("a short preview is collapsed too: the same rule, no exception", () => {
  renderPreview("one line\nsecond line");
  assert.equal(screen.queryByText(/one line/), null, "a short preview is not a reason to show it unasked");
  const toggle = screen.getByRole("button", { name: "Show preview" });
  fireEvent.click(toggle);
  assert.ok(screen.getByText(/one line/), "opening reveals it");
});

test("a diagram starts behind a labelled control, not a raw fence", () => {
  renderPreview("Choose A while the flow stays linear.\n\n```mermaid\nflowchart LR\n  A-->B\n```");
  assert.equal(screen.queryByText(/```/), null, "the fence is never the visible preview");
  assert.equal(screen.queryByText("What this looks like"), null, "and no label is shown while closed");
  const toggle = screen.getByRole("button", { name: "Show diagram" });
  fireEvent.click(toggle);
  assert.ok(screen.getByText("What this looks like"), "the label appears inside the panel");
  assert.ok(screen.getByRole("button", { name: "Hide diagram" }), "the same control closes it");
});

console.log("question preview ui ok: every preview is closed until its control opens it");
