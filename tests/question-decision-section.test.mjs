/**
 * The card's decision section, the hero that points at it, and the batch that
 * answers it — one guard per requirement of the 2026-10-27 card.
 *
 * Split of work, because the honest split is the point:
 *
 *  - R1 hero tone/count, R2 the hero's sentence, R5 the ask gate: the modules are
 *    exported and pure, so these run the real thing through `node`.
 *  - R3/R4/R6 are rendered. `BatchStepper` and `BatchOptionList` mount without a
 *    host, so the shortcut layer, the full option description and the submit-on-
 *    any-step rule are exercised through real DOM events and DOM topology
 *    instead of grepped strings. A green string pin proves only that a string
 *    exists.
 *  - The one section itself (`WaitingSection` in detail-question-sections) is
 *    NOT mountable here: it renders `QuestionBatch`, whose first hook is the
 *    host's `useRpc`, and the SDK export is not callable outside BB. So R1's
 *    section is guarded in three halves that are independently falsifiable:
 *    `questionCopy()` (title/subtitle wording and plural), a rendered
 *    `DisclosureSection` (tone resolves to amber; `defaultOpen` opens), and a
 *    source pin that the component passes those three props on ONE section.
 *
 * Every source pin below names the regression it catches. Nothing here asserts
 * that a class string merely exists: the amber class IS the decision tone under
 * test, and the chevron's controlled `rotate-90` is the difference between a
 * disclosure that tracks its own state and one that hoped a CSS variant would
 * rotate it (the exact bug `disclosure.tsx` records).
 *
 * Mutations this file was checked against, one at a time, source restored
 * between runs: hero decision style back to amber -> R1; hero count restored ->
 * R1; hero expired sentence promising a resume -> R2; a `keydown` listener
 * added to the stepper -> R3; `DetailsDisclosure` replaced by a hand-rolled
 * `<details>` or moved below the row -> R4; the guard in `parseAskIntent`
 * dropped or restricted to the question -> R5; `isLastQuestion || complete`
 * narrowed back to `isLastQuestion` -> R6.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { codeOf } from "./helpers/source-code.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

const { heroFor, HERO_STYLE } = await import("../components/detail/detail-hero.tsx");
const { BatchStepper } = await import("../components/conversation/question-batch.tsx");
const { BatchOptionList } = await import("../components/conversation/batch-options.tsx");
const { DisclosureSection } = await import("../components/disclosure.tsx");
const { questionCopy } = await import("../lib/question-presentation.mjs");
const { splitProseSummary } = await import("../lib/question-prose.mjs");
const { parseAskIntent } = await import("../server/runtime/cli/cli-ask-gate.ts");

afterEach(() => cleanup());

/* --------------------------------------------------------------- shared --- */

const option = (label, description = "", preview = null) => ({ label, description, preview, artifact: null });
const question = (id, prompt, labels) => ({
  id,
  title: "",
  prompt,
  multiple: false,
  options: labels.map((label) => option(label)),
});

const card = {
  activity: "idle",
  status: "active",
  stage: "shape",
  workerThreadId: "thr_worker",
  lastError: null,
};
const detail = (live, expired) => ({
  pendingQuestions: Array.from({ length: live }, () => ({})),
  expiredQuestions: Array.from({ length: expired }, () => ({})),
  card: { needsAttention: false, stallCount: 0 },
});

const submitButtons = () => screen.queryAllByRole("button", { name: "Submit answers" });
const footerText = () => document.body.textContent ?? "";

function renderBatch(questions, onSubmit = () => {}) {
  render(h(BatchStepper, {
    questions,
    allowSkip: true,
    busy: false,
    error: null,
    submitLabel: "Submit answers",
    onSubmit,
  }));
}

/** Two single-select questions, so "decided" is an explicit act on each. */
const twoQuestions = () => [
  question("q0", "First question?", ["First yes", "First no"]),
  question("q1", "Second question?", ["Second yes", "Second no"]),
];

/* ------------------------------------------------------------------ R1 --- */

test("R1: the hero gives up the decision count and the amber tone", () => {
  const { wrap, dot, alert } = HERO_STYLE.decision;
  assert.doesNotMatch(`${wrap} ${dot}`, /amber/i,
    "the status hero must not wear the decision tone: two amber boxes two lines apart read as decoration, "
    + "and the gold belongs to the section that holds the answerable decision");
  assert.equal(alert, true, "the hero keeps its live region — the card still announces that it started waiting");

  const one = heroFor(card, detail(1, 0));
  const many = heroFor(card, detail(7, 0));
  assert.deepEqual(many, one,
    "the hero is count-independent: the count belongs to the question section, so 1 and 7 pending questions "
    + "must render the same state line");
  assert.doesNotMatch(`${one.title} ${one.sub}`, /Needs your decision/i,
    "and the section's own subtitle never leaks into the hero");
  assert.equal(one.kind, "decision", "the hero still names the state the card is in");
});

test("R1: one open amber section, titled from copy, carries the count as subtitle", () => {
  const copy = questionCopy();
  assert.equal(copy.recoveryHeading, "Waiting for you",
    "the section's title is the one the requirement names — and `Waiting for you` is the live card's state too, "
    + "not a recovered-only phrase");
  assert.equal(copy.needsDecision(1), "Needs your decision — 1 question",
    "one decision reads singular");
  assert.equal(copy.needsDecision(4), "Needs your decision — 4 questions",
    "and a batch reads plural; the count is the section's subtitle, so a wrong inflection is a visible fact");

  render(h(DisclosureSection, {
    title: copy.recoveryHeading,
    subtitle: copy.needsDecision(2),
    tone: "decision",
    defaultOpen: true,
  }, h("p", null, "answerable body")));
  const section = document.querySelector("details");
  assert.ok(section, "the section renders as a native disclosure");
  assert.equal(section.open, true,
    "a blocking decision starts OPEN — a reader landing on the card must not have to discover the door");
  assert.match(section.className, /border-amber-500\/50/,
    "tone=\"decision\" resolves to the amber surface; a tone prop that no longer paints is a silent downgrade");
  assert.ok(screen.getByText("Waiting for you"), "the title is visible");
  assert.ok(screen.getByText("Needs your decision — 2 questions"), "the count is the subtitle, not a badge");

  // The wiring half: the component actually passes those props, on ONE section.
  // Restoring a second section (the live/recovered split this change merged)
  // would otherwise pass every assertion above.
  const sections = codeOf(read("components/detail/detail-question-sections.tsx"));
  assert.equal((sections.match(/<DisclosureSection\b/g) ?? []).length, 1,
    "exactly one decision section: a live batch and a recovered batch are one wait for the same human, and a "
    + "second section is the regression that made the live copy look like an alert and the recovered one like history");
  assert.match(sections, /title=\{copy\.recoveryHeading\}/,
    "the title travels from questionCopy(), so the heading cannot drift from the host copy");
  assert.match(sections, /const total = live \+ expired;/,
    "the count totals BOTH stores: an expired-only card rendered from `live` alone would read 0 questions");
  assert.match(sections, /subtitle=\{copy\.needsDecision\(total\)\}/,
    "and that total is what the subtitle renders");
  assert.match(sections, /tone="decision"/, "the section wears the amber tone");
  assert.match(sections, /defaultOpen/, "and starts open");
  assert.doesNotMatch(sections, /\bopen=\{/,
    "no controlled `open` prop: the real section cannot mount in this harness, so an `open={false}` added beside "
    + "`defaultOpen` would override the open state while every rendered pin here stayed green");
  assert.match(sections, /<WaitingSection live=\{pendingQuestions\.length\} expired=\{expiredQuestions\.length\}>/,
    "and the card mounts that section with both stores' counts — the props above are unrendered code without "
    + "this call site, which is the regression a substring pin cannot see");
  assert.match(sections, /\{children\}/,
    "and the section renders its children: an amber header with no answerable body is the phantom wait this "
    + "card exists to remove");
});

/* ------------------------------------------------------------------ R2 --- */

test("R2: the hero's sentence tells the truth per store", () => {
  const live = heroFor(card, detail(2, 0));
  assert.equal(live.kind, "decision");
  assert.match(live.sub, /paused until you answer/i,
    "a live ask is a worker waiting on this answer, and the hero must say so");
  assert.doesNotMatch(live.sub, /timed out/i, "a live ask is not described as recovered");

  const timedOut = heroFor(card, detail(0, 2));
  assert.equal(timedOut.kind, "decision", "a timed-out question still needs the human");
  assert.match(timedOut.sub, /timed out/i,
    "the hero names what actually happened to the question");
  assert.doesNotMatch(timedOut.sub, /resumes?\b/i,
    "a timed-out batch does not resume the worker: claiming it does is the same lie the recovered section used "
    + "to carry, one screen higher");
  assert.doesNotMatch(timedOut.sub, /paused until you answer/i,
    "and the live sentence cannot be reused over recovered questions");

  const both = heroFor(card, detail(1, 2));
  assert.match(both.sub, /paused until you answer/i,
    "with a live ask in the mix the resume claim is true again — live wins without hiding the timed-out store");
});

/* ------------------------------------------------------------------ R3 --- */

test("R3: no digit, arrow, letter or chord answers the batch", () => {
  let submits = 0;
  renderBatch(twoQuestions(), () => { submits += 1; });
  const prompt = screen.getByText("First question?");
  const buttons = document.querySelectorAll("button").length;

  for (const key of ["1", "2", "ArrowRight", "ArrowLeft", "j", "k", "s", "o", "x", "?"]) {
    fireEvent.keyDown(prompt, { key });
  }
  fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
  fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });

  assert.deepEqual(
    screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked")),
    ["false", "false"],
    "a digit is not a pick: the option mark is the only control that answers a question",
  );
  assert.ok(screen.queryByText("First question?"),
    "an arrow is not navigation: the stepper moves on its own buttons only");
  assert.equal(screen.queryByText(/^Skipped/), null,
    "a bare letter is not a skip — `s` belongs to whoever is typing or to the browser");
  assert.equal(document.querySelectorAll("button").length, buttons,
    "no `?` overlay added controls to the page");
  assert.ok(!footerText().includes("all shortcuts"),
    "and no legend copy rendered — the shortcut list is gone, not merely hidden");
  assert.equal(submits, 0, "Cmd/Ctrl+Enter is not a submit chord on the batch");
});

test("R3: the batch source holds no key listener and no accelerator module", () => {
  const batchCode = [
    "components/conversation/question-batch.tsx",
    "components/conversation/batch-answer-body.tsx",
    "components/conversation/batch-options.tsx",
    "components/conversation/batch-question-heading.tsx",
  ].map((file) => codeOf(read(file))).join("\n");
  assert.doesNotMatch(batchCode, /onKeyDown|addEventListener\(\s*["']keydown|batchKeyDecision|BATCH_KEY_/,
    "no private keyboard router in any batch module: every control is a button, input or native summary, so "
    + "Tab/Enter/Space work without teaching a second key map (the rendered test above proves the same at runtime)");
  assert.equal(existsSync(join(repoRoot, "lib/batch-keys.mjs")), false,
    "the accelerator module stays deleted: an absence by deletion is not a guard, which is why the rendered test exists");
  assert.equal(existsSync(join(repoRoot, "components/conversation/batch-keys-ui.tsx")), false,
    "and its legend/overlay component stays deleted");
});

test("R3: a completed batch does not submit on Cmd/Ctrl+Enter", () => {
  let submits = 0;
  renderBatch(twoQuestions(), (answers) => { submits += answers.length; });
  fireEvent.click(screen.getByText("First yes"));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByText("Second no"));
  const note = screen.getByRole("textbox");
  fireEvent.keyDown(note, { key: "Enter", metaKey: true });
  fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
  assert.equal(submits, 0,
    "the chord used to submit from inside the note; a complete batch still submits only through its button");
});

/* ------------------------------------------------------------------ R4 --- */

// The fixture is longer than the retired 140-character rule, so the old row
// would have shown its first sentence and hidden the rest behind "Full detail".
const LONG_DESCRIPTION = "This option's first sentence is long enough that the retired prose rule cut it. "
  + "The remainder used to live behind a collapsed disclosure inside the row, which meant the reader "
  + "judged the trade-off from half a sentence plus a control promising the half that mattered. "
  + "The row now renders all of it: an option description is one to three sentences, not a document.";

function renderOptionList(options) {
  render(h(BatchOptionList, {
    current: { id: "q1", title: "Pick one", prompt: "Pick one", multiple: false, options },
    isSplitProposal: false,
    splitKeepLabel: "Keep as one card",
    selected: {},
    onPick: () => {},
  }));
}

test("R4: the full description renders in the pick control, with no disclosure", () => {
  assert.ok(LONG_DESCRIPTION.length > 140,
    "the fixture exceeds the retired limit, or the row would be short for the wrong reason");
  assert.ok(splitProseSummary(LONG_DESCRIPTION).tail,
    "the retired rule cut exactly this fixture: the negative control the row must not reproduce");
  renderOptionList([option("Long option", LONG_DESCRIPTION), option("Short option", "Fits on one line.")]);

  const row = screen.getByText("Long option").closest("div.rounded-md");
  assert.ok(row?.classList.contains("border"),
    "the option row is the bordered container that must hold the whole description");
  assert.equal(row.querySelector("details"), null,
    "no disclosure inside the row: the reader judges the option from the row, not from a second click");
  const description = screen.getByText(LONG_DESCRIPTION);
  assert.equal(description.textContent, LONG_DESCRIPTION,
    "the description is rendered verbatim — no head, no ellipsis, no recomposition");
  assert.equal(row.contains(description), true, "and it lives inside the option row it describes");
  // The row alone is not the claim in this test's name: the description has to
  // be inside the PICK control, or it is a detached block the reader may not
  // read as the thing they are choosing.
  const pick = row.querySelector("button");
  assert.ok(pick, "the row still has its pick control");
  assert.equal(pick.contains(description), true,
    "the whole description is part of the pick target, not a block beside it");
  assert.equal(screen.queryByText(/Full detail/), null,
    "the old disclosure label is gone, not merely collapsed");
});

test("R4: the row no longer reaches the prose-summary rule at all", () => {
  renderOptionList([option("Short option", "Fits on one line.")]);
  assert.equal(screen.getByText("Short option").closest("div.rounded-md").querySelector("details"), null,
    "a short description still renders no disclosure — and not because a length rule said so");

  const source = codeOf(read("components/conversation/batch-options.tsx"));
  assert.doesNotMatch(source, /splitProseSummary/,
    "re-importing the 140-char rule is the regression: the retired pin /splitProseSummary(description)/ "
    + "would pass again, and the row would hide the half of the description the reader needs");
  assert.doesNotMatch(source, /Full detail|AUTO_REVEAL_PREVIEW_CHARS|DetailsDisclosure/,
    "the disclosure and the preview threshold are removed from the row, not merely unreachable");
});

/* ------------------------------------------------------------------ R5 --- */

const ask = (...args) => parseAskIntent(["ask", "--thread", "thr_worker", ...args], {});

test("R5: the ask gate refuses the retired word in every field and names the replacement", () => {
  const refusals = {
    "question text": ask("--question", "Is this bigger than the appetite?", "--option", "Yes", "--option", "No"),
    "option label": ask("--question", "Which surface?", "--option", "Keep the appetite small", "--option", "No"),
    "option description": ask("--question", "Which surface?", "--option", "Yes", "--desc", "The appetite is small.", "--option", "No"),
  };
  for (const [field, result] of Object.entries(refusals)) {
    assert.ok("refusal" in result, `the retired word in the ${field} is refused before the human sees the question`);
    assert.equal(result.refusal.exitCode, 2, `${field}: a content refusal exits 2, the ask-gate contract`);
    assert.match(result.refusal.stderr, /declared quality and exploration knobs/,
      `${field}: the refusal names the replacement, or the worker's retry cannot succeed`);
  }

  const accepted = ask(
    "--question",
    "Does the shape fit within the declared quality and exploration knobs?",
    "--option",
    "Fits",
    "--option",
    "Does not fit",
  );
  assert.ok(!("refusal" in accepted),
    "the replacement wording passes the same gate — a guard that refuses its own remedy is a dead end");
  assert.equal(accepted.groups[0].question, "Does the shape fit within the declared quality and exploration knobs?",
    "and the accepted question travels intact");
});

/* ------------------------------------------------------------------ R6 --- */

test("R6: submit appears on any step once every question is decided", () => {
  renderBatch(twoQuestions());
  assert.equal(submitButtons().length, 0,
    "an undecided batch offers no submit on the first step");
  assert.match(footerText(), /2 questions remain\. Answer or skip them before submitting\./,
    "and the footer states the reason the door is absent");

  fireEvent.click(screen.getByText("First yes"));
  assert.equal(submitButtons().length, 0,
    "answering one of two is not a finished batch");
  assert.match(footerText(), /1 question remains\. Answer or skip it before submitting\./,
    "the reason updates with the real remainder");

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  assert.equal(submitButtons().length, 1, "the last step always carries the door");
  assert.equal(submitButtons()[0].disabled, true,
    "but it is unavailable while a question is still undecided");
  assert.match(footerText(), /1 question remains/,
    "a disabled submit states its cause beside itself");

  fireEvent.click(screen.getByText("Second no"));
  assert.equal(submitButtons()[0].disabled, false, "with every question decided the submit works");

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  assert.equal(submitButtons().length, 1,
    "walking BACK onto a decided question keeps the door: a reader who answered the last question first "
    + "must not have to hunt for a button on a different step");
  assert.equal(submitButtons()[0].disabled, false, "and it stays usable from the earlier step");
});

test("R6: an explicit skip counts as a decision", () => {
  renderBatch(twoQuestions());
  fireEvent.click(screen.getByRole("button", { name: /^Skip/ }));
  assert.match(footerText(), /1 question remains/,
    "a skipped question stops being outstanding — otherwise skip would not be a decision at all");

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: /^Skip/ }));
  assert.equal(submitButtons().length, 1, "the last step carries the submit");
  assert.equal(submitButtons()[0].disabled, false,
    "two skips are two decisions: the batch is answerable without picking any option");

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  assert.equal(submitButtons().length, 1,
    "and the submitted batch stays reachable from the step that was skipped");
});
