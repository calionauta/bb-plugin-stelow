import assert from "node:assert/strict";
import { reconcilePublications } from "../server/publication-reconcile.ts";

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

function fakeCore({
  cards = ["card_x"],
  events = {},
  pullRequest = OPEN,
  checkoutPath = "/work/wt",
  runGitIn = contentMatches,
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
    core: {
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
      getCard: (id) => ({ id, status: "completed", workspace_kind: "project" }),
      checkout: async () => ({ environmentId: "env_1" }),
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
  const { core, inserts } = fakeCore({ forgeThrows: true, runGitIn: contentDiffers });
  await reconcilePublications(core);
  assert.equal(inserts.length, 0, "an error is silence");
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

console.log("publication-reconcile test ok: two proofs, nothing inferred, everything unproven left alone");
