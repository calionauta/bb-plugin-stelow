import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, cleanup } from "@testing-library/react";

// needs-note footer gate, rendered — not grepped.
//
// Harness choice, documented: FooterButtons is NOT exported from
// batch-answer-body.tsx, so the smallest mountable unit that renders it is
// BatchFooter (footer gate + submit). The note textarea itself lives in
// CustomAndSkip, one level up in BatchAnswerBody; driving keystrokes through
// it would need the full stepper state, while both the footer gate and the
// per-question hint read the same submitBlockReason — so this drives the gate
// at the BatchFooter level via the selected/custom props it already takes,
// which is exactly the state the textarea would write.
//
// Harness note (same as embedded-brief-ui): the component chain snapshots
// useRpc/Markdown from globalThis.__bbPluginRuntime at import time, so the
// stub must be installed BEFORE the dynamic import below.
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({ content: "# brief", truncated: false }) }),
    Markdown: ({ content }) => h("div", null, content),
    experimental_SourceCode: ({ content }) => h("pre", null, content),
    experimental_FileLink: () => null,
  },
};

const { BatchFooter } = await import("../components/conversation/batch-answer-body.tsx");
const { questionCopy } = await import("../lib/question-presentation.mjs");
const copy = questionCopy();

const plain = { label: "Approve as written", description: "", preview: null, artifact: null };
const conditional = { label: "Approve, but trim the scope", description: "", preview: null, artifact: null, needsNote: true };
const mixed = [plain, conditional];
const allPlain = [{ ...plain }, { label: "Request changes", description: "", preview: null, artifact: null }];

const question = (options) => ({ id: "q1", title: "Approve the plan?", prompt: "Pick one.", multiple: false, options });

// sel is the AnswerFooterState & AnswerBodyState subset BatchFooter reads:
// index/isLastQuestion/complete/doneCount/remainingCount/setIndex/merged for
// the footer, selected/custom for the blockReason gate.
function show({ options, selected, custom, complete = true }) {
  const sel = {
    index: 0,
    isLastQuestion: true,
    complete,
    doneCount: 1,
    remainingCount: 0,
    setIndex: () => {},
    merged: (id) => selected[id] ?? [],
    selected,
    custom,
    isSplitProposal: false,
    splitKeepLabel: "",
    skipped: new Set(),
    pick: () => {},
    typeCustom: () => {},
    skip: () => {},
    unskip: () => {},
  };
  return render(h(BatchFooter, { sel, questions: [question(options)], copy, busy: false, allowSkip: true, submitLabel: "Submit answer", onSubmit: () => {} }));
}

function submitButton() {
  return screen.getByRole("button", { name: "Submit answer" });
}

// (a) Conditional picked + empty note: submit disabled, hint present.
show({ options: mixed, selected: { q1: ["Approve, but trim the scope"] }, custom: { q1: "" } });
assert.equal(submitButton().disabled, true, "submit waits while the conditional pick has no note");
assert.ok(screen.getByText(/needs a note/), "the block hint names the missing note");
cleanup();

// (b) Conditional picked + note text: submit enabled, hint absent.
show({ options: mixed, selected: { q1: ["Approve, but trim the scope"] }, custom: { q1: "Trim to Q1 only." } });
assert.equal(submitButton().disabled, false, "note text unblocks the submit");
assert.equal(screen.queryByText(/needs a note/), null, "no hint once the note carries the missing piece");
cleanup();

// (c) Plain option picked, no note: submit enabled.
show({ options: mixed, selected: { q1: ["Approve as written"] }, custom: { q1: "" } });
assert.equal(submitButton().disabled, false, "plain picks never wait for a note");
assert.equal(screen.queryByText(/needs a note/), null, "no hint for a plain pick");
cleanup();

// (d) No needsNote anywhere: identical to old behavior, no hint element in DOM.
show({ options: allPlain, selected: { q1: ["Approve as written"] }, custom: { q1: "" } });
assert.equal(submitButton().disabled, false, "submit stays enabled with no conditional options");
assert.equal(screen.queryByRole("note"), null, "no hint element renders when nothing is conditional");
cleanup();

console.log("question-needs-note-ui: ok");
