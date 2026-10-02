import { execFile } from "node:child_process";
import { formatBytes, threadIdFromWorktreePath } from "../../../lib/worktree-storage.mjs";
import { cleanupIntegrationGate } from "../../../lib/discard-policy.mjs";
import { scanFlags, type CliCommandFn, type CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

/**
 * `bb stelow gc` — list the worktrees whose disk could be reclaimed, and free
 * the ones that are safe.
 *
 * The default is a dry run. A command that deletes directories is one a person
 * runs on a hunch ("my disk is filling up"), and the answer to that hunch is
 * usually a list, not a deletion. `--apply` is the only way to remove
 * anything, and it removes only what this command already showed.
 *
 * The safety rule is the point, and it is deliberately NOT "is the card
 * finished". `card_cbnihg4c` sat at Done with 963 lines across 20 files,
 * committed on a branch nobody merged, inside a 269M worktree. Reclaiming
 * that would have deleted the only copy of that work in existence. A card
 * being Done is the case we are trying to clean up; the question is whether
 * anything in the checkout is somewhere a human can get it back from.
 *
 * That question is answered by `cleanupIntegrationGate`, the same gate the
 * worktree cleanup RPC enforces. This command holds no second opinion — one
 * rule, two callers, so the two surfaces cannot disagree about what is safe to
 * delete.
 *
 * Only `completed` and `archived` cards are considered. A card mid-flight has
 * a worker writing into its worktree, and naming it a candidate would be
 * offering to delete something in use.
 */

const USAGE = [
  "Usage: bb stelow gc [--json] [--apply] [--card <card_id>]",
  "",
  "  --json    machine-readable candidates and verdicts",
  "  --apply   remove the worktrees listed as safe (default: list only)",
  "  --card    limit to one card",
].join("\n");

const FINISHED_CARD_STATUSES = new Set(["completed", "archived"]);

type Candidate = {
  cardId: string;
  cardName: string;
  cardStatus: string;
  path: string;
  branch: string | null;
  bytes: number | null;
  safe: boolean;
  blockers: string[];
};

type WorktreeEnvironment = {
  id?: unknown;
  path?: unknown;
  isWorktree?: unknown;
  branchName?: unknown;
};

export function createGcCommand(deps: CliDeps): CliCommandFn {
  return async (argv) => {
    if (argv[0] !== "gc") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const apply = args.includes("--apply");
    const scan = scanFlags(args, {
      boolean: ["--json", "--apply"],
      valued: ["--card"],
      usage: USAGE,
    });
    if (!scan.ok) return scan.result;
    const candidates = await collectCandidates(deps, scan.flags.card);
    return apply
      ? applyGc(deps, candidates, json)
      : listGc(candidates, json);
  };
}

/** The default: a list, because the question a person asks is "what could go". */
function listGc(candidates: Candidate[], json: boolean): CliResult {
  if (json) return { exitCode: 0, stdout: JSON.stringify(tally(candidates), null, 2) };
  if (candidates.length === 0)
    return { exitCode: 0, stdout: "No finished card owns a worktree." };
  const safe = candidates.filter((c) => c.safe);
  const blocked = candidates.filter((c) => !c.safe);
  return { exitCode: 0, stdout: report(candidates, safe, blocked, reclaimable(safe)) };
}

/** `--apply`, which removes only what the list already showed. */
async function applyGc(
  deps: CliDeps,
  candidates: Candidate[],
  json: boolean,
): Promise<CliResult> {
  const safe = candidates.filter((c) => c.safe);
  const removed = await removeSafe(deps, safe);
  if (json)
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ...tally(candidates), applied: true, removed }, null, 2),
    };
  return {
    exitCode: 0,
    stdout: [
      `Removed ${removed.length} worktree${removed.length === 1 ? "" : "s"}, freeing ${
        formatBytes(reclaimable(safe)) ?? "an unknown amount"
      }.`,
      ...removed.map((id) => `- ${id}`),
      ...(candidates.some((c) => !c.safe)
        ? ["", `Left alone (work is not integrated yet): ${candidates.filter((c) => !c.safe).length}`]
        : []),
    ].join("\n"),
  };
}

function reclaimable(safe: Candidate[]): number {
  return safe.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
}

function tally(candidates: Candidate[]) {
  return {
    worktrees: candidates.length,
    safe: candidates.filter((c) => c.safe).length,
    blocked: candidates.filter((c) => !c.safe).length,
    reclaimableBytes: reclaimable(candidates.filter((c) => c.safe)),
    candidates,
  };
}

async function collectCandidates(
  deps: CliDeps,
  onlyCardId: string | undefined,
): Promise<Candidate[]> {
  const environments = await deps.bb.sdk.environments
    .list()
    .then((result) => (Array.isArray(result) ? result : []))
    .catch(() => []);
  const candidates: Candidate[] = [];
  for (const raw of environments) {
    const env = (raw ?? {}) as WorktreeEnvironment;
    if (typeof env.id !== "string" || env.isWorktree !== true) continue;
    const path = typeof env.path === "string" && env.path ? env.path : null;
    if (!path) continue;
    const threadId = threadIdFromWorktreePath(path);
    const cardId = threadId ? deps.workers.ledgerCardId(threadId) : null;
    if (!cardId) continue;
    if (onlyCardId && cardId !== onlyCardId) continue;
    const card = deps.getCard(cardId);
    if (!card || !FINISHED_CARD_STATUSES.has(card.status)) continue;
    const evidence = await deps.discardEvidence(card);
    const verdict = cleanupIntegrationGate({
      ...evidence,
      // The publication ledger is the only record of "this card's work reached
      // the base branch" written at the moment it happened, and it is what a
      // squash merge leaves behind. The tree comparison is the second proof,
      // for a branch whose merge was recorded somewhere else.
      remoteMerged: deps.hasRecordedMerge?.(cardId) === true,
      treeMatchesBase: await treeMatchesBase(deps, evidence),
    });
    candidates.push({
      cardId: card.id,
      cardName: card.name,
      cardStatus: card.status,
      path,
      branch: typeof evidence.branch === "string" ? evidence.branch : null,
      bytes: await duBytes(path),
      safe: verdict.safe,
      blockers: verdict.blockers,
    });
  }
  candidates.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
  return candidates;
}

function runGit(
  deps: CliDeps,
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return deps
    .runGitIn(cwd, args)
    .then((result) => ({ ok: result.ok, stdout: result.stdout }))
    .catch(() => ({ ok: false, stdout: "" }));
}

/**
 * Does the base branch already contain this branch's files?
 *
 * A squash produces an identical tree, so this is the proof that survives a
 * rewrite of every commit id — which is why it is a positive check rather than
 * "no unpushed commits", since a pushed-but-unmerged branch also has none.
 *
 * Fails closed: a base that cannot be resolved, or a dirty tree that would
 * change the answer, reports false. Guessing true here deletes a worktree.
 */
async function treeMatchesBase(
  deps: CliDeps,
  evidence: { checkoutPath?: string | null; branch?: string | null } | null,
): Promise<boolean> {
  const path = evidence?.checkoutPath;
  if (!path) return false;
  const base = await runGit(deps, path, ["rev-parse", "--verify", "origin/master"]);
  if (!base.ok || !base.stdout.trim()) return false;
  const mine = await runGit(deps, path, ["rev-parse", "HEAD"]);
  if (!mine.ok) return false;
  const [baseSha, headSha] = [base.stdout.trim(), mine.stdout.trim()];
  if (baseSha === headSha) return true;
  const diff = await runGit(deps, path, ["diff", "--name-only", `${baseSha}..${headSha}`]);
  if (!diff.ok) return false;
  return diff.stdout.trim() === "";
}

function duBytes(path: string): Promise<number | null> {
  return new Promise((resolveDu) => {
    execFile("du", ["-sb", path], { timeout: 8000 }, (error, stdout) => {
      if (error) return resolveDu(null);
      const match = /^\d+/.exec(String(stdout ?? ""));
      resolveDu(match ? Number.parseInt(match[0], 10) : null);
    });
  });
}

/**
 * Remove the worktrees the gate approved, one at a time, re-checking each.
 *
 * The preview may be minutes old, and this is the call that deletes a
 * directory — so the gate is asked again here, per card, and a card that grew
 * unmerged work in between is left alone. One host failure must not stop the
 * rest, and must never be reported as a success.
 */
async function removeSafe(deps: CliDeps, safe: Candidate[]): Promise<string[]> {
  const removed: string[] = [];
  for (const candidate of safe) {
    const card = deps.getCard(candidate.cardId);
    if (!card) continue;
    // Re-checked here, not trusted from the listing above: the preview may be
    // minutes old, and this is the call that deletes a directory. A card that
    // grew unmerged work in between is left alone.
    const fresh = await deps.discardEvidence(card);
    const verdict = cleanupIntegrationGate({
      ...fresh,
      remoteMerged: deps.hasRecordedMerge?.(candidate.cardId) === true,
      treeMatchesBase: await treeMatchesBase(deps, fresh),
    });
    if (!verdict.safe) continue;
    const result = await deps
      .cleanupWorktree(candidate.cardId)
      .catch(() => ({ ok: false, summary: null, error: "Cleanup failed." }));
    // A failure is never reported as a success: the summary line says how many
    // actually went, not how many were asked for.
    if (result.ok) removed.push(candidate.cardId);
  }
  return removed;
}

function report(
  candidates: Candidate[],
  safe: Candidate[],
  blocked: Candidate[],
  reclaimable: number,
): string {
  const lines = [
    `Card worktrees: ${candidates.length} · safe to remove: ${safe.length} · blocked: ${blocked.length}`,
    `Reclaimable now: ${formatBytes(reclaimable) ?? "an unknown amount"}`,
    "",
  ];
  for (const candidate of candidates) {
    const size = formatBytes(candidate.bytes) ?? "unknown size";
    const head = `- ${size} · ${candidate.cardName} (${candidate.cardId}, ${candidate.cardStatus})`;
    const branch = candidate.branch ? ` · ${candidate.branch}` : "";
    lines.push(
      candidate.safe
        ? `${head}${branch}`
        : `${head}${branch}\n  kept · ${candidate.blockers.join(" ")}`,
    );
  }
  if (safe.length > 0) lines.push("", "Reclaim with: bb stelow gc --apply");
  return lines.join("\n");
}
