/**
 * The preview's progressive disclosure, RENDERED.
 *
 * `tests/question-preview.test.mjs` owns the shape decision and the wiring
 * (short wireframe vs peek vs diagram). This file owns the interaction a
 * reader performs: a long wireframe shows a clipped peek, one labelled button
 * expands it, and the label flips to the closing action.
 *
 * Reported from card_g89gtmwt: four ASCII previews opened whole made the
 * question taller than the screen and pushed the options apart. The old fix
 * was a `<details>` with an underlined summary; the new rule is a peek plus a
 * button, so the evidence stays visible without the row becoming a document.
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

test("a long preview keeps a peek and expands from one labelled control", () => {
  renderPreview(LONG_PREVIEW);
  const figure = screen.getByText("What this looks like").closest("figure");
  assert.ok(figure, "the preview names itself");
  const peek = figure.querySelector("pre");
  assert.ok(peek, "the wireframe is still a text block");
  assert.match(peek.className, /max-h-\[8\.5rem\].*overflow-hidden/,
    "the peek is clipped, so four options do not push the question off the screen");
  const toggle = screen.getByRole("button", { name: "Show preview" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "the control says the preview is closed");
  fireEvent.click(toggle);
  const close = screen.getByRole("button", { name: "Hide preview" });
  assert.equal(close.getAttribute("aria-expanded"), "true", "and updates its state after the click");
  assert.doesNotMatch(figure.querySelector("pre").className, /max-h-\[8\.5rem\]/,
    "expanding removes the clip instead of leaving the document permanently cropped");
  assert.equal(figure.querySelector("pre").textContent, LONG_PREVIEW,
    "the full wireframe, character for character, once opened");
});

test("a short preview is already a glance, so it has no toggle", () => {
  renderPreview("one line\nsecond line");
  assert.ok(screen.getByText(/one line/), "the short preview renders");
  assert.equal(screen.queryByRole("button", { name: "Show preview" }), null,
    "a control that reveals nothing is a control that does nothing");
});

test("a diagram starts behind a labelled control, not a raw fence", () => {
  renderPreview("Choose A while the flow stays linear.\n\n```mermaid\nflowchart LR\n  A-->B\n```");
  assert.equal(screen.queryByText(/```/), null, "the fence is never the visible preview");
  assert.ok(screen.getByRole("button", { name: "Show diagram" }), "the diagram is one explicit click away");
  assert.equal(screen.queryByRole("img"), null, "nothing is drawn before the reader asks");
});

console.log("question preview ui ok: short previews render, long ones peek, and diagrams wait for the control");
