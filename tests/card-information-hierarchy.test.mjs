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
