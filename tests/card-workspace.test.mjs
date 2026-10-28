import assert from "node:assert/strict";
import test from "node:test";
import { defaultProjectSource, resolveCardWorkspacePath } from "../lib/card-workspace.mjs";

/**
 * A card whose work lives in a linked worktree must say so.
 *
 * This is the structural blocker behind the cards that sat at `audit` with
 * finished, merged work. `cardWorkspace` answered the project's default source
 * for every non-exploratory card, so a card whose worker wrote into a worktree
 * had `bb stelow verify --tests`, `scan` and `done` bound to the SHARED
 * checkout — a different directory, on a different branch, often holding
 * another thread's uncommitted work. The gates then refused with
 * "the last host-run test result belongs to a different checkout or HEAD", and
 * no card action could clear it.
 *
 * Asserted behaviorally: the rule is pure and the existence check is injected,
 * so each branch of the answer is a direct call.
 */

const projectSource = { path: "/repos/project", hostId: "host-1" };

test("a recorded linked worktree is the card's workspace", () => {
  const workspace = resolveCardWorkspacePath(
    { workspaceKind: "worktree", workspacePath: "/tmp/card-checkout", workspaceHostId: "host-1" },
    projectSource,
    () => true,
  );
  assert.deepEqual(workspace, { path: "/tmp/card-checkout", hostId: "host-1" });
});

test("a reclaimed worktree falls back to the project, as it did before", () => {
  const workspace = resolveCardWorkspacePath(
    { workspaceKind: "worktree", workspacePath: "/tmp/gone" },
    projectSource,
    () => false,
  );
  assert.deepEqual(
    workspace,
    { path: "/repos/project", hostId: "host-1" },
    "a missing directory is not a broken card",
  );
});

test("a project card works in the project", () => {
  const workspace = resolveCardWorkspacePath(
    { workspaceKind: "project" },
    projectSource,
    () => true,
  );
  assert.deepEqual(workspace, { path: "/repos/project", hostId: "host-1" });
});

test("a worktree card with no recorded path falls back to the project", () => {
  const workspace = resolveCardWorkspacePath({ workspaceKind: "worktree" }, projectSource, () => true);
  assert.deepEqual(workspace, { path: "/repos/project", hostId: "host-1" });
});

test("an exploratory card is its own workspace and never the project", () => {
  assert.deepEqual(
    resolveCardWorkspacePath(
      { workspaceKind: "exploratory", workspacePath: "/tmp/explore", workspaceHostId: "h" },
      projectSource,
      () => false,
    ),
    { path: "/tmp/explore", hostId: "h" },
    "exploratory keeps its directory even when the existence check says otherwise",
  );
  assert.equal(
    resolveCardWorkspacePath({ workspaceKind: "exploratory" }, projectSource, () => true),
    null,
    "and an exploratory card with no directory is UNKNOWN, not the project checkout",
  );
});

test("no source at all is null, not a guess", () => {
  assert.equal(resolveCardWorkspacePath({ workspaceKind: "project" }, null, () => true), null);
});

test("the project source prefers the one marked default", () => {
  const first = { path: "/repos/first", hostId: "a" };
  const preferred = { path: "/repos/preferred", hostId: "b", isDefault: true };
  assert.equal(defaultProjectSource({ sources: [first, preferred] }), preferred);
  assert.equal(defaultProjectSource({ sources: [first] }), first, "no default marker: the first source");
  assert.equal(defaultProjectSource({}), null);
  assert.equal(defaultProjectSource(null), null);
});

console.log(
  "card workspace ok: a linked worktree is the card's workspace, "
  + "a reclaimed one falls back, and exploratory never borrows the project",
);
