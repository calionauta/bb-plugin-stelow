/**
 * The REAL card section, mounted.
 *
 * The parent file guards the shared disclosure and the section's props; this
 * one guards the call site a reader actually reaches. `DetailQuestionSections`
 * renders `QuestionBatch`, whose first hook is the host's `useRpc`, so the SDK
 * stub must be installed before the component chain loads — hence the dynamic
 * imports below. Without this mount, an `open={false}` or a dropped count at
 * the card's own call site would pass every source pin.
 */
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({ ok: true }) }),
    Markdown: ({ content }) => h("div", null, content),
    experimental_SourceCode: ({ content }) => h("pre", null, content),
    experimental_FileLink: () => null,
  },
};

const { DetailQuestionSections } = await import("../components/detail/detail-question-sections.tsx");

afterEach(() => cleanup());

const expired = (id) => ({
  id,
  question: `Question ${id}?`,
  multiple: false,
  kind: "standard",
  options: ["Yes", "No"].map((label) => ({
    label,
    description: "",
    preview: null,
    artifact: null,
  })),
  staleness: null,
});

const detail = (expiredQuestions) => ({
  pendingQuestions: [],
  expiredQuestions,
  fileEnvironmentId: null,
});

test("R1: the real card section mounts open, amber and counted", () => {
  render(h(DetailQuestionSections, {
    card: { id: "card_1", workspaceKind: "project" },
    detail: detail([expired("q1"), expired("q2")]),
    setViewerFile: () => {},
    onAnswered: () => {},
    openLiveArtifact: false,
  }));
  const section = document.querySelector("details");
  assert.ok(section, "the card renders a decision section for its open questions");
  assert.equal(section.open, true, "the section the reader lands on is already open");
  assert.match(section.className, /border-amber-500\/50/,
    "the section itself is the amber surface — not the status hero above it");
  assert.match(section.className, /bg-amber-500\/5/,
    "and it carries the warm background, not only an amber outline");
  assert.doesNotMatch(section.className, /bg-muted\/20/,
    "the muted base background is not composed in: Tailwind emits it after the amber rule, so both classes "
    + "resolve to grey and the gold survives only as a border");
  assert.match(section.textContent, /Waiting for you/,
    "the section is named for the wait the card is in");
  assert.match(section.textContent, /Needs your decision — 2 questions/,
    "and the count is inside the section, as its subtitle");
  // The radiogroup used to ship an EMPTY accessible name, because a recovered
  // batch has no title of its own and the group read `aria-label={title}`.
  assert.equal(screen.getByRole("radiogroup").getAttribute("aria-label"), "Question q1?",
    "the option group is named by the question, so a screen reader announces what is being answered");
});

test("R1: a live question replaces the timeout copy with a resume promise", () => {
  render(h(DetailQuestionSections, {
    card: { id: "card_1", workspaceKind: "project" },
    detail: {
      pendingQuestions: [expired("live")],
      expiredQuestions: [],
      fileEnvironmentId: null,
    },
    setViewerFile: () => {},
    onAnswered: () => {},
    openLiveArtifact: false,
  }));
  const section = document.querySelector("details");
  assert.equal(section.open, true);
  assert.match(section.textContent, /paused until you answer/i,
    "a live ask is a worker waiting on this answer");
  assert.doesNotMatch(section.textContent, /timed out before they were answered/i,
    "and the recovered-batch paragraph does not render over it");
});
