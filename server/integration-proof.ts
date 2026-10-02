/**
 * "Is this card's work already on the base branch?" — asked in one place.
 *
 * Two callers ask it and they must not answer it differently: the worktree
 * cleanup gate, because a wrong `true` deletes a directory, and the publication
 * reconciler, because a wrong `true` silences a chip that should be shouting.
 *
 * The rule itself lives in `lib/discard-policy.mjs` (`isWorkIntegrated`): a
 * recorded merge, or a base branch that already contains this branch's files.
 * The second proof exists because this repository squash-merges — a squash
 * produces an identical tree while rewriting every commit id — so any
 * history-shaped question is asking about an id the rewrite discarded.
 *
 * Nothing here invents a third notion of "integrated".
 */
import { isWorkIntegrated } from "../lib/discard-policy.mjs";

export type GitResult = { ok: boolean; stdout: string };
export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>;

function runGit(
  runGitIn: GitRunner,
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return runGitIn(cwd, args)
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
 * Fails closed: a base that cannot be resolved, a HEAD that cannot be read, or
 * a diff that will not run all report false. Guessing true here deletes a
 * worktree, and silences a chip.
 */
export async function treeMatchesBase(
  runGitIn: GitRunner,
  checkoutPath: string | null | undefined,
): Promise<boolean> {
  if (!checkoutPath) return false;
  const base = await runGit(runGitIn, checkoutPath, ["rev-parse", "--verify", "origin/master"]);
  if (!base.ok || !base.stdout.trim()) return false;
  const mine = await runGit(runGitIn, checkoutPath, ["rev-parse", "HEAD"]);
  if (!mine.ok) return false;
  const [baseSha, headSha] = [base.stdout.trim(), mine.stdout.trim()];
  if (baseSha === headSha) return true;
  const diff = await runGit(runGitIn, checkoutPath, [
    "diff",
    "--name-only",
    `${baseSha}..${headSha}`,
  ]);
  if (!diff.ok) return false;
  return diff.stdout.trim() === "";
}

/** Which proof answered, so a caller can name it rather than guess at it. */
export type IntegrationProof = {
  integrated: boolean;
  proof: "recorded" | "content" | null;
};

export async function integrationProof(input: {
  runGitIn: GitRunner;
  checkoutPath: string | null | undefined;
  recorded: boolean;
}): Promise<IntegrationProof> {
  const byContent = await treeMatchesBase(input.runGitIn, input.checkoutPath);
  const integrated = isWorkIntegrated({
    remoteMerged: input.recorded,
    treeMatchesBase: byContent,
  });
  return integrated
    ? { integrated: true, proof: input.recorded ? "recorded" : "content" }
    : { integrated: false, proof: null };
}
