import assert from "node:assert/strict";
import { reconcilePublications } from "../server/publication-reconcile.ts";

// Publication reconcile: a pull request merged outside the panel writes no
// publication event, so the board keeps reporting work as owed after it landed.
// The reconcile asks the forge the one decisive question and records the answer.
//
// What it must never do is guess. Every case below that cannot be answered —
// no workspace, no pull request, a forge that will not answer — must leave the
// ledger alone, because a chip that says "No commit recorded" is honest and a
// chip that says "landed" on an inference is not.

const MERGED = {
  outcome: "available",
  pullRequest: { number: 251, title: "t", url: "https://example.test/pr/251", state: "merged" },
};
const OPEN = {
  outcome: "available",
  pullRequest: { number: 251, title: "t", url: "https://example.test/pr/251", state: "open" },
};

function fakeDeps({
  cards = ["card_x"],
  events = {},
  pullRequest = MERGED,
  checkout = { environmentId: "env_1" },
  forgeThrows = false,
} = {}) {
  const inserts = [];
  const db = {
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
  return {
    inserts,
    deps: {
      db,
      bb: {
        sdk: {
          environments: {
            pullRequest: async () => {
              if (forgeThrows) throw new Error("forge down");
              return pullRequest;
            },
          },
        },
      },
      now: () => 1790000000000,
      randomId: (prefix) => `${prefix}_test`,
      cardNotFound: "not found",
      cards: {
        get: (id) => ({ id, status: "completed", workspace_kind: "project" }),
        checkout: async () => checkout,
      },
      cardStatusOf: (value) => String(value),
    },
  };
}

// --- a merged pull request lands the card ---------------------------------

{
  const { deps, inserts } = fakeDeps();
  await reconcilePublications(deps);
  assert.equal(inserts.length, 1, "a merged PR records exactly one event");
  assert.equal(inserts[0][1], "card_x", "the event belongs to the card");
  assert.equal(inserts[0][2], "pull_request_merge", "the landing action is recorded");
  assert.equal(inserts[0][5], MERGED.pullRequest.url, "the PR url is recorded");
}

// --- idempotent: a card that already records the merge is skipped ----------

{
  const { deps, inserts } = fakeDeps({ events: { card_x: ["commit", "pull_request_merge"] } });
  await reconcilePublications(deps);
  assert.equal(inserts.length, 0, "a card already landed is not recorded twice");
}

// --- an open pull request has not landed -----------------------------------

{
  const { deps, inserts } = fakeDeps({ pullRequest: OPEN });
  await reconcilePublications(deps);
  assert.equal(inserts.length, 0, "ready is not merged");
}

// --- a forge that will not answer is not an answer -------------------------

{
  const { deps, inserts } = fakeDeps({ pullRequest: { outcome: "unavailable", message: "no" } });
  await reconcilePublications(deps);
  assert.equal(inserts.length, 0, "an unreadable status records nothing");
}

// --- a workspace that is gone proves nothing -------------------------------

{
  const { deps, inserts } = fakeDeps({ checkout: null });
  await reconcilePublications(deps);
  assert.equal(inserts.length, 0, "no workspace, no verdict");
}

// --- a forge error does not fail the reconcile -----------------------------

{
  const { deps, inserts } = fakeDeps({ forgeThrows: true });
  await reconcilePublications(deps);
  assert.equal(inserts.length, 0, "an error is silence, not a landing");
}

// --- the SQL the module runs ----------------------------------------------

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "server", "publication-reconcile.ts"), "utf8");
assert.match(source, /state !== "merged"/, "only a merged PR lands a card");
assert.match(source, /catch \{\s*\n\s*\/\/ A reconcile pass/, "the pass swallows its own failures");

console.log("publication-reconcile test ok: merged lands once, everything unproven stays unrecorded");
