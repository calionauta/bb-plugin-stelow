import assert from "node:assert/strict";
import {
  createPublicationReconcile,
  reconcilePublications,
} from "../server/publication-reconcile.ts";
import { createProbeBackoff } from "../lib/publication-probe-backoff.mjs";

// Publication reconcile: work that landed outside the panel writes no event, so
// the board keeps reporting it as owed after it landed.
//
// The pass asks the SAME question the worktree cleanup gate asks before it
// deletes a directory — a recorded merge, or a base branch that already contains
// this branch's files. Both are positive proofs.
//
// What it must never do is guess. "No unpushed commits" is not a proof (a pushed
// and unmerged branch has none either), and neither is a forge that will not
// answer. Every unproven case below must leave the ledger alone: a chip reading
// "No commit recorded" is honest, and a chip reading "landed" on an inference is
// not.

const MERGED = {
  outcome: "available",
  pullRequest: { number: 251, url: "https://example.test/pr/251", state: "merged" },
};
const OPEN = {
  outcome: "available",
  pullRequest: { number: 251, url: "https://example.test/pr/251", state: "open" },
};

/** A git runner whose base branch already contains HEAD's files. */
const contentMatches = (_cwd, args) => {
  if (args[0] === "rev-parse" && args[1] === "--verify") return Promise.resolve({ ok: true, stdout: "base123" });
  if (args[0] === "rev-parse") return Promise.resolve({ ok: true, stdout: "head456" });
  if (args[0] === "diff") return Promise.resolve({ ok: true, stdout: "" });
  return Promise.resolve({ ok: false, stdout: "" });
};

/** A git runner whose branch carries files the base does not have. */
const contentDiffers = (_cwd, args) => {
  if (args[0] === "diff") return Promise.resolve({ ok: true, stdout: "server/thing.ts" });
  return contentMatches(_cwd, args);
};

/** A git runner that cannot resolve the base — every proof must fail closed. */
const gitBroken = () => Promise.resolve({ ok: false, stdout: "" });

/** The ledger and board reads, over the arrays the test can inspect. */
function fakeDb({ cards, events, inserts }) {
  return {
    prepare(sql) {
      if (sql.includes("INSERT INTO publication_events")) {
        return { run: (...args) => inserts.push(args) };
      }
      if (sql.includes("FROM publication_events")) {
        return { all: (cardId) => (events[cardId] ?? []).map((action) => ({ action })) };
      }
      if (sql.includes("FROM cards")) {
        return { all: () => cards.map((id) => ({ id })) };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function fakeCore({
  cards = ["card_x"], events = {}, pullRequest = OPEN, checkoutPath = "/work/wt",
  runGitIn = contentMatches, forgeThrows = false, getCardThrows = [],
  startNow = 1790000000000,
} = {}) {
  const inserts = [];
  const warns = [];
  // The pass bounds itself with the clock and schedules a card's next ask with
  // it, so the clock is the test's to move; `startNow` keeps every case written
  // before the budget on the one fixed instant it was written against.
  let clock = startNow;
  let pullRequestCalls = 0;
  const probedCards = [];
  return {
    inserts,
    warns,
    advance: (ms) => { clock += ms; },
    probeCalls: () => pullRequestCalls,
    probed: () => probedCards.slice(),
    core: {
      db: fakeDb({ cards, events, inserts }),
      bb: {
        log: { warn: (message) => warns.push(message) },
        sdk: {
          environments: {
            pullRequest: async () => {
              pullRequestCalls += 1;
              if (forgeThrows) throw new Error("forge down");
              return pullRequest;
            },
          },
        },
      },
      now: () => clock,
      randomId: (prefix) => `${prefix}_test`,
      cardNotFound: "not found",
      getCard: (id) => {
        if (getCardThrows.includes(id)) throw new Error(`card store refused ${id}`);
        return { id, status: "completed", workspace_kind: "project" };
      },
      checkout: async (card) => {
        probedCards.push(card.id);
        return { environmentId: "env_1" };
      },
      discardEvidence: async () => (checkoutPath === null ? null : { checkoutPath }),
      runGitIn,
    },
  };
}

// --- a merged pull request lands the card ---------------------------------

{
  const { core, inserts } = fakeCore({ pullRequest: MERGED });
  await reconcilePublications(core);
  assert.equal(inserts.length, 1, "a merged PR records exactly one event");
  assert.equal(inserts[0][1], "card_x", "the event belongs to the card");
  assert.equal(inserts[0][2], "pull_request_merge", "a merged PR is recorded as one");
  assert.equal(inserts[0][5], MERGED.pullRequest.url, "the PR url is recorded");
}

// --- the content proof lands a card no pull request ever recorded ----------
// card_oqm8gyae: committed by hand on a rescue branch, merged by content.

{
  const { core, inserts } = fakeCore({ pullRequest: OPEN, runGitIn: contentMatches });
  await reconcilePublications(core);
  assert.equal(inserts.length, 1, "a base that already contains the files lands the card");
  assert.equal(inserts[0][2], "reconciled_integrated", "the content proof names itself");
  assert.equal(inserts[0][5], null, "there is no pull request url to record");
}

// --- a branch the base does not contain does not land ----------------------

{
  const { core, inserts } = fakeCore({ pullRequest: OPEN, runGitIn: contentDiffers });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "unmerged work stays owed");
}

// --- "no unpushed commits" is not a proof, and neither is an unreadable answer

{
  const { core, inserts } = fakeCore({
    pullRequest: { outcome: "unavailable", message: "no" },
    runGitIn: contentDiffers,
  });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "an unreadable status records nothing");
}

// --- a workspace that is gone proves nothing -------------------------------

{
  const { core, inserts } = fakeCore({ pullRequest: OPEN, checkoutPath: null });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "no workspace, no content proof");
}

// --- git that cannot answer fails closed -----------------------------------

{
  const { core, inserts } = fakeCore({ pullRequest: OPEN, runGitIn: gitBroken });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "an unresolvable base is not an integration");
}

// --- idempotent -------------------------------------------------------------

{
  const { core, inserts } = fakeCore({
    pullRequest: MERGED,
    events: { card_x: ["commit", "reconciled_integrated"] },
  });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "a card already recorded as landed is not recorded twice");
}

// --- a forge error is silence, not a landing -------------------------------

{
  const { core, inserts, warns } = fakeCore({ forgeThrows: true, runGitIn: contentDiffers });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "an error never lands a card");
  assert.equal(warns.length, 0, "a forge that will not answer is an answer: no, and it is not an incident");
}

// --- a card that breaks the pass is reported, and does not stop the others --

{
  const { core, inserts, warns } = fakeCore({
    cards: ["card_bad", "card_good"],
    getCardThrows: ["card_bad"],
    pullRequest: MERGED,
  });
  await reconcilePublications(core);
  assert.equal(inserts.length, 1, "the card after the broken one is still asked about");
  assert.equal(inserts[0][1], "card_good", "and it is the good one that lands");
  assert.equal(warns.length, 1, "the broken card is reported once, not swallowed");
  assert.match(warns[0], /could not ask the forge about 1 card/, "the warning names the count");
  assert.match(warns[0], /card_bad \(card store refused card_bad\)/, "and the card and the reason");
}

// A pass with nothing wrong stays quiet: a warning that fires every tick is a
// warning nobody reads.
{
  const { core, warns } = fakeCore({ pullRequest: OPEN, runGitIn: contentDiffers });
  await reconcilePublications(core);
  assert.equal(warns.length, 0, "a clean pass says nothing");
}

// --- the pass is bounded: five cards per tick, then a per-card wait --------
// Seven finished cards that will never land used to cost seven git calls and
// seven forge calls every tick, measured at 59.7 s in one pass. Two rules bound
// it at once: at most five cards asked per pass, and no card asked again until
// its own wait expires. The pass takes its schedule as an argument, which is how
// this test holds the one production holds across ticks.

const SEVEN = ["card_1", "card_2", "card_3", "card_4", "card_5", "card_6", "card_7"];

{
  const { core, inserts, warns, advance, probeCalls, probed } = fakeCore({
    cards: SEVEN,
    pullRequest: OPEN,
    runGitIn: contentDiffers,
  });
  const backoff = createProbeBackoff();

  await reconcilePublications(core, backoff);
  assert.equal(probeCalls(), 5, "one pass probes five of the seven cards");
  assert.deepEqual(probed(), SEVEN.slice(0, 5), "oldest first, so a capped pass cannot starve a card");
  assert.equal(inserts.length, 0, "an open pull request over a differing tree proves nothing");
  assert.equal(warns.length, 0, "a card that is not proved yet is a wait, not an incident");

  // At the same instant the five just asked sit inside their five-minute wait.
  // The two the limit never reached were never asked, so they are still due —
  // the bound is per pass, not a lock on the board.
  await reconcilePublications(core, backoff);
  assert.equal(probeCalls(), 7, "the next pass asks only the two the limit skipped");
  assert.deepEqual(
    probed().slice(5),
    SEVEN.slice(5),
    "and it does not re-ask any of the five it already asked",
  );
  assert.equal(inserts.length, 0, "still nothing proved, still nothing written");

  advance(5 * 60 * 1000);
  const before = probeCalls();
  await reconcilePublications(core, backoff);
  assert.equal(probeCalls() - before, 5, "five minutes later the pass probes five again");
  assert.deepEqual(
    probed().slice(7),
    SEVEN.slice(0, 5),
    "and the wait that expired first is the oldest cards', not the newest",
  );
}

// --- the pass also yields after ten seconds -------------------------------
// The count bounds how many cards a tick may ask; the budget bounds how long it
// may spend asking. A clock that jumps six seconds per read spends the budget
// before it can fill the count.

{
  const { core, probeCalls } = fakeCore({
    cards: SEVEN,
    pullRequest: OPEN,
    runGitIn: contentDiffers,
  });
  let tick = 1790000000000;
  core.now = () => {
    tick += 6000;
    return tick;
  };
  await reconcilePublications(core);
  assert.ok(probeCalls() >= 1, "the pass still asks the card it already admitted");
  assert.ok(
    probeCalls() <= 2,
    `a six-second clock keeps one pass inside the ten-second budget (probed ${probeCalls()} cards)`,
  );
}

// --- a landing still lands, and clears the card's wait --------------------

{
  const { core, inserts, warns } = fakeCore({ pullRequest: MERGED });
  const schedule = createProbeBackoff();
  const asked = [];
  const watched = {
    due: (cardId, at) => schedule.due(cardId, at),
    failed: (cardId, at) => {
      asked.push(`failed:${cardId}`);
      return schedule.failed(cardId, at);
    },
    succeeded: (cardId) => {
      asked.push(`succeeded:${cardId}`);
      schedule.succeeded(cardId);
    },
  };
  await reconcilePublications(core, watched);
  assert.equal(inserts.length, 1, "a bounded pass still records a merged pull request");
  assert.deepEqual(asked, ["succeeded:card_x"], "and it forgets the card instead of scheduling a wait");
  assert.equal(warns.length, 0, "a landing is not a failure");
}

// --- the schedule belongs to the reconciler, not to one pass ---------------
// A backoff created inside the pass would be created and discarded in the same
// tick, which is the outage this budget exists to remove.

{
  const { core, probeCalls } = fakeCore({ pullRequest: OPEN, runGitIn: contentDiffers });
  const { reconcilePublications: tick } = createPublicationReconcile(core);
  await tick();
  assert.equal(probeCalls(), 1, "the first tick asks about the card");
  await tick();
  assert.equal(probeCalls(), 1, "the second tick knows the card is waiting");
}

// --- the pass must not fail the reconcile ----------------------------------

{
  const { core } = fakeCore();
  core.discardEvidence = async () => {
    throw new Error("boom");
  };
  await reconcilePublications(core);
}

// --- the rule is shared with the gate, not restated ------------------------

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "server", "publication-reconcile.ts"), "utf8");
assert.match(source, /integrationProof/, "the proof is the shared one, not a local restatement");
assert.doesNotMatch(source, /unpushedCommits/, "\"no unpushed commits\" is not a proof and must not be read as one");
assert.match(
  source,
  /ORDER BY updated_at ASC/,
  "a capped pass reads oldest-first: with no order the five it takes could be the same five every tick",
);

console.log("publication-reconcile test ok: two proofs, nothing inferred, everything unproven left alone");
