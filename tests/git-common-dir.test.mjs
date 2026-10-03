/**
 * `--git-common-dir` is the repository identity the audit gate compares, so the
 * sampler that produces it must be right on both shapes git answers with.
 *
 * Git resolves the flag against the directory it was invoked in, not against
 * the path asked about: a project checkout answers `.git`, a linked worktree
 * answers an **absolute** path to the same place. `path.join` does not reset on
 * an absolute second argument — it concatenates — so joining unconditionally
 * turns the worktree answer into `<checkout>/home/deploy/...`, which does not
 * exist and takes `done` down with an ENOENT.
 *
 * This test exists because the first version of that fix was validated only
 * against a helper written with the same wrong assumption, and both agreed with
 * each other while production disagreed with the host. It calls the real
 * sampler, on real repositories, and asserts the value the gate consumes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { createGitEvidence } from "../server/runtime/git-evidence.ts";
import { snapshotRepository } from "../server/runtime/card-audit-trail.ts";

/** The factory only stores these; nothing here touches a database or a card. */
const sampler = createGitEvidence({
  bb: {},
  db: {},
  cardWorkspace: async () => null,
}).recoveryGitEvidence;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepo(tag) {
  const base = mkdtempSync(join(tmpdir(), `stelow-common-${tag}-`));
  const project = join(base, "project");
  execFileSync("git", ["init", "-q", project], { encoding: "utf8" });
  git(["config", "user.email", "t@example.com"], project);
  git(["config", "user.name", "Test"], project);
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "base"], {
    cwd: project,
    encoding: "utf8",
  });
  const worktree = join(base, "worktree");
  git(["worktree", "add", "-q", "-b", `wt-${tag}`, worktree], project);
  return { base, project, worktree };
}

test("the sampler reads a worktree's common dir as an existing path", async () => {
  const { base, project, worktree } = makeRepo("shape");
  try {
    const inProject = await sampler(project);
    const inWorktree = await sampler(worktree);

    assert.equal(inProject.isGit, true);
    assert.equal(inWorktree.isGit, true);

    // The bug's signature: the absolute answer joined onto the checkout.
    assert.ok(
      !inWorktree.commonDir.includes(`${worktree}${join("/")}home`),
      `commonDir was joined onto the checkout: ${inWorktree.commonDir}`,
    );
    assert.ok(
      existsSync(inWorktree.commonDir),
      `commonDir does not exist on disk: ${inWorktree.commonDir}`,
    );
    assert.ok(
      isAbsolute(inWorktree.commonDir),
      `commonDir must be absolute, got ${inWorktree.commonDir}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a checkout and its worktree share one repository identity", async () => {
  const { base, project, worktree } = makeRepo("identity");
  try {
    const inProject = await sampler(project);
    const inWorktree = await sampler(worktree);

    assert.notEqual(project, worktree, "the two directories differ");
    assert.equal(
      inWorktree.commonDir,
      inProject.commonDir,
      "one repository must answer one identity from either directory",
    );
    // Both shapes normalize to the same real path.
    assert.equal(inWorktree.commonDir, realpathSync(inProject.commonDir));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("unrelated repositories do not share an identity", async () => {
  const { base, project } = makeRepo("unrelated");
  try {
    const other = join(base, "other");
    execFileSync("git", ["init", "-q", other], { encoding: "utf8" });
    git(["config", "user.email", "t@example.com"], other);
    git(["config", "user.name", "Test"], other);
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "b"], {
      cwd: other,
      encoding: "utf8",
    });

    const inProject = await sampler(project);
    const inOther = await sampler(other);
    assert.notEqual(inProject.commonDir, inOther.commonDir);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a successful trail resolves to the common dir of the root it names", async () => {
  const { base, project } = makeRepo("snapshot");
  try {
    const expected = (await sampler(project)).commonDir;
    const run = {
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        contract: "v3",
        path: `${project}/.stelow/x/audit-trail.md`,
        artifacts: 0,
        snapshot: { root: project, head: "a".repeat(40) },
      }),
      stderr: "",
    };
    const deps = {
      runHelper: async () => run,
      gitEvidence: async (path) => sampler(path).then(({ commonDir }) => ({ commonDir })),
    };
    assert.equal(await snapshotRepository(deps, run), expected);
    assert.equal(await snapshotRepository(deps, { ...run, code: 1 }), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});