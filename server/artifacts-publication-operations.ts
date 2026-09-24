import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  buildSquashScript,
  parseSquashOutput,
  squashExitMessage,
} from "../lib/squash-merge.mjs";

const PUSH_COMMAND = 'git push; echo "STELOW_PUSH_EXIT:$?"';
const SYNC_COMMAND = [
  "git pull --rebase",
  'echo "STELOW_SYNC_EXIT:$?"',
  "if git rev-parse --verify REBASE_HEAD >/dev/null 2>&1; then",
  "  git rebase --abort",
  '  echo "STELOW_SYNC_ABORTED:1"',
  "fi",
  "git push",
  'echo "STELOW_PUSH_EXIT:$?"',
].join("; ");
import type { ArtifactsPublicationDeps } from "./artifacts-publication.js";
import {
  preparedEnvironment,
  publicationSnapshot,
  recordPublication,
  unavailablePublication,
} from "./artifacts-publication-status.js";
import {
  createPublicationShell,
  livePushShell,
  pushTerminalSnapshot,
  retirePushShells,
  sendShellCommand,
} from "./artifacts-publication-terminals.js";

type CommitDiffFile = {
  path: string;
  display: string;
  patch: string | null;
  binary: boolean;
  changeKind: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  loadMode: string;
};

type CommitDiff = {
  found: boolean;
  commitSha: string | null;
  shortstat: string | null;
  files: CommitDiffFile[];
  truncated: boolean;
  error: string | null;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function commitDiff(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  commitSha: string,
): Promise<CommitDiff> {
  const empty: CommitDiff = {
    found: false,
    commitSha: null,
    shortstat: null,
    files: [],
    truncated: false,
    error: null as string | null,
  };
  const recorded = deps.db.prepare(`
    SELECT 1 FROM publication_events WHERE card_id = ? AND commit_sha = ? LIMIT 1
  `).get(cardId, commitSha);
  if (!recorded) return { ...empty, error: "This commit is not recorded in this card's publication history." };
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ...empty, error: prepared.error };
  return loadCommitDiff(deps, prepared.environmentId, commitSha, empty);
}

async function loadCommitDiff(
  deps: ArtifactsPublicationDeps,
  environmentId: string,
  commitSha: string,
  empty: CommitDiff,
): Promise<CommitDiff> {
  try {
    const result = await deps.bb.sdk.environments.diffFiles({ environmentId, target: "commit", sha: commitSha });
    if (result.outcome !== "available") {
      const error = result.outcome === "not_applicable" ? result.message : result.failure.message;
      return { ...empty, error };
    }
    const patches = new Map(result.initialPatches.map((patch) => [patch.path, patch]));
    const missingPaths = result.files
      .filter((file) => !file.binary && file.loadMode !== "too_large" && !patches.has(file.path))
      .map((file) => file.path);
    const patchesTruncated = await demandCommitPatches(deps, environmentId, commitSha, missingPaths, patches);
    return commitDiffResult(commitSha, result, patches, patchesTruncated);
  } catch (error) {
    return { ...empty, error: errorMessage(error, "BB could not load this commit diff.") };
  }
}

async function demandCommitPatches(
  deps: ArtifactsPublicationDeps,
  environmentId: string,
  commitSha: string,
  missingPaths: string[],
  patches: Map<string, { patch?: string; truncated?: boolean }>,
): Promise<boolean> {
  const limit = 25;
  if (missingPaths.length === 0) return false;
  try {
    const result = await deps.bb.sdk.environments.diffPatch({
      environmentId,
      paths: missingPaths.slice(0, limit),
      target: { type: "commit", sha: commitSha },
    });
    if (result.outcome === "available") {
      for (const patch of result.patches) patches.set(patch.path, patch);
    } else {
      const reason = result.outcome === "not_applicable" ? result.message : result.failure.message;
      deps.bb.log.warn(`stelow commit diff: diffPatch unavailable for ${commitSha} (${missingPaths.length} files): ${reason}`);
    }
  } catch (error) {
    deps.bb.log.warn(`stelow commit diff: diffPatch failed for ${commitSha}: ${errorMessage(error, "Unknown error")}`);
  }
  return missingPaths.length > limit;
}

function commitDiffResult(
  commitSha: string,
  result: Extract<Awaited<ReturnType<BbPluginApi["sdk"]["environments"]["diffFiles"]>>, { outcome: "available" }>,
  patches: Map<string, { patch?: string; truncated?: boolean }>,
  patchesTruncated: boolean,
) {
  return {
    found: true,
    commitSha,
    shortstat: result.shortstat,
    files: result.files.map((file) => {
      const patch = patches.get(file.path);
      return {
        path: file.path,
        display: file.path.split("/").pop() || file.path,
        patch: patch?.patch ?? null,
        binary: file.binary,
        changeKind: file.changeKind,
        additions: file.additions,
        deletions: file.deletions,
        truncated: patch?.truncated ?? file.loadMode !== "auto",
        loadMode: file.loadMode,
      };
    }),
    truncated: result.truncated || patchesTruncated,
    error: null,
  };
}

async function commit(deps: ArtifactsPublicationDeps, cardId: string) {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ok: false, message: prepared.error, commitSha: null };
  const capability = prepared.snapshot.capabilities.commit;
  if (!capability.available) {
    return { ok: false, message: capability.reason ?? "Commit is unavailable.", commitSha: null };
  }
  try {
    const result = await deps.bb.sdk.environments.commit({ environmentId: prepared.environmentId });
    recordPublication(deps, cardId, "commit", result.message, result.commitSha);
    return { ok: true, message: result.message, commitSha: result.commitSha };
  } catch (error) {
    return { ok: false, message: errorMessage(error, "BB could not commit this workspace."), commitSha: null };
  }
}

type SquashResult = { ok: boolean; message: string; commitSha: string | null };

async function squashMerge(
  deps: ArtifactsPublicationDeps,
  cardId: string,
): Promise<SquashResult> {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ok: false, message: prepared.error, commitSha: null };
  const capability = prepared.snapshot.capabilities.squashMerge;
  if (!capability.available) {
    return { ok: false, message: capability.reason ?? "Local squash merge is unavailable.", commitSha: null };
  }
  const base = prepared.snapshot.mergeBase?.branch;
  const branch = prepared.snapshot.branch?.current;
  if (!base) return { ok: false, message: "BB could not determine the merge-base branch.", commitSha: null };
  if (!branch) return { ok: false, message: "BB could not determine this checkout's branch.", commitSha: null };
  return runSquash(deps, cardId, prepared.environmentId, base, branch);
}

async function runSquash(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  environmentId: string,
  base: string,
  branch: string,
): Promise<SquashResult> {
  let script: string;
  try {
    script = buildSquashScript({ base, branch, message: `Squash merge ${branch} into ${base} (Stelow)` });
  } catch (error) {
    return { ok: false, message: errorMessage(error, "Squash refused the branch names."), commitSha: null };
  }
  let terminal: { id: string };
  try {
    terminal = await createPublicationShell(deps.bb, environmentId, `Stelow squash ${branch}`);
  } catch (error) {
    return { ok: false, message: errorMessage(error, "BB could not squash merge this workspace."), commitSha: null };
  }
  try {
    await sendShellCommand(deps.bb, terminal.id, script);
  } catch (error) {
    await deps.bb.sdk.terminals.close({ terminalId: terminal.id, mode: "force" }).catch(() => null);
    const detail = errorMessage(error, "The command could not be sent.");
    return { ok: false, message: `Squash shell opened (${terminal.id}) but ${detail}`, commitSha: null };
  }
  try {
    return await awaitSquash(deps, cardId, terminal.id, base, branch);
  } catch (error) {
    return { ok: false, message: errorMessage(error, "BB could not squash merge this workspace."), commitSha: null };
  }
}

async function awaitSquash(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  terminalId: string,
  base: string,
  branch: string,
): Promise<SquashResult> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const out = await deps.bb.sdk.terminals.output({ terminalId, tailBytes: 8000 }).catch(() => null);
    const tail = ((out?.chunks ?? []) as Array<{ dataBase64: string }>)
      .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
      .join("")
      .slice(-4000);
    const verdict = parseSquashOutput(tail);
    if (verdict.finished) return finishSquash(deps, cardId, terminalId, base, branch, verdict);
    if (Date.now() > deadline) {
      return {
        ok: false,
        message: `Squash is still running in shell ${terminalId} — finish it in BB's terminal panel, then squash again.`,
        commitSha: null,
      };
    }
  }
}

async function finishSquash(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  terminalId: string,
  base: string,
  branch: string,
  verdict: ReturnType<typeof parseSquashOutput>,
): Promise<SquashResult> {
  await deps.bb.sdk.terminals.close({ terminalId, mode: "force" }).catch(() => null);
  if (verdict.exit === 0 && verdict.sha) {
    const message = `Squashed ${branch} into ${base} as ${verdict.sha}.`;
    recordPublication(deps, cardId, "squash_merge", message, verdict.sha);
    return { ok: true, message, commitSha: verdict.sha };
  }
  return { ok: false, message: squashExitMessage(verdict.exit, branch, base), commitSha: null };
}

type TerminalResult = { ok: boolean; message: string; terminalId: string | null };

async function startPush(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  command: string,
  sync: boolean,
): Promise<TerminalResult> {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ok: false, message: prepared.error, terminalId: null };
  const branch = prepared.snapshot.branch?.current;
  if (!branch) {
    return { ok: false, message: "BB could not determine this checkout's branch.", terminalId: null };
  }
  const live = await livePushShell(deps.bb, prepared.environmentId);
  if (live) {
    return { ok: false, message: `A push is already running in shell ${live.id} — Check result instead of starting another.`, terminalId: live.id };
  }
  await retirePushShells(deps.bb, prepared.environmentId);
  return openPushShell(deps, cardId, prepared.environmentId, branch, command, sync);
}

async function openPushShell(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  environmentId: string,
  branch: string,
  command: string,
  sync: boolean,
): Promise<TerminalResult> {
  try {
    const terminal = await createPublicationShell(
      deps.bb,
      environmentId,
      `Stelow push — ${branch}`,
    );
    try {
      await sendShellCommand(deps.bb, terminal.id, command);
    } catch (error) {
      const label = sync ? "command" : "git push";
      return { ok: false, message: errorMessage(error, `${label} could not be sent.`), terminalId: terminal.id };
    }
    const action = sync ? "pull --rebase + push" : "git push";
    recordPublication(deps, cardId, "push_terminal", `Ran ${action} in shell ${terminal.id} on ${branch}.`);
    return {
      ok: true,
      message: `${sync ? "Sync & push" : "Push"} running in shell ${terminal.id} — watch Push shells below for the result.`,
      terminalId: terminal.id,
    };
  } catch (error) {
    const fallback = sync ? "BB could not open a sync shell." : "BB could not open a push terminal.";
    return { ok: false, message: errorMessage(error, fallback), terminalId: null };
  }
}

async function pushTerminals(deps: ArtifactsPublicationDeps, cardId: string) {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ok: false, error: prepared.error, remote: null, terminals: [] };
  try {
    const snapshot = await pushTerminalSnapshot(deps.bb, prepared.environmentId);
    return { ok: true, error: null, ...snapshot };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, "BB could not list push shells."),
      remote: null,
      terminals: [],
    };
  }
}

async function pullRequestAction(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  operation: "ready" | "draft" | "merge",
  method?: "merge" | "rebase" | "squash",
) {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) return { ok: false, message: prepared.error, pullRequestUrl: null };
  const url = prepared.snapshot.pullRequest?.url ?? null;
  const capability = operation === "merge"
    ? prepared.snapshot.capabilities.mergePullRequest
    : operation === "ready"
      ? prepared.snapshot.capabilities.markReady
      : prepared.snapshot.capabilities.markDraft;
  if (!capability.available) {
    return { ok: false, message: capability.reason ?? "This pull-request action is unavailable.", pullRequestUrl: url };
  }
  try {
    return await applyPullRequestAction(deps, cardId, prepared.environmentId, operation, method, url);
  } catch (error) {
    return { ok: false, message: errorMessage(error, "BB could not apply this pull-request action."), pullRequestUrl: url };
  }
}

async function applyPullRequestAction(
  deps: ArtifactsPublicationDeps,
  cardId: string,
  environmentId: string,
  operation: "ready" | "draft" | "merge",
  method: "merge" | "rebase" | "squash" | undefined,
  url: string | null,
) {
  if (operation === "ready") {
    const result = await deps.bb.sdk.environments.markPullRequestReady({ environmentId });
    recordPublication(deps, cardId, "pull_request_ready", result.message, null, url);
    return { ok: true, message: result.message, pullRequestUrl: url };
  }
  if (operation === "draft") {
    const result = await deps.bb.sdk.environments.markPullRequestDraft({ environmentId });
    recordPublication(deps, cardId, "pull_request_draft", result.message, null, url);
    return { ok: true, message: result.message, pullRequestUrl: url };
  }
  const result = await deps.bb.sdk.environments.mergePullRequest({ environmentId, method: method ?? "squash" });
  recordPublication(deps, cardId, "pull_request_merge", result.message, null, url);
  return { ok: true, message: result.message, pullRequestUrl: url };
}

export function createPublicationOperations(deps: ArtifactsPublicationDeps) {
  return {
    async publicationStatus({ cardId }: { cardId: string }) {
      const card = deps.cards.get(cardId);
      return card ? publicationSnapshot(deps, card) : unavailablePublication(deps.cardNotFound);
    },
    publicationCommitDiff: ({ cardId, commitSha }: { cardId: string; commitSha: string }) =>
      commitDiff(deps, cardId, commitSha),
    publicationCommit: ({ cardId }: { cardId: string }) => commit(deps, cardId),
    publicationSquashMerge: ({ cardId }: { cardId: string }) => squashMerge(deps, cardId),
    publicationPushTerminal: ({ cardId }: { cardId: string }) =>
      startPush(deps, cardId, PUSH_COMMAND, false),
    publicationPullPush: ({ cardId }: { cardId: string }) =>
      startPush(deps, cardId, SYNC_COMMAND, true),
    publicationPushTerminals: ({ cardId }: { cardId: string }) => pushTerminals(deps, cardId),
    publicationPullRequestAction: ({ cardId, operation, method }: {
      cardId: string;
      operation: "ready" | "draft" | "merge";
      method?: "merge" | "rebase" | "squash";
    }) => pullRequestAction(deps, cardId, operation, method),
  };
}
