import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { integrationPending, integrationPendingLabel } from "../lib/integration-pending.mjs";

// Integration-pending: a finished card that still owes the repository
// something must say so on the board, and a published one must stay silent.
//
// Every case here is a card shape that actually occurred on this repo, and
// each one is a regression this file exists to catch:
//
// - oqm8gyae  finished with its work uncommitted on a shared checkout
// - hh2nwqs4 finished after a local squash that never reached a remote
// - a card pushed to a branch nobody merged

const here = dirname(fileURLToPath(import.meta.url));

function fakeDb(actions) {
  return {
    prepare: () => ({
      all: () => actions.map((action) => ({ action })),
    }),
  };
}

const DONE_PROJECT = { id: "card_x", status: "completed", workspace_kind: "project" };

// --- a card that is not finished owes nothing yet -------------------------

assert.equal(
  integrationPending(fakeDb([]), { ...DONE_PROJECT, status: "in-progress" }),
  null,
  "a card still running has nothing to integrate",
);

// --- a card with no repository cannot owe one -----------------------------

assert.equal(
  integrationPending(fakeDb([]), { ...DONE_PROJECT, workspace_kind: "exploratory" }),
  null,
  "an exploratory workspace has no base branch, so integration is not a question",
);

// --- the hole this closes: done with nothing recorded ---------------------

const unpublished = integrationPending(fakeDb([]), DONE_PROJECT);
assert.ok(unpublished, "a finished project card with no publication event is pending");
assert.equal(unpublished.state, "unpublished");
assert.equal(integrationPendingLabel(DONE_PROJECT, unpublished), "Not committed");

// --- a local commit is not publication ------------------------------------
// card_oqm8gyae: committed, never pushed, no PR. The board must still say so.

const local = integrationPending(fakeDb(["commit"]), DONE_PROJECT);
assert.equal(local.state, "local", "a local commit is not a merge");
assert.equal(local.label, "Local commit only");

// --- a local squash is not publication either ----------------------------
// The panel offers squash_merge because it cannot fetch or push; treating it
// as landed is the bug this file pins.

const squashed = integrationPending(fakeDb(["commit", "squash_merge"]), DONE_PROJECT);
assert.equal(squashed.state, "local", "a LOCAL squash is not a merge");
assert.notEqual(squashed.label, null);

// --- pushed is not merged -------------------------------------------------

const pushed = integrationPending(fakeDb(["commit", "push_terminal"]), DONE_PROJECT);
assert.equal(pushed.state, "unmerged", "a pushed branch is still not the base branch");
assert.equal(pushed.label, "Pushed, not merged");

// --- a pull request that was never merged ---------------------------------

const opened = integrationPending(fakeDb(["commit", "pull_request_ready"]), DONE_PROJECT);
assert.equal(opened.state, "unmerged", "marking a PR ready does not merge it");
assert.equal(opened.label, "PR not merged");

const drafted = integrationPending(fakeDb(["pull_request_draft"]), DONE_PROJECT);
assert.equal(drafted.state, "unmerged", "a draft PR is not merged");

// --- the merged card is silent --------------------------------------------

assert.equal(
  integrationPending(fakeDb(["commit", "push_terminal", "pull_request_merge"]), DONE_PROJECT),
  null,
  "a merged card owes nothing and must not show a chip",
);
assert.equal(
  integrationPending(fakeDb(["pull_request_merge"]), DONE_PROJECT),
  null,
  "a merge alone is enough; the ledger is not a sequence to walk in order",
);

// merge last is the normal order, merge first must also clear it
assert.equal(
  integrationPending(fakeDb(["pull_request_merge", "commit"]), DONE_PROJECT),
  null,
  "a merge recorded before a later commit still counts as landed",
);

// --- the detail names the missing step ------------------------------------

for (const [actions, expected] of [
  [[], "uncommitted"],
  [["commit"], "pushed or merged"],
  [["commit", "push_terminal"], "no merge"],
]) {
  const result = integrationPending(fakeDb(actions), DONE_PROJECT);
  assert.match(result.detail, new RegExp(expected), `detail for ${JSON.stringify(actions)}`);
}

// --- the SQL the module actually runs -------------------------------------
// A card is filtered by id: a ledger shared across cards would report another
// card's merge as this card's.

const source = readFileSync(join(here, "..", "lib", "integration-pending.mjs"), "utf8");
assert.match(source, /FROM publication_events WHERE card_id = \?/, "must filter by card id");
assert.doesNotMatch(source, /\bgit\b\s+(status|rev-parse|fetch|push)/,
  "the board must never shell out to git to answer this");

console.log("integration-pending test ok: nothing owed, nothing shown; unsaved, local, pushed and unmerged all read as pending");
