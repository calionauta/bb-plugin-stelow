import assert from "node:assert/strict";
import test from "node:test";
import { recordedWorkspace } from "../lib/worker-workspace.mjs";

/**
 * A worker that got a checkout of its own must have it recorded.
 *
 * A card on a `new-worktree` preset works in a managed checkout, and every gate
 * that matters — the host test run, the security scan, `done` — binds to the
 * card's workspace. Nothing recorded the path, so `cardWorkspace` answered the
 * project's SHARED source, which holds a different branch and usually another
 * thread's uncommitted work. The gates then refused with "the last host-run test
 * result belongs to a different checkout or HEAD", a sentence that names the
 * symptom and no action that clears it — which is why finished, merged cards sat
 * at `audit`.
 *
 * The rule is deliberately conservative: a wrong `workspace_path` is worse than
 * none, because every gate would bind to a directory that does not hold the work.
 */

test("a managed checkout that differs from the project is recorded", () => {
  assert.deepEqual(
    recordedWorkspace("/home/deploy/.bb/worktrees/thr_1/plugin", "/home/deploy/repos/plugin"),
    { workspaceKind: "worktree", workspacePath: "/home/deploy/.bb/worktrees/thr_1/plugin" },
  );
});

test("an environment that IS the project writes nothing", () => {
  assert.equal(
    recordedWorkspace("/home/deploy/repos/plugin", "/home/deploy/repos/plugin"),
    null,
    "a project-default spawn is not a linked worktree",
  );
  assert.equal(
    recordedWorkspace("/home/deploy/repos/plugin/", "/home/deploy/repos/plugin"),
    null,
    "a trailing slash is the same directory",
  );
});

test("an unknown path on either side writes nothing", () => {
  for (const [environment, project] of [
    [null, "/home/deploy/repos/plugin"],
    ["/tmp/x", null],
    ["", "/home/deploy/repos/plugin"],
    [undefined, undefined],
    [42, "/home/deploy/repos/plugin"],
  ]) {
    assert.equal(
      recordedWorkspace(environment, project),
      null,
      `unknown paths are not a guess: ${JSON.stringify([environment, project])}`,
    );
  }
});

console.log(
  "worker workspace ok: a different checkout is recorded, the project itself is not, "
  + "and an unknown path is never guessed",
);
