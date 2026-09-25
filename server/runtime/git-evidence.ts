/**
 * Git and host-command evidence.
 *
 * Every surface that reports "what does this workspace look like right now"
 * — card detail staleness, the verify judges, the diff RPC, the working-tree
 * evidence snapshot, discard eligibility — reads the same commands through
 * this module, so the answers cannot disagree about HEAD, dirty files, or
 * which test command a checkout runs.
 *
 * Every read is fail-soft. A non-Git workspace or a git error reads as "no
 * evidence", never as an error, because these surfaces report and the caller
 * names the fix; the only exception is a worktree drop, which must fail
 * loudly or a stale checkout would leak.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join as nodeJoin } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { detectedTestCommand } from "../../lib/audit-verification.mjs";
import type { WorkerCard } from "../workers-types.js";
import { createDiscardEvidence } from "./discard-evidence.js";

export type RecoveryGitEvidence = {
  isGit: boolean;
  gitRoot: string | null;
  branch: string | null;
  headSha: string | null;
  changedFiles: number;
};

export type DetectedTestCommand = {
  command: string;
  args: string[];
  display: string;
};

// Stelow's own machinery never makes a plan stale: filter it from the
// touched-paths a staleness notice names.
const STALENESS_NOISE_PREFIXES = [
  "skills/",
  "data/",
  ".stelow/",
  "stelow.json",
];

export type GitEvidenceDeps = {
  bb: BbPluginApi;
  db: ReturnType<BbPluginApi["storage"]["database"]>;
  cardWorkspace: (card: WorkerCard) => Promise<{ path: string; hostId: string | null } | null>;
};

/** Run a git command in a directory; failures read as an empty stdout. */
function runGitIn(
  cwd: string,
  args: string[],
  maxBuffer = 1024 * 1024,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((done) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 15_000, maxBuffer },
      (error, stdout) => {
        done({
          ok: !error,
          stdout: typeof stdout === "string" ? stdout : "",
        });
      },
    );
  });
}

/** Remove a card's linked worktree and the branch it carried. */
async function dropLinkedWorktree(
  runGit: typeof runGitIn,
  checkoutPath: string,
  branch: string,
): Promise<void> {
  const common = await runGit(checkoutPath, [
    "rev-parse",
    "--git-common-dir",
  ]);
  const mainDir = common.ok ? common.stdout.trim() : "";
  const mainPath = mainDir
    ? isAbsolute(mainDir)
      ? mainDir
      : nodeJoin(checkoutPath, mainDir)
    : "";
  if (!mainPath) throw new Error("Cannot locate the main checkout.");
  await runGit(mainPath, ["worktree", "unlock", checkoutPath]);
  const removed = await runGit(mainPath, [
    "worktree",
    "remove",
    "--force",
    checkoutPath,
  ]);
  if (!removed.ok) throw new Error("Could not remove the worktree.");
  const pruned = await runGit(mainPath, ["branch", "-D", branch]);
  if (!pruned.ok) throw new Error("Worktree removed, but the branch survived.");
  if (existsSync(checkoutPath)) {
    throw new Error("The worktree folder survived removal.");
  }
}

/** What git can say about a path: root, branch, HEAD, dirty file count. */
async function recoveryGitEvidence(
  runGit: typeof runGitIn,
  path: string,
): Promise<RecoveryGitEvidence> {
  const root = await runGit(path, ["rev-parse", "--show-toplevel"]);
  if (!root.ok || !root.stdout.trim()) {
    return {
      isGit: false,
      gitRoot: null,
      branch: null,
      headSha: null,
      changedFiles: 0,
    };
  }
  const [branch, head, status] = await Promise.all([
    runGit(path, ["branch", "--show-current"]),
    runGit(path, ["rev-parse", "HEAD"]),
    runGit(path, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  return {
    isGit: true,
    gitRoot: root.stdout.trim(),
    branch: branch.ok ? branch.stdout.trim() || null : null,
    headSha: head.ok ? head.stdout.trim() || null : null,
    changedFiles: status.ok
      ? status.stdout.split("\n").filter(Boolean).length
      : 0,
  };
}

/**
 * Files a checkout gained since an ask-time HEAD: what the human needs to
 * judge whether a waiting question's plan still matches the code.
 * Fail-soft — staleness is advisory, and an unreadable history must never
 * break cardDetail.
 */
async function gitTouchedSince(
  runGit: typeof runGitIn,
  gitRoot: string,
  fromHead: string,
): Promise<{ commitCount: number; paths: string[] }> {
  const empty = { commitCount: 0, paths: [] as string[] };
  try {
    const [count, log] = await Promise.all([
      runGit(gitRoot, ["rev-list", "--count", `${fromHead}..HEAD`]),
      runGit(
        gitRoot,
        ["log", "--name-only", "--pretty=format:", `${fromHead}..HEAD`, "--"],
        4 * 1024 * 1024,
      ),
    ]);
    if (!count.ok || !log.ok) return empty;
    const seen = new Set<string>();
    for (const line of log.stdout.split("\n")) {
      const path = line.trim();
      if (!path || seen.has(path) || isStelowNoise(path)) continue;
      seen.add(path);
    }
    return {
      commitCount: Number(count.stdout.trim()) || 0,
      paths: [...seen].slice(0, 6),
    };
  } catch {
    return empty;
  }
}

/** Stelow's own files never count as "the user changed the plan". */
function isStelowNoise(path: string): boolean {
  return STALENESS_NOISE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
}

/** Digest a host file, or null when it cannot be read. */
async function sha256OfHostFile(
  bb: BbPluginApi,
  path: string,
): Promise<string | null> {
  try {
    const file = (await bb.sdk.files.read({ path }).catch(() => null)) as {
      content?: unknown;
    } | null;
    if (!file || typeof file.content !== "string") return null;
    return createHash("sha256").update(file.content, "utf8").digest("hex");
  } catch {
    return null;
  }
}

/**
 * The checkout's safe conventional test command, detected from its own repo
 * markers. Null means "no command this host can run", and the caller says so
 * instead of inventing one.
 */
function testCommandForCheckout(path: string): DetectedTestCommand | null {
  try {
    const entries = readdirSync(path);
    const packageJson = entries.includes("package.json")
      ? JSON.parse(readFileSync(nodeJoin(path, "package.json"), "utf8"))
      : null;
    return detectedTestCommand(entries, packageJson);
  } catch {
    return null;
  }
}

/** Run a host test command, reporting its exit code and combined output. */
function runHostTests(
  path: string,
  command: DetectedTestCommand,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((done) => {
    execFile(
      command.command,
      command.args,
      { cwd: path, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        const output =
          `${typeof stdout === "string" ? stdout : ""}${typeof stderr === "string" ? `\n${stderr}` : ""}`.trim();
        done({ exitCode: code, output });
      },
    );
  });
}

/**
 * Working-tree patch text for the advisory verify-* judges: raw evidence to
 * judge against, capped by the caller's own budget. Fail-soft for the same
 * reason as every other read here.
 */
function workingDiffFor(
  workspacePath: string,
  cap: number,
): Promise<string> {
  return new Promise((resolveDiff) => {
    execFile(
      "git",
      ["diff", "HEAD", "--no-color", "--unified=1", "--", "."],
      { cwd: workspacePath, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        resolveDiff(
          !error && typeof stdout === "string" ? stdout.slice(0, cap) : "",
        );
      },
    );
  });
}

export function createGitEvidence(deps: GitEvidenceDeps) {
  return {
    runGitIn,
    workingDiffFor,
    testCommandForCheckout,
    runHostTests,
    sha256OfHostFile: (path: string) => sha256OfHostFile(deps.bb, path),
    dropLinkedWorktree: (checkoutPath: string, branch: string) =>
      dropLinkedWorktree(runGitIn, checkoutPath, branch),
    recoveryGitEvidence: (path: string) =>
      recoveryGitEvidence(runGitIn, path),
    gitTouchedSince: (gitRoot: string, fromHead: string) =>
      gitTouchedSince(runGitIn, gitRoot, fromHead),
    discardEvidence: createDiscardEvidence({
      db: deps.db,
      cardWorkspace: deps.cardWorkspace,
      runGitIn,
    }),
  };
}

export type GitEvidence = ReturnType<typeof createGitEvidence>;
