/**
 * The completion gate must attest a repository, not a directory.
 *
 * A card whose worker works in a managed git worktree has its audit trail
 * built there and its state read from the project checkout. Those are two
 * directories of one repository, so a path comparison refused the trail and a
 * card could never reach Done — PR #274 moved that refusal rather than fixing
 * it. `--git-common-dir` is the repository identity both directories share.
 *
 * These tests fail against the path comparison and pass against the identity
 * comparison, which is the only way to know the guard is real.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  auditTrailGate,
  AUDIT_TRAIL_CONTRACT,
} from "../lib/audit-trail-contract.mjs";

const HEAD = "a".repeat(40);

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * The repository identity exactly as the sampler computes it.
 *
 * Git answers `--git-common-dir` relative to the directory it ran in — `.git`
 * in the project checkout, an absolute path in one of its worktrees — so a
 * correct comparison has to resolve and normalize, or the same repository looks
 * like two. Mirroring that here keeps the test honest about the shape the gate
 * actually receives.
 */
function repositoryIdentity(cwd) {
  const dir = git(["rev-parse", "--git-common-dir"], cwd);
  return realpathSync(isAbsolute(dir) ? dir : join(cwd, dir));
}

/** A real repo plus a real linked worktree of it, on disk. */
function makeRepoWithWorktree() {
  const base = mkdtempSync(join(tmpdir(), "stelow-audit-identity-"));
  const project = join(base, "project");
  execFileSync("git", ["init", "-q", project], { encoding: "utf8" });
  git(["config", "user.email", "t@example.com"], project);
  git(["config", "user.name", "Test"], project);
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "base"], {
    cwd: project,
    encoding: "utf8",
  });
  const branch = `wt-${base.split("/").pop()}`;
  const worktree = join(base, "worktree");
  git(["worktree", "add", "-q", "-b", branch, worktree], project);
  return { base, project, worktree };
}

/** A second, unrelated repository. */
function makeOtherRepo(base) {
  const other = join(base, "other");
  execFileSync("git", ["init", "-q", other], { encoding: "utf8" });
  git(["config", "user.email", "t@example.com"], other);
  git(["config", "user.name", "Test"], other);
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "base"], {
    cwd: other,
    encoding: "utf8",
  });
  return other;
}

/** A verified run whose trail attests `root` / optional `commonDir`. */
function run({ root, commonDir, head = HEAD }) {
  const snapshot = { root, head, tracked: "t", untracked: "u", untracked_count: 0 };
  if (commonDir) snapshot.commonDir = commonDir;
  return {
    code: 0,
    stdout: JSON.stringify({
      ok: true,
      contract: AUDIT_TRAIL_CONTRACT,
      path: `${root}/.stelow/x/audit-trail.md`,
      artifacts: 2,
      snapshot,
    }),
    stderr: "",
  };
}

test("a worktree trail attests the same repository as its project checkout", () => {
  const { base, project, worktree } = makeRepoWithWorktree();
  try {
    const projectCommon = repositoryIdentity(project);
    const worktreeCommon = repositoryIdentity(worktree);
    assert.notEqual(project, worktree, "the two directories differ, which is the bug's premise");
    assert.equal(projectCommon, worktreeCommon, "one repository, one identity");

    const verifiedGit = {
      gitRoot: project,
      commonDir: projectCommon,
      branch: "main",
      headSha: HEAD,
    };

    // The trail was built in the worktree: a different root, the same repository.
    const verdict = auditTrailGate({
      build: run({ root: worktree, commonDir: worktreeCommon }),
      check: run({ root: worktree, commonDir: worktreeCommon }),
      verifiedGit,
    });
    assert.equal(
      verdict.ready,
      true,
      "a card working in a worktree must be able to reach Done",
    );
    assert.equal(verdict.trailer.commonDir, projectCommon);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("two unrelated repositories still refuse, identical paths or not", () => {
  const { base, project } = makeRepoWithWorktree();
  try {
    const other = makeOtherRepo(base);
    const projectCommon = repositoryIdentity(project);
    const otherCommon = repositoryIdentity(other);
    const head = git(["rev-parse", "HEAD"], project);

    const verdict = auditTrailGate({
      build: run({ root: other, commonDir: otherCommon, head }),
      check: run({ root: other, commonDir: otherCommon, head }),
      verifiedGit: { gitRoot: project, commonDir: projectCommon, headSha: head },
    });
    assert.equal(verdict.ready, false, "a different repository must block completion");
    assert.match(verdict.error, /different checkout|repository at/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("HEAD still decides when the repository is the same", () => {
  const { base, project, worktree } = makeRepoWithWorktree();
  try {
    const common = repositoryIdentity(project);
    const verdict = auditTrailGate({
      build: run({ root: worktree, commonDir: common }),
      check: run({ root: worktree, commonDir: common }),
      verifiedGit: { gitRoot: project, commonDir: common, headSha: "b".repeat(40) },
    });
    assert.equal(verdict.ready, false, "one repository is not one commit");
    assert.match(verdict.error, /HEAD/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("without repository identity the path comparison still decides", () => {
  const { base, project } = makeRepoWithWorktree();
  try {
    // An older helper emits no commonDir: the gate stays strict on paths.
    const samePath = auditTrailGate({
      build: run({ root: project }),
      check: run({ root: project }),
      verifiedGit: { gitRoot: project, commonDir: null, headSha: HEAD },
    });
    assert.equal(samePath.ready, true, "identical paths with no identity still complete");

    const movedPath = auditTrailGate({
      build: run({ root: "/elsewhere" }),
      check: run({ root: "/elsewhere" }),
      verifiedGit: { gitRoot: project, commonDir: null, headSha: HEAD },
    });
    assert.equal(movedPath.ready, false, "no identity means the path comparison is the only evidence");
    assert.match(movedPath.error, /different checkout|repository at/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});