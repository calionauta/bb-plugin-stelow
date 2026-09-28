import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
];

const read = (relative) => readFileSync(join(fileURLToPath(import.meta.url), "..", "..", relative), "utf8");

/** Everything rendered above the first collapsible section of an open card. */
function alwaysVisibleRegions() {
  const content = read("components/detail/build-detail-content.tsx");
  const body = content.slice(content.indexOf("function BuildCardContent"));
  return body.slice(0, body.indexOf("<ExecutionRunsSection"));
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
  assert.ok(
    /useState\(active > 0 \|\| focusRunId !== null\)/.test(section),
    "it opens while work is in flight and when a deep link names a run; finished history starts closed",
  );
  assert.ok(
    /hint=\{runOutcomeHint\(runs, active\)\}/.test(section),
    "and the hint keeps the tally visible with the section closed, so closing it costs the outcomes and nothing else",
  );
});
