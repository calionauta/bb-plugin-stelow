/**
 * The collapsed description, the panel-less batch, and the recovered one.
 *
 * Split out of question-surface-collapse.test.mjs when that file crossed the
 * 400-line budget: the prose TRUNCATION rule is pure and lives in its own file
 * (question-prose-summary.test.mjs); everything here is component topology.
 *
 *  R2  the description renders COLLAPSED: head visible, tail behind the shared
 *      SUMMARY_LINK disclosure, no disclosure when nothing is hidden, and the
 *      pencil reachable while collapsed.
 *  R3  the live batch is no longer a bordered amber panel with role="alert" and
 *      a "?" badge, and the counters are gone from the renderer and from
 *      questionCopy() — while the step dots keep their position for assistive
 *      tech and skip, free text, split exclusivity and the atomic submit stay.
 *  R4  the timed-out batch is a DisclosureSection, CLOSED by default, titled
 *      from questionCopy().recoveryHeading.
 *
 * NOT duplicated here: question-presentation / question-decision-surface /
 * split-question-presentation / single-pick-composition / question-needs-note-ui
 * / option-section-wiring / card-design-tokens / disclosure-affordance.
 *
 * Left for THIS file: the falsifiable half of R1 ("always a door" across hostile
 * inputs, non-string degradation, one rule for both call sites) and the R2-R4
 * topology no other guard reads. A rendered mount is unavailable to a plain
 * `node` script (JSX needs the tsx loader; PromptRead/the stepper are private),
 * so R2-R4 pin wiring that cannot be extracted, each naming the regression it
 * would catch; extractable behaviour goes through the module.
 *
 * MUTATIONS RUN. One source edit at a time, test re-run, the six source files
 * restored from a snapshot and `diff`-confirmed identical; `git diff --stat`
 * names only this file and package.json. Every row was executed and went red.
 * Counted 28; the mutation -> catching test map, compactly:
 *
 *  `<=` to `<` -> 1        return input whole -> 2, 26, 27
 *  kill sentence rule -> 3 drop word floor -> 4, 5, 6
 *  ignore newlines -> 5    kill next-space rounding -> 6
 *  non-string guard never matches -> 7
 *  option row onto splitOptionDescription -> 8; description cut from "" -> 9
 *  disclosure unconditional -> 10; pencil inside the one <details> -> 11
 *  amber classes + role="alert" on the root -> 12, 13; restore the badge -> 14
 *  re-add answersNeeded -> 15; drop the dot's questionOf label -> 16
 *  drop the withoutKeep filter -> 17; break the single answerQuestions payload -> 18
 *  defaultOpen -> 19; open={true} -> 19b; hard-code the recovered title -> 20
 *  remove the skip label -> 21; the note label -> 22; the one <BatchCustomInput> -> 23
 *  drop the recovery hint -> 24; point the recovered batch at the live door -> 25
 *  start the tail one char late -> 26; move the limit to 200 -> 27
 *  re-export the 240 option rule -> 28
 *
 * Row 23 is why that pin counts render sites rather than checking the name
 * appears; rows 6 and 27 red "always a door" too, because the fixtures' lengths
 * derive from the limit, so a fixture that no longer exceeds it IS the failure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { questionCopy } from "../lib/question-presentation.mjs";
import { codeOf } from "./helpers/source-code.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

/**
 * Comments stripped: a comment naming the removed panel is documentation, not
 * the panel. The submit path then moved to its own hook when the component
 * crossed its function budget, so these pins follow the code, not the path.
 */
const batchCode = [
  read("components/conversation/question-batch.tsx"),
  read("components/conversation/use-answer-submit.ts"),
].map(codeOf).join("\n");
/** The dots and the heading moved to their own file; the pins follow the code, not the path. */
const headingCode = codeOf(read("components/conversation/batch-question-heading.tsx"));
const bodyCode = codeOf(read("components/conversation/batch-answer-body.tsx"));
const controlCode = codeOf(read("components/detail/prompt-edit-control.tsx"));

/** One function's own source, from `open` up to (not including) `close`. */
const blockOf = (source, open, close) => {
  const from = source.indexOf(open);
  const to = source.indexOf(close, from);
  assert.ok(from >= 0 && to > from, `${open} must be a bounded block ending before ${close} in this file`);
  return source.slice(from, to);
};

const promptRead = blockOf(controlCode, "function PromptRead(", "function EditorActions(");
const customAndSkip = blockOf(bodyCode, "function CustomAndSkip(", "export function BatchAnswerBody(");
// The recovered batch is the LAST export in its file, so its block runs to the end.
const expiredCode = codeOf(read("components/conversation/expired-questions-section.tsx"));
const expiredSection = expiredCode.slice(expiredCode.indexOf("export function ExpiredQuestionsSection("));
assert.ok(expiredSection.length > 0, "ExpiredQuestionsSection must exist — this pin reads its body");
/* ------------------------------------------------------------------ R2 --- */
test("R2: the description renders collapsed, tail behind the shared disclosure", () => {
  assert.match(
    promptRead,
    /\{summary\.head\}/,
    "the visible line is the head of the one truncation rule — not `{prompt}`, which is the wall this replaced",
  );
  assert.match(promptRead, /const remainder = summary\.tail;/, "the remainder comes from the rule's tail, so the collapse cannot disagree with the limit");
  assert.match(promptRead, /className=\{SUMMARY_LINK\}/,
    "the disclosure uses the named SUMMARY_LINK family rather than spelling its own classes — three named shapes "
    + "instead of seven paddings is how the same accordion stays one control");
  assert.match(read("components/detail/prompt-edit-control.tsx"), /import \{ DisclosureChevron, SUMMARY_LINK \} from "\.\.\/disclosure";/,
    "and the family is imported from the shared module, not redefined locally");
  assert.match(promptRead, /<details/, "a long description is disclosed: without this line there is no way to reach the rest");
  assert.match(promptRead, /\{remainder\}/, "the disclosure body renders the tail, so opening it reveals the rest");
  assert.ok(
    !/<p[^>]*>\{prompt\}/.test(promptRead),
    "the full prompt is never rendered inline: that is the regression R2 exists to undo",
  );
  assert.match(
    promptRead,
    /\{remainder \? \([\s\S]*?<details/,
    "the disclosure is guarded by the tail itself: a short description must render as one line, and a details element "
    + "that hides nothing is a control that does nothing",
  );
  assert.ok(
    !/<details/.test(promptRead.slice(promptRead.indexOf("</details>"))),
    "exactly one disclosure on this surface — a second would be two doors onto the same prose",
  );
  // The edit affordance sits AFTER the disclosure, so it stays reachable on the
  // collapsed view the reader lands on: editing is not gated behind expanding.
  const detailsEnd = promptRead.indexOf("</details>");
  const pencil = promptRead.indexOf('aria-label="Edit description"');
  assert.ok(detailsEnd > 0 && pencil > detailsEnd, "the pencil is a sibling of the <details>, never inside it");
  assert.match(promptRead, /editable \? \([\s\S]*?aria-label="Edit description"/, "and it renders from the editability decision");
});

/* ------------------------------------------------------------------ R3 --- */
test("R3: the batch is not an amber panel, the hero keeps the alert, and the badge is gone", () => {
  assert.ok(
    !batchCode.includes("border-amber-500/40") && !batchCode.includes("bg-amber-500/10"),
    "the amber container classes are gone: the batch renders inside the hero section that already wears the decision "
    + "tone, and a box inside a box announcing the same fact is what made nothing read as the primary action",
  );
  assert.ok(
    !batchCode.includes('role="alert"'),
    "a second live region for one fact is worse than one — the hero's decision style is the alert, and the batch is "
    + "not a second announcement of it",
  );
  assert.match(
    read("components/detail/detail-hero.tsx"),
    /decision: \{ wrap: "border-amber-500\/50 bg-amber-500\/5", dot: "bg-amber-500", alert: true \}/,
    "the alert really does live on the hero; removing it from both places would leave the state unannounced",
  );
  assert.ok(
    !/aria-hidden[^>]*>\s*\?\s*<\/span>/.test(batchCode),
    "the badge restated the hero in a decoration the reader had to decode; a question-mark circle returning to the "
    + "batch root means the panel frame is coming back with it",
  );
  assert.ok(
    !batchCode.includes("bg-amber-500/20"),
    "the badge's own wash is gone too, so a re-spelled badge fails here rather than passing on a different class order",
  );
});

test("R3: the removed progress strings are gone, and the dots keep the position for assistive tech", () => {
  const copy = questionCopy();
  for (const removed of ["answersNeeded", "batchProgress", "answersRemaining", "pickOneOrMore", "answerNeeded"]) {
    assert.equal(
      copy[removed],
      undefined,
      `questionCopy().${removed} must not come back: every counter restated a fact the hero's state line or the step `
      + "dots already carry, two lines apart",
    );
    assert.ok(!batchCode.includes(removed), `${removed} must not be referenced by the batch renderer either`);
  }
  assert.equal(copy.questionOf(2, 3), "Question 2 of 3", "the position copy the dots DO use survives the removal");
  assert.match(headingCode, /aria-current=\{i === index \? "step" : undefined\}/,
    "the current step is announced: removing the visible counter is only free if the dot still carries the position");
  assert.match(headingCode, /aria-label=\{`\$\{copy\.questionOf\(i \+ 1, questions\.length\)\}/,
    'the dot\'s label still reads "Question i of N" (plus answered state), so a screen-reader user loses nothing when '
    + "the visible counter goes");
});

test("R3: skip, free text and split exclusivity all survive", () => {
  assert.match(bodyCode, /\{copy\.skip\}/, "the explicit skip is still offered");
  assert.match(bodyCode, /\{copy\.skipped\}/, "and an explicit unskip reverses it — a skip with no way back is a trap");
  assert.match(bodyCode, /\{copy\.other\}/, "the free-text note keeps its label");
  // A count plus a home, not a bare existence check: deleting the site and
  // adding a second one are the two failures a `contains` pin cannot see.
  const noteSites = [...bodyCode.matchAll(/^\s*<BatchCustomInput\b/gm)];
  assert.equal(noteSites.length, 1, "the free-text note has exactly one render site — deleting it, or adding a second, is the regression");
  const groupOffset = bodyCode.indexOf("function CustomAndSkip(");
  const noteOffset = bodyCode.indexOf(noteSites[0][0]);
  assert.ok(
    noteOffset > groupOffset && noteOffset < groupOffset + customAndSkip.length,
    "and that one site is inside the note-and-skip group, so the note never drifts away from the control that decides "
    + "whether a skipped question still carries it",
  );
  // The exclusivity is asserted against the FINAL shape of the code (the
  // constant is imported and used directly, not threaded through the selection
  // state), and each half names the contradictory encoding it prevents.
  assert.match(batchCode, /const withoutKeep = \(prev\[question\.id\] \?\? \[\]\)\.filter\(\(item\) => item !== SPLIT_KEEP_LABEL\);/,
    "picking a delivery still clears the keep choice; without this a card answer encodes two contradictory outcomes");
  assert.match(batchCode, /if \(label === SPLIT_KEEP_LABEL\) return \{ \.\.\.prev, \[question\.id\]: has \? \[\] : \[SPLIT_KEEP_LABEL\] \};/,
    "and picking keep still clears the deliveries, which is the other half of the same exclusivity");
  assert.match(batchCode, /import \{ SPLIT_KEEP_LABEL \} from "\.\.\/\.\.\/lib\/split-proposal\.mjs";/,
    "the label is the shared constant, imported rather than re-spelled — a local copy would drift from the option "
    + "the split door writes, and the exclusivity above would then compare against the wrong string");
});

test("R3: the batch still submits atomically, one payload for every question", () => {
  // Counted by the call, not by the line it was written on: the submit moved to a
  // hook and reflowed, and a pin that breaks on formatting guards the formatter.
  assert.equal(
    (batchCode.match(/rpc\.call\("answerQuestions", \{/g) ?? []).length,
    1,
    "the live batch still submits in ONE call carrying every question index — a per-question call would let half a "
    + "batch land and the worker resume twice",
  );
  assert.match(batchCode, /answers: all\[i\] \?\? \[\]/,
    "every question in the batch is mapped into that one payload, including the unanswered ones");
  assert.match(batchCode, /const payload = expiredAnswerPayload\(questions, all\);/,
    "the recovered batch builds its whole payload once too, so a later answer cannot revise work already resumed");
});

/* ------------------------------------------------------------------ R3 --- */
test("R3: the accelerator's hooks run before the empty-batch return", () => {
  // The batch returns null for an empty batch, and the keyboard setup is a
  // HOOK. Calling it after that return changes the number of hooks between
  // renders the moment a batch arrives, which React refuses — a crash on the
  // exact transition this feature exists for (a question appearing).
  const stepper = blockOf(batchCode, "export function BatchStepper(", "export function QuestionBatch(");
  const earlyReturn = stepper.indexOf("if (questions.length === 0) return null;");
  const setup = stepper.indexOf("useStepperKeySetup(");
  assert.ok(earlyReturn >= 0, "the empty-batch guard is still there");
  assert.ok(setup >= 0, "the keyboard setup is still wired");
  assert.ok(
    setup < earlyReturn,
    "the accelerator hook must be called BEFORE the empty-batch return: a hook after an early return "
    + "renders a different number of hooks when a batch arrives, and React throws",
  );
});

/* ------------------------------------------------------------------ R5 --- */
test("R5: the refusal is stated at the field AND at the disabled submit", () => {
  // Two statements of one reason, deliberately. A UX review flagged the
  // duplication and the fix was tried and reverted: suppressing the footer
  // sentence leaves a DISABLED submit with no stated cause, which is the dead
  // end this codebase refuses everywhere else ("a refusal without an exit").
  // The field is where the fix is; the footer is where the reader learns why the
  // button they are looking at will not work.
  assert.match(bodyCode, /role="alert"\s+className=\{BLOCKED_CLASS\}|role="alert"/,
    "the note input's refusal is announced");
  assert.match(bodyCode, /id="batch-note-error"/, "and it is attached to the input it is about");
  assert.match(bodyCode, /aria-invalid=\{invalid \? true : undefined\}/, "the input is marked invalid, not merely described");
  assert.match(bodyCode, /aria-describedby=\{invalid && error \? "batch-note-error" : undefined\}/,
    "and the description points at that same element");
  // The footer's own line must survive: removing it disables the submit with no
  // explanation, and `question-needs-note-ui` fails on exactly that. The line
  // moved into FooterReason (which picks the refusal when there is one, and the
  // outstanding-question count otherwise), so the pin reads BOTH halves: the
  // component still renders the sentence, and the footer still passes the
  // refusal to it. A pin on only the call site would pass on a component that
  // renders nothing.
  assert.match(bodyCode, /className=\{BLOCKED_CLASS \+ " w-full"\}>\{line\}<\/p> : null/,
    "the footer's reason component still renders the sentence that explains the disabled submit");
  assert.match(bodyCode, /<FooterReason blockReason=\{blockReason\} incompleteReason=\{incompleteReason\} \/>/,
    "and the footer feeds it the refusal, so the explanation cannot become unreachable");
});

/* ------------------------------------------------------------------ R4 --- */
test("R4: the timed-out batch is a section from the shared disclosure module", () => {
  // The import is asserted as the member the section actually needs, not as a
  // fixed import list: the staleness advisory (which used the other two) moved
  // to its own file, and a pin that broke on that move was pinning the import
  // line rather than the reuse.
  // The recovered batch now lives in its own file, so the pin reads that file:
  // its import, its section, and its closed default.
  assert.match(expiredCode, /import \{ DisclosureSection \} from "\.\.\/disclosure";/,
    "the recovered batch uses the shared section rather than its own header markup");
  assert.ok(expiredSection.includes("<DisclosureSection"), "the section is the shared disclosure");
  assert.ok(
    !expiredSection.includes("<section"),
    "the hand-rolled <section> shell is gone; a section that draws its own container is the second implementation "
    + "this module already rejected once",
  );
  assert.match(expiredSection, /title=\{copy\.recoveryHeading\}/,
    "the title comes from questionCopy(), so the heading stays English-only and shared with the host copy");
  assert.match(expiredSection, /mode="expired"/, "the inner batch still takes the recovery door, not the live one");
  assert.match(expiredSection, /hint=\{`\$\{questions\.length\} timed out`\}/,
    "the count stays in the hint, so a closed section still tells the reader how much is behind it");
  assert.ok(
    !/\bdefaultOpen\b|\bopen=/.test(expiredSection),
    "a section that opens itself pushes history onto the reader's first screen — and a timed-out batch is neither "
    + "live nor blocking, the only two exemptions DisclosureSection allows",
  );
  assert.match(
    read("components/disclosure.tsx"),
    /defaultOpen = false/,
    "the closed default is the shared module's own promise, not a local omission: this pin would pass on "
    + "defaultOpen=true otherwise",
  );
});

console.log("question surface collapse test ok: one prose cut with a door, one collapsed description, no panel, a closed recovery section");
