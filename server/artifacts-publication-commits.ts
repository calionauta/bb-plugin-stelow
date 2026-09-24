import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ArtifactsPublicationDeps } from "./artifacts-publication.js";
import {
  preparedEnvironment,
  recordPublication,
} from "./artifacts-publication-status.js";

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

export async function publicationCommitDiff(
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
    error: null,
  };
  const recorded = deps.db.prepare(`
    SELECT 1 FROM publication_events WHERE card_id = ? AND commit_sha = ? LIMIT 1
  `).get(cardId, commitSha);
  if (!recorded) {
    return {
      ...empty,
      error: "This commit is not recorded in this card's publication history.",
    };
  }
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
    const result = await deps.bb.sdk.environments.diffFiles({
      environmentId,
      target: "commit",
      sha: commitSha,
    });
    if (result.outcome !== "available") {
      const error = result.outcome === "not_applicable"
        ? result.message
        : result.failure.message;
      return { ...empty, error };
    }
    const patches = new Map(result.initialPatches.map((patch) => [patch.path, patch]));
    const missingPaths = result.files
      .filter((file) => (
        !file.binary
        && file.loadMode !== "too_large"
        && !patches.has(file.path)
      ))
      .map((file) => file.path);
    const patchesTruncated = await demandCommitPatches(
      deps,
      environmentId,
      commitSha,
      missingPaths,
      patches,
    );
    return commitDiffResult(commitSha, result, patches, patchesTruncated);
  } catch (error) {
    return {
      ...empty,
      error: errorMessage(error, "BB could not load this commit diff."),
    };
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
      const reason = result.outcome === "not_applicable"
        ? result.message
        : result.failure.message;
      deps.bb.log.warn(
        `stelow commit diff: diffPatch unavailable for ${commitSha} (${missingPaths.length} files): ${reason}`,
      );
    }
    return missingPaths.length > limit;
  } catch (error) {
    deps.bb.log.warn(
      `stelow commit diff: diffPatch failed for ${commitSha}: ${errorMessage(error, "Unknown error")}`,
    );
    return false;
  }
}

function commitDiffResult(
  commitSha: string,
  result: Extract<
    Awaited<ReturnType<BbPluginApi["sdk"]["environments"]["diffFiles"]>>,
    { outcome: "available" }
  >,
  patches: Map<string, { patch?: string; truncated?: boolean }>,
  patchesTruncated: boolean,
): CommitDiff {
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

export async function publicationCommit(
  deps: ArtifactsPublicationDeps,
  cardId: string,
): Promise<{ ok: boolean; message: string; commitSha: string | null }> {
  const prepared = await preparedEnvironment(deps, cardId);
  if ("error" in prepared) {
    return { ok: false, message: prepared.error, commitSha: null };
  }
  const capability = prepared.snapshot.capabilities.commit;
  if (!capability.available) {
    return {
      ok: false,
      message: capability.reason ?? "Commit is unavailable.",
      commitSha: null,
    };
  }
  try {
    const result = await deps.bb.sdk.environments.commit({
      environmentId: prepared.environmentId,
    });
    recordPublication(deps, cardId, "commit", result.message, result.commitSha);
    return { ok: true, message: result.message, commitSha: result.commitSha };
  } catch (error) {
    return {
      ok: false,
      message: errorMessage(error, "BB could not commit this workspace."),
      commitSha: null,
    };
  }
}
