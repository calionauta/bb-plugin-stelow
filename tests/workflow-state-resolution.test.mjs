/**
 * The three answers a state-directory lookup can give.
 *
 * `workflowStateDir` collapses all of them to null, which is right for a
 * caller that only wants a path and wrong for a caller that has to name a
 * reason: "the ownership records disagree" is a verdict about a card, and
 * "the host did not answer" is a transport failure that says nothing about
 * one. Every read here crosses the host, so the second answer happens in
 * production whenever the daemon's event loop stalls — it is not a rare
 * branch, and it must not read as a reseed instruction.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  completionRoot,
  resolveWorkflowStateDir,
  stateRootOf,
  workflowStateDir,
} from "../server/runtime/workflow-state.ts";

const ROOT = "/project";
const STATE_DIR = "/project/.stelow/2026-09-30/sw-card_1";

function tracking(workflows) {
  return JSON.stringify({ workflows });
}

function entry(overrides = {}) {
  return {
    workflowId: "card_1",
    dirHash: "sw-card_1",
    created: "2026-09-30T00:35:10.160Z",
    cwd: ROOT,
    ...overrides,
  };
}

/** A host whose files answer from a map, and throw for anything absent. */
function host(files, { fail = new Set() } = {}) {
  return {
    sdk: {
      files: {
        read: async ({ path }) => {
          if (fail.has(path)) throw new Error("host timed out");
          if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return { content: files[path] };
        },
      },
    },
  };
}

const HAPPY = {
  [`${ROOT}/stelow.json`]: tracking([entry()]),
  [`${STATE_DIR}/state.md`]: "workflow_id: card_1\ncurrent_stage: audit\n",
};

test("a card whose records agree resolves with the blob already read", async () => {
  const bb = host(HAPPY);
  assert.deepEqual(
    await resolveWorkflowStateDir(bb, ROOT, "card_1", "sw-card_1"),
    { kind: "resolved", path: STATE_DIR, state: HAPPY[`${STATE_DIR}/state.md`] },
  );
  assert.equal(await workflowStateDir(bb, ROOT, "card_1", "sw-card_1"), STATE_DIR);
});

test("records that disagree are a verdict, and the path half still refuses", async () => {
  const noEntry = host({ ...HAPPY, [`${ROOT}/stelow.json`]: tracking([entry({ workflowId: "card_other" })]) });
  assert.deepEqual(
    await resolveWorkflowStateDir(noEntry, ROOT, "card_1", "sw-card_1"),
    { kind: "unowned" },
    "another card's entry is not this card's state",
  );
  assert.equal(await workflowStateDir(noEntry, ROOT, "card_1", "sw-card_1"), null);

  const foreignState = host({
    ...HAPPY,
    [`${STATE_DIR}/state.md`]: "workflow_id: card_other\ncurrent_stage: audit\n",
  });
  assert.deepEqual(
    await resolveWorkflowStateDir(foreignState, ROOT, "card_1", "sw-card_1"),
    { kind: "unowned" },
    "a state file naming a different owner is never trusted, by name match alone",
  );
});

test("a host that would not answer is unreadable, never unowned", async () => {
  const trackingPath = `${ROOT}/stelow.json`;
  const statePath = `${STATE_DIR}/state.md`;
  for (const path of [trackingPath, statePath]) {
    const bb = host(HAPPY, { fail: new Set([path]) });
    assert.deepEqual(
      await resolveWorkflowStateDir(bb, ROOT, "card_1", "sw-card_1"),
      { kind: "unreadable" },
      `${path} timing out is a transport failure, not a lost owner`,
    );
    assert.equal(await workflowStateDir(bb, ROOT, "card_1", "sw-card_1"), null);
  }
});

test("a tracking file that is not a tracking file is unreadable, not a verdict", async () => {
  for (const content of ["{ truncated", "[]", '"card_1"', "null"]) {
    const bb = host({ ...HAPPY, [`${ROOT}/stelow.json`]: content });
    assert.deepEqual(
      await resolveWorkflowStateDir(bb, ROOT, "card_1", "sw-card_1"),
      { kind: "unreadable" },
      `${JSON.stringify(content)} records nothing, so nothing is proven`,
    );
  }
});

test("a card with no dirHash and no project state file is unreadable too", async () => {
  // The seeded/human path reads the project root directly. There is no
  // ownership record to disagree with, so a missing file is simply no answer.
  const bb = host({});
  const resolution = await resolveWorkflowStateDir(bb, ROOT, "seed_1", "sw-seed_1");
  assert.deepEqual(resolution, { kind: "unreadable" });
});

test("the helper runs in the checkout that holds the state directory", () => {
  assert.equal(stateRootOf(`${ROOT}/.stelow/2026-09-30/sw-card_1`), ROOT);
  assert.equal(stateRootOf(null), null);
  assert.equal(stateRootOf(`${ROOT}/state.md`), null);
});

test("completion binds to the checkout holding the state, not the spawn point", async () => {
  const card = { id: "card_1", dir_hash: "sw-card_1" };
  const deps = {
    cardWorkspace: async () => ({ path: ROOT, hostId: "host1" }),
    workflowStateDir: async () => `${ROOT}/.stelow/2026-09-30/sw-card_1`,
    cardCheckout: async () => ({ path: "/elsewhere/worktree" }),
  };
  assert.equal(
    await completionRoot(deps, card),
    ROOT,
    "a project state with a worktree checkout still verifies at the project",
  );

  const noState = {
    ...deps,
    workflowStateDir: async () => null,
  };
  assert.equal(
    await completionRoot(noState, card),
    "/elsewhere/worktree",
    "without a resolvable state the managed checkout decides, as before",
  );

  const neither = {
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    cardCheckout: async () => null,
  };
  assert.equal(
    await completionRoot(neither, card),
    null,
    "with neither state nor checkout there is no root to bind",
  );
});
