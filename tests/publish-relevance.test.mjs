import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cardPublishesCode,
  publishActionsFor,
  publishRelevanceNote,
} from "../lib/publish-relevance.mjs";

// Publication relevance: the panel must not offer delivery machinery to a
// card whose deliverable is a finding.
//
// The card that started this — card_1fgz8lge — asked whether the
// interface-contrast skill shows a visual representation. It answered in prose,
// reached Done, and the panel offered it Commit, Push, Squash and Merge PR.
//
// A wrong answer here has two opposite costs. Hiding push from a bugfix whose
// fix is real work strands that fix on a local branch. Hiding nothing from an
// investigation is what already happened.

const here = dirname(fileURLToPath(import.meta.url));

// --- a bugfix gets everything ---------------------------------------------

const bugfix = publishActionsFor("build", "bugfix");
for (const action of ["commit", "squash", "push", "sync", "pr"]) {
  assert.ok(bugfix.has(action), `a bugfix can ${action}`);
}
assert.equal(cardPublishesCode("build", "bugfix"), true);
assert.equal(publishRelevanceNote("build", "bugfix"), null,
  "a card that can deliver needs no explanation of why it cannot");

// --- an investigation gets a commit and nothing else -----------------------

const investigate = publishActionsFor("build", "investigate");
assert.ok(investigate.has("commit"),
  "a finding often comes with the fix that came out of it");
for (const action of ["squash", "push", "sync", "pr"]) {
  assert.ok(!investigate.has(action),
    `an investigation must not be offered ${action} — this is the regression`);
}
assert.equal(cardPublishesCode("build", "investigate"), false);

// --- the read-only tracks never publish code ------------------------------
// Research and explore produce documents. Their deliverable is not a change.

for (const kind of ["research", "explore"]) {
  assert.equal(cardPublishesCode(kind, "bugfix"), false,
    `${kind} is a read-only track even when the intent is a bugfix`);
  const actions = publishActionsFor(kind, "bugfix");
  assert.ok(actions.has("commit"), `${kind} can still commit files it wrote`);
  assert.ok(!actions.has("pr"), `${kind} never gets a pull request`);
}

// --- a card that publishes is told nothing; one that cannot, is told why ----

const note = publishRelevanceNote("build", "investigate");
assert.match(note, /investigation/i, "the note names what the card is");
assert.match(note, /finding/i, "the note names what it delivered");

const researchNote = publishRelevanceNote("research", "investigate");
assert.match(researchNote, /Research/, "the note names the track");
assert.doesNotMatch(researchNote, /investigation/i,
  "a research card is not told it is an investigation — that is the build track's word");

// --- the rule is one place, and it reads the stored fields -----------------
// If this ever re-derives kind or intent from anything else, two surfaces will
// disagree about the same card.

const source = readFileSync(join(here, "..", "lib", "publish-relevance.mjs"), "utf8");
assert.match(source, /if \(kind !== "build"\) return false;/,
  "only a build card can change the repository, and that test comes first");

console.log("publish relevance test ok: a bugfix delivers, an investigation commits, a finding never merges");
