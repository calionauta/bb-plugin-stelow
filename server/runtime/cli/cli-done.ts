import { doneEligibility } from "../../../lib/completion.mjs";
import {
  exploreVerifyReport,
  exploreVerifyText,
  researchVerifyReport,
  researchVerifyText,
} from "../../../lib/research-artifacts.mjs";
import { isArchivedCard } from "../../../lib/worker-action-policy.mjs";
import {
  ERR_CARD_ARCHIVED,
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import { doneBuild } from "./cli-done-build.js";
import {
  announceCompletion,
  completeCard,
  doneStdout,
  reviewPolicyRefusal,
} from "./cli-done-track.js";
import type { CliDeps } from "./cli-deps.js";
import type { ResearchReadiness } from "../research-artifacts.js";
import type { ExportRunBundle } from "./cli-bundle-writer.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow done [--card <card_id>]";

/** Explicit completion commit. Done-ness was inferred from `audit` + idle, so
 * narrate-and-stop looked identical to stuck. The worker declares done; the
 * host verifies in code (lib/completion): build only at `audit`,
 * research/explore only with a passing `verify` and no pending question.
 * Every refusal names the fix. The build gate chain lives in
 * cli-done-build.ts; this file owns the entry and the two single-stage
 * tracks, which share the same completion writer. */
export function createDoneCommand(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "done") return null;
    const scanned = scanCardId(
      argv.slice(1),
      ctx,
      deps.getCardByWorkerThread,
      { usage: USAGE, boolean: [] },
    );
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (isArchivedCard(card))
      return { exitCode: 1, stderr: ERR_CARD_ARCHIVED };
    const pending = await deps
      .pendingQuestions(card.worker_thread_id)
      .catch(() => []);
    if (card.kind === "build")
      return doneBuild(deps, exportRunBundle, card, pending.length > 0);
    if (card.kind === "research")
      return doneResearch(deps, exportRunBundle, card, pending.length > 0);
    if (card.kind === "explore")
      return doneExplore(deps, exportRunBundle, card, pending.length > 0);
    return {
      exitCode: 1,
      stderr: `Unknown card kind "${card.kind}". Archive this card and start a new one.`,
    };
  };
}

/** Research completion: the deterministic verify over the strategy rounds is
 * the gate (lib/research-artifacts) — the same predicates the sync poll
 * enforces, so `done` never certifies an index the inbox would flag. */
async function doneResearch(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
  card: WorkerCard,
  questionPending: boolean,
): Promise<CliResult> {
  const eligibility = doneEligibility({
    kind: "research",
    stage: null,
    questionPending,
  });
  if (eligibility) return { exitCode: 1, stderr: eligibility };
  const readiness = await deps.researchArtifacts
    .researchReadiness(card)
    .catch(() => null);
  if (!readiness)
    return { exitCode: 1, stderr: "Unable to read card state — retry done." };
  const verified = researchVerifyGate(deps, card, readiness);
  if (verified) return verified;
  const reviewRefusal = await reviewPolicyRefusal(
    deps,
    card,
    readiness.fingerprint,
    "index",
  );
  if (reviewRefusal) return { exitCode: 1, stderr: reviewRefusal };
  const bundle = await exportRunBundle(card, {});
  if (!bundle.ok)
    return {
      exitCode: 1,
      stderr: `Research completion is blocked: run-bundle export failed (${bundle.error}) — retry done.`,
    };
  completeCard(deps, card.id);
  await deps.releaseCardClaims(card.id);
  announceCompletion(deps, card.id, {
    inbox: `Research complete — results ready to review in Done.${
      readiness.evidence === "hypothesis-only"
        ? " Marked hypothesis-only: web research was unavailable — requires human validation."
        : ""
    }`,
    dedupeKey: `completed:${card.id}:index:${readiness.fingerprint ?? "ready"}`,
  });
  return {
    exitCode: 0,
    stdout: doneStdout(`Done. Research "${card.name}" completed.`, bundle),
  };
}

/** The deterministic round check, reported with the same copy `verify`
 * prints, so a worker reads one failure shape wherever it meets it. */
function researchVerifyGate(
  deps: CliDeps,
  card: WorkerCard,
  readiness: ResearchReadiness,
): CliResult | null {
  const report = researchVerifyReport(
    card.id,
    deps.strategyRounds(card).length,
    readiness.ready || readiness.invalid.length > 0,
    readiness.invalid,
    readiness.evidence,
  );
  if (report.pass) return null;
  const textOut = researchVerifyText(report);
  return {
    exitCode: 1,
    stdout: textOut.stdout,
    stderr:
      textOut.stderr || "verify failed — fix the rounds above, then run done again.",
  };
}

/** Explore completion mirrors research on the stage artifact: deterministic
 * verify, then the review policy, then the bundle and the completion
 * writer. */
async function doneExplore(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
  card: WorkerCard,
  questionPending: boolean,
): Promise<CliResult> {
  const eligibility = doneEligibility({
    kind: "explore",
    stage: null,
    questionPending,
  });
  if (eligibility) return { exitCode: 1, stderr: eligibility };
  const artifact = await deps.researchArtifacts
    .exploreArtifact(card)
    .catch(() => ({
      ready: false as const,
      fingerprint: null as string | null,
      failures: [] as string[],
    }));
  const verified = exploreVerifyGate(card, artifact);
  if (verified) return verified;
  const reviewRefusal = await reviewPolicyRefusal(
    deps,
    card,
    artifact.fingerprint,
    "artifact",
  );
  if (reviewRefusal) return { exitCode: 1, stderr: reviewRefusal };
  const bundle = await exportRunBundle(card, {});
  if (!bundle.ok)
    return {
      exitCode: 1,
      stderr: `Exploration completion is blocked: run-bundle export failed (${bundle.error}) — retry done.`,
    };
  completeCard(deps, card.id);
  await deps.releaseCardClaims(card.id);
  announceCompletion(deps, card.id, {
    inbox: "Exploration complete — result ready to review in Done.",
    dedupeKey: `explore-completed:${card.id}:${artifact.fingerprint ?? "ready"}`,
  });
  return {
    exitCode: 0,
    stdout: doneStdout(`Done. Exploration "${card.name}" completed.`, bundle),
  };
}

function exploreVerifyGate(
  card: WorkerCard,
  artifact: { ready: boolean; failures: string[] },
): CliResult | null {
  const report = exploreVerifyReport(
    card.id,
    card.explore_stage,
    artifact.ready,
    artifact.failures,
  );
  if (report.pass) return null;
  const textOut = exploreVerifyText(report);
  return {
    exitCode: 1,
    stdout: textOut.stdout,
    stderr:
      textOut.stderr || "verify failed — fix the artifact above, then run done again.",
  };
}
