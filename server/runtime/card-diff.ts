import type { execFile } from "node:child_process";
import { resolveArtifactPath } from "../../lib/artifact-manifest.mjs";
import { summarizeCymbalChanged } from "../../lib/cymbal-changed.mjs";
import { splitDiffByFile, MAX_DIFF_FILES } from "../../lib/diff-split.mjs";
import { summarizeSemDiff } from "../../lib/sem-summary.mjs";
import type { WorkerCard } from "../workers-types.js";

type ExecFile = typeof execFile;
type Checkout = { path: string; hostId: string | null } | null;
type DiffFile = {
  path: string;
  display: string;
  patch: string | null;
  isNew: boolean;
  absolutePath: string;
  hostId: string;
};
type GitResult = { ok: boolean; stdout: string };
type DiffDeps = {
  execFile: ExecFile;
  getCard: (cardId: string) => WorkerCard | undefined;
  cardCheckout: (card: WorkerCard) => Promise<Checkout>;
  recoveredIntegrity: (card: WorkerCard, path: string) => Promise<string | null>;
  resolveLocalBin: (name: string) => string;
  errors: { cardNotFound: string; workspaceUnavailable: string };
};

export function createCardDiff(deps: DiffDeps) {
  return ({ cardId }: { cardId: string }) => cardDiff(deps, cardId);
}

async function cardDiff(deps: DiffDeps, cardId: string) {
  const card = deps.getCard(cardId);
  if (!card) return emptyDiff(deps.errors.cardNotFound);
  const checkout = await deps.cardCheckout(card).catch(() => null);
  if (!checkout?.path) return emptyDiff(deps.errors.workspaceUnavailable);
  const recoveryError = await deps.recoveredIntegrity(card, checkout.path);
  if (recoveryError) return { ...emptyDiff(recoveryError), found: true };
  const runGit = gitRunner(deps.execFile, checkout.path);
  const top = await runGit(["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) return emptyDiff("Not a git repository.", true);
  const root = top.stdout.trim();
  const files = await collectFiles(deps.execFile, root, checkout.hostId ?? "");
  const entitySummary = await optionalSummary(
    deps.execFile,
    deps.resolveLocalBin("sem"),
    ["diff", "-C", root, "HEAD", "--format", "json", "--color", "never"],
    summarizeSemDiff,
    null,
  );
  const changedSymbols = await optionalSummary(
    deps.execFile,
    deps.resolveLocalBin("cymbal"),
    ["changed", "--base", "HEAD", "--json", "--max-symbols", "20", "--max-impact", "100"],
    summarizeCymbalChanged,
    null,
    root,
  );
  return {
    found: true,
    isRepo: true,
    files: files.entries,
    truncated: files.truncated,
    entitySummary,
    changedSymbols,
    error: null,
  };
}

function emptyDiff(error: string, found = false) {
  return {
    found,
    isRepo: false,
    files: [] as DiffFile[],
    truncated: false,
    entitySummary: null as ReturnType<typeof summarizeSemDiff>,
    changedSymbols: null as ReturnType<typeof summarizeCymbalChanged>,
    error,
  };
}

function gitRunner(exec: ExecFile, defaultCwd: string) {
  return (args: string[], cwd = defaultCwd): Promise<GitResult> =>
    new Promise((resolve) => {
      exec(
        "git",
        args,
        { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => resolve({
          ok: !error,
          stdout: typeof stdout === "string" ? stdout : "",
        }),
      );
    });
}

async function collectFiles(
  exec: ExecFile,
  root: string,
  hostId: string,
): Promise<{ entries: DiffFile[]; truncated: boolean }> {
  const runGit = gitRunner(exec, root);
  const diff = await runGit(
    ["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=3", "--"],
    root,
  );
  const split = diff.ok && diff.stdout.trim() ? splitDiffByFile(diff.stdout) : null;
  const entries = (split?.files ?? []).flatMap((entry) => {
    const absolutePath = resolveArtifactPath(root, entry.path);
    return absolutePath ? [trackedFile(entry.path, entry.patch, absolutePath, hostId)] : [];
  });
  if (entries.length >= MAX_DIFF_FILES) {
    return { entries, truncated: true };
  }
  const status = await runGit(statusArgs());
  const untracked = status.ok
    ? untrackedFiles(status.stdout, root, hostId)
    : [];
  const combined = entries.concat(untracked);
  return {
    entries: combined.slice(0, MAX_DIFF_FILES),
    truncated: Boolean(split?.truncated) || combined.length > MAX_DIFF_FILES,
  };
}

function trackedFile(
  path: string,
  patch: string,
  absolutePath: string,
  hostId: string,
): DiffFile {
  return {
    path,
    display: path.split("/").pop() || path,
    patch,
    isNew: false,
    absolutePath,
    hostId,
  };
}

function statusArgs(): string[] {
  return [
    "-c",
    "core.quotepath=false",
    "-c",
    "status.relativePaths=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ];
}

function untrackedFiles(status: string, root: string, hostId: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of status.split("\0")) {
    if (files.length >= MAX_DIFF_FILES) break;
    const relativePath = untrackedPath(line);
    if (!relativePath) continue;
    const absolutePath = resolveArtifactPath(root, relativePath);
    if (!absolutePath || files.some((file) => file.path === relativePath)) continue;
    files.push({
      path: relativePath,
      display: relativePath.split("/").pop() || relativePath,
      patch: null,
      isNew: true,
      absolutePath,
      hostId,
    });
  }
  return files;
}

function untrackedPath(line: string): string | null {
  const match = /^\?\? (.+)$/.exec(line);
  if (!match) return null;
  const raw = match[1]!.trim().replace(/^\.\//, "");
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw || null;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.slice(1, -1) || null;
  }
}

async function optionalSummary<T>(
  exec: ExecFile,
  binary: string,
  args: string[],
  parse: (value: unknown) => T,
  fallback: T,
  cwd?: string,
): Promise<T> {
  const output = await commandOutput(exec, binary, args, cwd);
  if (!output) return fallback;
  try {
    return parse(JSON.parse(output));
  } catch {
    return fallback;
  }
}

function commandOutput(
  exec: ExecFile,
  binary: string,
  args: string[],
  cwd?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    exec(
      binary,
      args,
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(!error && typeof stdout === "string" ? stdout : null),
    );
  });
}
