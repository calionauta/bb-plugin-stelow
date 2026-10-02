import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPENDENCY_STATE } from "../lib/scope-dependency-relations.mjs";

/**
 * Every fact the card shows must have exactly one home.
 *
 * This exists because a summary strip was added to the top of the open card
 * and then had to be removed again. Its four fields were the blocker, the
 * stage, the file count and the scope tally — and every one of them was
 * ALREADY on the card, in a better place: the hero's title is the authoritative
 * state line ("Needs your decision — 2 questions", "Working — Execution"), the
 * progress disclosure's hint is a scope tally, and its action button plus the
 * Artifacts hint are file counts. So the strip added a fifteenth bordered box
 * and a ninth border treatment in order to restate the card four times.
 *
 * That is the failure this pins. It is not a styling opinion — it is the
 * difference between a card that reads as one thing and a card that reads as a
 * stack of equal-weight boxes, and it is invisible to every other test in this
 * repo because each of those facts is individually correct.
 *
 * The rule it enforces: a fact stated at the top of the card must be stated
 * where it is DECIDED, not where it happens to be convenient. The hero decides
 * the card's state. A section that owns a thing reports that thing. Nothing
 * above a section may repeat what that section will say when opened — and a
 * disclosure's hint counts as "when opened", because a hint is visible with the
 * section closed.
 */

/** One place per fact. Add a fact here when it is added to the card. */
const FACT_HOMES = [
  {
    fact: "what the card is waiting on you for",
    decidedIn: "components/detail/detail-hero.tsx",
    // The hero's decision branch. A second copy anywhere above the sections
    // would be the same sentence in a different box.
    evidence: /title: pending === 1 \? "Needs your decision to continue"/,
    because: "the hero is the card's one authoritative state line; a second copy is a duplicate box, not a summary",
  },
  {
    fact: "which stage the card is at",
    decidedIn: "components/detail/detail-hero.tsx",
    evidence: /title: `Working — \$\{stageLabel\(card\.stage\)\}`/,
    because: "a stage line above the hero, or beside it, competes with the hero for the reader's first glance",
  },
  {
    fact: "which GitHub issue this card is linked to",
    decidedIn: "components/github/github-linked-discussion.tsx",
    evidence: /mirrored from \$\{discussion\.repo\}#\$\{discussion\.number\}/,
    because: "the linked issue's identity belongs to the section that owns GitHub linkage. It was a line "
      + "inside the worker section — a different component, two scroll positions up — while the mirror "
      + "said 'Open on GitHub' and never named the issue, so a reader could see that a link existed "
      + "without learning which issue it was",
  },
  {
    fact: "how many scopes are done",
    decidedIn: "components/detail/build-progress.tsx",
    evidence: /\$\{progress\.scopes\.done\}\/\$\{progress\.scopes\.total\} scopes/,
    because: "it is the progress disclosure's hint — visible with the section closed, so a top-level copy buys nothing",
  },
  {
    fact: "how many files the card produced",
    decidedIn: "components/detail/build-progress.tsx",
    evidence: /artifactTotal\} file/,
    because: "it is the progress section's own action, beside the hint it qualifies",
  },
  {
    fact: "how each execution run ended",
    decidedIn: "components/detail/execution-runs-section.tsx",
    evidence: /runOutcomeHint\(runs, active\)/,
    because: "it is the run section's hint, so the tally survives the section being closed",
  },
  {
    fact: "that the host is not answering this card's state read",
    decidedIn: "components/detail/detail-hero.tsx",
    // The CALL, inside the function that decides the hero, above the failure
    // branch — not merely that a function with the right name exists. A pin on
    // the declaration passes on a hero that never consults it, which is the
    // door-shaped hole this repo keeps refusing: the sentence is right and the
    // card is still wrong. The sentence itself is proven where it is derived
    // (tests/host-read-streak.test.mjs); this proves the hero opens the door.
    evidence: /const unreadable = unreadableHero\(card\);\s*if \(unreadable\) return unreadable;[\s\S]*?if \(card\.activity === "error"\)/,
    because: "a frozen card looks like an idle card, and the whole fix is that the reader is told; "
      + "a copy beside the hero would restate the hero's own state line",
  },
  {
    fact: "that the host is not answering, on the board tile",
    decidedIn: "components/dashboard/build-status-pills.tsx",
    // The tile's chip. A card's board tile is a different surface from its
    // detail, so this is not a second home for the hero's sentence — it is the
    // same channel's only door onto the board, and it names rather than
    // explains, because a tile has no room to explain and nobody opens one to
    // read a paragraph.
    evidence: /\{card\.readMissSince != null \? <ReadMissPill \/> : null\}/,
    because: "the board is where a stale card is noticed at all; without a chip here a reader must open "
      + "every frozen card to learn the host is down",
  },
  {
    fact: "that this card is waiting on another card's file",
    decidedIn: "components/detail/detail-hero.tsx",
    // The hero decides the card's state, and contention is a state: the card is
    // paused, and the reason is another card. The per-scope lock line is a
    // different granularity, not a second copy — it answers "which scope, which
    // file" for the scope being worked, the way the scope's own pills answer for
    // its status. Both are derived from one record (lib/lock-blocked.mjs), so
    // neither can be written with a different fact than the other.
    evidence: /const contention = lockWaitHero\(detail\?\.fileLocks \?\? null\)/,
    because: "a reader told 'the worker is idle with unfinished work' cannot tell a contention from a crash; naming the holder is the whole fix",
  },
];

const read = (relative) => readFileSync(join(fileURLToPath(import.meta.url), "..", "..", relative), "utf8");

/**
 * Everything rendered above the first collapsible section of an open card.
 *
 * The slice point used to be the literal `"<ExecutionRunsSection"`. When the
 * three stage components were merged and that name left the file, `indexOf`
 * returned -1 and `slice(0, -1)` silently returned the WHOLE body — so the
 * guard kept passing while covering 100% of the card instead of the 530
 * characters above the first section. A guard that quietly stops guarding is
 * worse than no guard, because it reports safety.
 *
 * So the anchor is resolved, not assumed: find the first section component in
 * the render tree and fail loudly if the shape this guard depends on changes.
 * `-1` is now an assertion failure, never a wider slice.
 */
function alwaysVisibleRegions() {
  const content = read("components/detail/build-detail-content.tsx");
  const start = content.indexOf("function BuildCardContent");
  assert.ok(start >= 0, "build-detail-content.tsx still declares BuildCardContent");
  const body = content.slice(start);
  // The first collapsible section on the card, whatever it is called.
  const anchor = body.search(/<(ExecutionRunsSection|IntegratedStageSection|StageSection|DisclosureSection)\b/);
  assert.ok(
    anchor >= 0,
    "no section opener found in BuildCardContent — this guard slices the body up to the first "
    + "section, and with no anchor it would guard the entire card instead of the region above it",
  );
  return body.slice(0, anchor);
}

test("each fact on the card is decided in exactly one place", () => {
  for (const { fact, decidedIn, evidence, because } of FACT_HOMES) {
    assert.match(read(decidedIn), evidence, `${fact} must still be stated in ${decidedIn} — ${because}`);
  }
});

test("nothing above the first disclosure restates what a section will say", () => {
  const above = alwaysVisibleRegions();
  // The hero is the one thing allowed above, because it is what decides state.
  // A summary strip is not: it can only repeat, since every fact it could carry
  // is already spoken for by a hero line or a section hint.
  const components = above.match(/<([A-Z][A-Za-z]+)/g)?.map((tag) => tag.slice(1)) ?? [];
  const offenders = components.filter((name) => /summary|overview|digest|stats|at-a-glance/i.test(name));
  assert.deepEqual(
    offenders,
    [],
    "a summary region above the first section can only duplicate the card: the hero owns the state, and every "
    + "count is already a section hint. Add the fact to its owning section instead",
  );
});

test("the run list is a disclosure, not a permanently-open stack of rows", () => {
  const section = read("components/detail/execution-runs-section.tsx");
  assert.ok(
    section.includes("<DisclosureSection"),
    "a card with a dozen finished runs must not push everything else a dozen rows down the page",
  );
  // Open unless the section is `live` or `blocking` — the same rule every other
  // section on the card follows. A deep link names a run; a run in flight is
  // live; a run that FAILED and is holding the card at its stage is blocking,
  // and leaving that one shut would hide the Retry button that the advance
  // refusal tells the reader to press. Finished history still starts closed.
  assert.ok(
    /useState\(active > 0 \|\| focusRunId !== null \|\| blockingRunId !== null\)/.test(section),
    "it opens while work is in flight, when a deep link names a run, and when a run is blocking the card; finished history starts closed",
  );
  assert.ok(
    /hint=\{runOutcomeHint\(runs, active\)\}/.test(section),
    "and the hint keeps the tally visible with the section closed, so closing it costs the outcomes and nothing else",
  );
});

// ---------------------------------------------------------------------------
// A scope's dependencies, and the one fact a card states twice.
//
// The dependency rows used to be pills reading "after <name>" at 11px, where a
// satisfied dependency and a waiting one rendered the SAME string and only the
// background differed. The state was therefore carried by colour alone
// (WCAG 1.4.1) and vanished wherever colour does not survive. Separately, the
// progress region was called "Checks" while the box inside it rendered its own
// <h3>Checks</h3> — one label, twice, with a heading inside a heading.
// ---------------------------------------------------------------------------

const scopeRelations = read("components/detail/scope-relations.tsx");
const buildProgressSource = read("components/detail/build-progress.tsx");

test("a dependency's state is a word, not only a colour", () => {
  // The rows come from lib, which derives the word; the component renders it.
  assert.match(scopeRelations, /row\.text/, "the row text is rendered, so state is visible without styling");

  // This was first asserted as `doesNotMatch(/after \{byId\.get\(dep\)/)`, which
  // is blind in the way a literal pin always is: it names the OLD source's
  // variable, so a component that still said `after <name>` for a satisfied
  // dependency would satisfy the guard just by using any other identifier. The
  // property worth pinning is that the row's own SENTENCE is what renders.
  // `row.glyph` and `row.tone` legitimately render beside it — decoration is
  // allowed, a rebuilt sentence is not, because that is how a satisfied and a
  // waiting dependency came to look identical again.
  assert.doesNotMatch(
    scopeRelations,
    /\{\s*`\$\{row\.(to|label)\}[^`]*`\s*\}/,
    "the row's own text is what renders; assembling a sentence from its parts is how a "
    + "satisfied and a waiting dependency came to look identical again",
  );
  assert.match(
    scopeRelations,
    /\{row\.text\}/,
    "the derived sentence is rendered as-is",
  );

  // And the words are a contract, read from the module that derives them, so a
  // state renamed in one place cannot silently disagree with the other.
  for (const [name, info] of Object.entries(DEPENDENCY_STATE)) {
    assert.ok(
      typeof info.label === "string" && info.label.trim().length > 0,
      `state "${name}" has a word — a state with no word is colour-only`,
    );
  }
});

test("a region and the box inside it do not share a label", () => {
  // This guard was first written as `doesNotMatch(/<h3>Checks<\/h3>/)`, which
  // could never have caught the defect it was written for: the real code was
  // `<h3 className="...">Checks</h3>`, so the attribute-less regex never
  // matched and a reinstated defect stayed green. A guard that reports safety
  // it does not provide converts a regression into a silent one.
  //
  // It also cannot be fixed by matching a region's body with a lazy regex: the
  // region wraps a CHILD COMPONENT, so the first `</ProgressRegion>` is the
  // child's and a lazy match reads an empty body, checking nothing. That
  // version also passed against a reinstated defect.
  //
  // So the invariant is stated where it is actually decidable: inside the
  // progress file, no heading may carry a region title. The region renders its
  // title through the shared `ProgressRegion` component, so a heading repeating
  // one of these strings is a child restating its region — whatever component
  // it sits in.
  const regionTitles = [...buildProgressSource.matchAll(/<ProgressRegion\s+title="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(regionTitles.length >= 5, `found ${regionTitles.length} regions to check`);

  const headings = [...buildProgressSource.matchAll(/<h[1-6][^>]*>([^<]*)</g)].map((m) => m[1].trim());
  for (const title of regionTitles) {
    const restated = headings.filter((h) => h.toLowerCase() === title.toLowerCase());
    assert.deepEqual(
      restated,
      [],
      `the "${title}" region must not be restated by a heading in the progress file — `
      + "the region owns the name, the box owns the content",
    );
  }
});

test("which scope is running is named once", () => {
  // It used to be "Doing now" in the progress bar and "Executing" in a second
  // line below, with the same glyph — three names for one fact.
  const doing = buildProgressSource.match(/● Doing now/g) ?? [];
  const executing = buildProgressSource.match(/● Executing/g) ?? [];
  assert.equal(doing.length, 1, "one vocabulary for the running scope");
  assert.equal(executing.length, 0, "the second vocabulary is gone");
});

// ---------------------------------------------------------------------------
// An affordance a reader cannot see is one they cannot want.
//
// `UnlinkedDiscussionCard` returned null when the card had no GitHub
// repository, so the "link an issue" affordance existed only where it had
// nothing to do — the section was visible exactly when it was useless, and
// absent exactly when a reader was stuck. The section is now always present;
// one case states the fact, the other offers the form.
// ---------------------------------------------------------------------------

const linkedDiscussion = read("components/github/github-linked-discussion.tsx");

test("the unlinked discussion section is never silently absent", () => {
  // Pinning the exact `if (!canCreate || ...) return null;` line was the first
  // attempt and it was blind in the same way as the B1 guard: reintroduce the
  // regression as `if (noRepos) return null;` and the suite stayed green. The
  // property is therefore about the COMPONENT, not about one spelling of its
  // guard: the unlinked card must not have an early return at all, and both
  // answers must be reachable.
  const unlinked = linkedDiscussion.slice(
    linkedDiscussion.indexOf("function UnlinkedDiscussionCard("),
    linkedDiscussion.indexOf("function CreateIssueForm("),
  );
  assert.ok(unlinked.length > 0, "the unlinked component is present");
  assert.doesNotMatch(
    unlinked,
    /\breturn null\b/,
    "the unlinked section must never return null — an affordance that vanishes is not "
    + "findable, and the case it would vanish for is the case a reader is stuck on",
  );
  assert.match(linkedDiscussion, /function NoGitHubAccess\(\)/, "the no-access case states the fact");
  assert.match(linkedDiscussion, /function CreateIssueForm\(/, "the creatable case offers the form");
  assert.match(
    linkedDiscussion,
    /noRepos[\s\S]{0,80}?\?\s*\(\s*<NoGitHubAccess \/>/,
    "the section chooses between the two rather than collapsing",
  );
});
