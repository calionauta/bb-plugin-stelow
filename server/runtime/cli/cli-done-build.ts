import { join } from "node:path";
import { AUDIT_RECEIPT_FILE, auditReceiptReadiness } from "../../../lib/audit-receipt.mjs";
import { auditTrailGate } from "../../../lib/audit-trail-contract.mjs";
import { sameGitEvidence, verificationReadiness } from "../../../lib/audit-verification.mjs";
import { parseArtifactManifest } from "../../../lib/artifact-manifest.mjs";
import { doneBuildGates } from "../../../lib/build-gates.mjs";
import { doneEligibility } from "../../../lib/completion.mjs";
import { countScopeDialects } from "../../../lib/spec-scope-reader.mjs";
import { recordTrackableEvent } from "../../../lib/trackable-events.mjs";
import { latestSpecTech, loadCardScopes } from "../../scopes.js";
import { refuse, type CliResult, type Refusal } from "./cli-contract.js";
import type { CliDeps, GitEvidence } from "./cli-deps.js";
import type { ExportRunBundle } from "./cli-bundle-writer.js";
import { completeCard, doneStdout } from "./cli-done-track.js";
import { text } from "../values.js";
import type { WorkerCard } from "../../workers-types.js";

const GIT_EVIDENCE_LOST =
  "Build completion is blocked: the execution checkout no longer has verifiable Git root and HEAD evidence. Restore the intended \
checkout, re-run audit, then run done.";
const CHECKOUT_MOVED =
  "The checkout moved while the portable audit trail was being finalized. Re-run audit, then done.";

export type BuildGates = {
  projectPath: string | null;
  currentStage: string;
  stateDir: string | null;
  stateBlob: string | null;
  trackedScopes: ReturnType<typeof loadCardScopes>;
};

type VerificationRun = {
  command: string;
  git_root: string;
  head_sha: string;
  exit_code: number;
} | undefined;

/** Build completion is the longest gate chain of the three tracks: owned
 * state, eligibility, spec tracking, checkout evidence, document depth, the
 * rework loop, the test run, the durable receipt, the portable trail, the
 * post-trail re-sample, then the bundle and the state write. Each stage is one
 * refusal with the fix; the card only becomes Done when all of them pass. */
export async function doneBuild(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
  card: WorkerCard,
  questionPending: boolean,
): Promise<CliResult> {
  const gates = await readBuildGates(deps, card);
  if ("refusal" in gates) return gates.refusal;
  const { projectPath, currentStage, stateDir, stateBlob, trackedScopes } = gates;
  const eligibility = doneEligibility({
    kind: "build",
    stage: currentStage,
    questionPending,
    scopesOpen: trackedScopes,
  });
  if (eligibility) return { exitCode: 1, stderr: eligibility };
  const specRefusal = specTechRefusal(
    projectPath,
    card.id,
    currentStage,
    trackedScopes,
  );
  if (specRefusal) return { exitCode: 1, stderr: specRefusal };
  const evidence = await checkoutEvidence(deps, card);
  if ("refusal" in evidence) return evidence.refusal;
  const verificationRun = latestVerificationRun(deps, card.id);
  const verification = verificationReadiness(verificationRun, evidence.git);
  if (!verification.ready) return { exitCode: 1, stderr: verification.error };
  const receipt = auditReceiptReadiness(
    await receiptContent(deps, stateDir),
    stateBlob ? parseArtifactManifest(stateBlob) : [],
    evidence.checkoutPath,
    evidence.git,
    verificationRun,
  );
  if (!receipt.ready) return { exitCode: 1, stderr: receipt.error };
  return finishBuild(deps, exportRunBundle, card, {
    projectPath,
    stateDir,
    currentStage,
    git: evidence.git,
    checkoutPath: evidence.checkoutPath,
  });
}

type BuildFinish = {
  projectPath: string | null;
  stateDir: string | null;
  currentStage: string;
  git: GitEvidence;
  checkoutPath: string | null;
};

async function finishBuild(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
  card: WorkerCard,
  finish: BuildFinish,
): Promise<CliResult> {
  const trailRefusal = await auditTrailRefusal(
    deps,
    finish.projectPath,
    finish.stateDir,
    finish.git,
  );
  if (trailRefusal) return { exitCode: 1, stderr: trailRefusal };
  // The audit receipt, portable trail, and final Done transition all name one
  // checkout. Sample once more immediately before the state write so an
  // external checkout or commit between `check` and Done cannot leave a
  // completed card pointing at stale evidence.
  if (finish.checkoutPath) {
    const postTrail = await deps.gitEvidence(finish.checkoutPath);
    if (!sameGitEvidence(finish.git, postTrail))
      return { exitCode: 1, stderr: CHECKOUT_MOVED };
  }
  const bundle = await exportRunBundle(card, {});
  if (!bundle.ok)
    return {
      exitCode: 1,
      stderr: `Build completion is blocked: run-bundle export failed (${bundle.error}) — retry done.`,
    };
  completeCard(deps, card.id, { stage: finish.currentStage });
  trackableCompletion(deps, card.id, `audit at ${finish.currentStage}`);
  await deps.releaseCardClaims(card.id);
  return {
    exitCode: 0,
    stdout: doneStdout(`Done. Workflow "${card.name}" completed at audit.`, bundle),
  };
}

/** The completion state read once for the build gates: the workspace, the
 * state dir plus its `state.md`, the slug-truth stage, and the tracked
 * (unmerged) scopes. Ownership of state is itself a gate — no `state.md`
 * means no completion. */
async function readBuildGates(
  deps: CliDeps,
  card: WorkerCard,
): Promise<BuildGates | Refusal> {
  if (card.workspace_kind === "exploratory")
    return refuse({
      exitCode: 1,
      stderr:
        "Build completion is blocked: this card runs in an exploratory workspace with no code project or Git history. Restart the work \
in the intended BB project; this card's state artifacts remain readable for reference.",
    });
  const workspace = await deps.cardWorkspace(card);
  const projectPath = workspace?.path ?? null;
  let currentStage = card.stage;
  let stateBlob: string | null = null;
  let stateDir: string | null = null;
  if (projectPath && card.dir_hash) {
    stateDir = await deps.workflowStateDir(
      projectPath,
      card.id,
      card.dir_hash,
    );
    stateBlob = stateDir
      ? await deps.bb.sdk.files
          .read({ path: join(stateDir, "state.md") })
          .then((file) => file.content)
          .catch(() => null)
      : null;
    if (!stateBlob)
      return refuse({
        exitCode: 1,
        stderr:
          "Workflow state ownership cannot be verified. Reseed this card; project-root state is intentionally ignored.",
      });
    currentStage = text(stateBlob.match(/current_stage:\s*(\S+)/m)?.[1]) || card.stage;
  }
  // Gates read tracked truth (mergePlanned: false): the read-time planned-task
  // merge is display-only, so pre-merge cards keep completing while tracked
  // checklists bind.
  const trackedScopes = projectPath
    ? loadCardScopes(projectPath, card.id, { mergePlanned: false })
    : [];
  return { projectPath, currentStage, stateDir, stateBlob, trackedScopes };
}

function receiptContent(deps: CliDeps, stateDir: string | null): Promise<string | null> {
  if (!stateDir) return Promise.resolve(null);
  return deps.bb.sdk.files
    .read({ path: join(stateDir, AUDIT_RECEIPT_FILE) })
    .then((file) => file.content)
    .catch(() => null);
}

type CheckoutEvidence = { checkoutPath: string | null; git: GitEvidence };

/** The checkout the worker changed plus the Git identity it has right now.
 * A checkout that exists without verifiable Git root/HEAD evidence cannot be
 * certified as complete. */
async function checkoutEvidence(
  deps: CliDeps,
  card: WorkerCard,
): Promise<CheckoutEvidence | Refusal> {
  const checkout = await deps.cardCheckout(card);
  const git = checkout?.path ? await deps.gitEvidence(checkout.path) : null;
  if (checkout?.path && (!git?.isGit || !git.gitRoot || !git.headSha))
    return refuse({ exitCode: 1, stderr: GIT_EVIDENCE_LOST });
  return { checkoutPath: checkout?.path ?? null, git };
}

/** Invisible-scopes companion: audit with zero synced scopes but scope
 * blocks in spec-tech means execution ran untracked — done must not certify
 * it. Missing/unreadable specs fail open here; thin specs are owned by the
 * depth gate. Gate order lives in lib/build-gates (first refusal wins). */
function specTechRefusal(
  projectPath: string | null,
  cardId: string,
  currentStage: string,
  trackedScopes: ReturnType<typeof loadCardScopes>,
): string | null {
  if (!projectPath) return null;
  const specTech = latestSpecTech(projectPath, cardId);
  const specCounts = countScopeDialects(specTech?.content ?? null);
  return doneBuildGates({
    kind: "build",
    stage: currentStage,
    scopes: trackedScopes,
    specMachine: specCounts.machine,
    specHuman: specCounts.human,
    specContent: specTech?.content ?? null,
  });
}

function latestVerificationRun(deps: CliDeps, cardId: string): VerificationRun {
  return deps.db
    .prepare(
      "SELECT command, git_root, head_sha, exit_code FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(cardId) as VerificationRun;
}

/** Stelow owns a portable, deterministic audit trail. Build it only after the
 * stricter BB receipt passes, so every Done card carries the same cross-host
 * lineage record as any other host. `--strict` makes the receipt's links
 * complete (a produced document that was never registered would otherwise be
 * missing from them), and the gate re-binds the trail to the Git identity the
 * receipt was validated at: the helper samples the tree while writing, so a
 * checkout that moved after the receipt check fails here instead of leaving
 * Done with two receipts attesting different trees. */
async function auditTrailRefusal(
  deps: CliDeps,
  projectPath: string | null,
  stateDir: string | null,
  git: GitEvidence,
): Promise<string | null> {
  if (!projectPath) return null;
  const trail = await deps.runHelper(
    ["audit-trail", "build", "--strict", "--json"],
    projectPath,
    stateDir ?? undefined,
  );
  const trailCheck =
    trail.code === 0
      ? await deps.runHelper(
          ["audit-trail", "check", "--strict", "--json"],
          projectPath,
          stateDir ?? undefined,
        )
      : null;
  const gate = auditTrailGate({
    build: trail,
    check: trailCheck,
    verifiedGit: git,
  });
  if (gate.ready) return null;
  return gate.error ?? "Audit trail validation failed.";
}

/** The done trail event: a completed card without it is invisible to flow
 * metrics, which is what turned "N finished" into "N in Done". Never
 * blocks the completion. */
function trackableCompletion(deps: CliDeps, cardId: string, evidence: string): void {
  try {
    recordTrackableEvent(deps.db, {
      cardId,
      kind: "build",
      trackableId: cardId,
      transition: "completed",
      actor: "host",
      evidence,
    });
  } catch {
    /* trail never blocks */
  }
}
