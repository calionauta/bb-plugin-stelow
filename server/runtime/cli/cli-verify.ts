import { createHash } from "node:crypto";
import { isDoneStatus } from "../../../lib/trackables.mjs";
import {
  exploreVerifyReport,
  exploreVerifyText,
  researchVerifyReport,
  researchVerifyText,
} from "../../../lib/research-artifacts.mjs";
import {
  noCardInContext,
  refuse,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
  type Refusal,
} from "./cli-contract.js";
import type { CliDeps, DocDepth, TestCommand } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow verify [--card <card_id>] [--tests] [--json]";

type GapLoop = {
  unscoped: string[];
  openRework: string[];
};

/** Deterministic worker self-check: the same predicates the sync gate
 * enforces (lib/research-artifacts), runnable BEFORE finishing so a worker
 * fixes its own artifacts instead of the inbox flagging them after. Prompts
 * require this; the sync stays the backstop. */
export function createVerifyCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "verify") return null;
    const args = argv.slice(1);
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json", "--tests"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (scanned.flags.tests) return verifyTests(deps, card, scanned);
    return verifyArtifact(deps, card, Boolean(scanned.flags.json));
  };
}

type TestRun = {
  command: string;
  gitRoot: string;
  headSha: string;
  exitCode: number;
  outputSha256: string;
  output: string;
};

/** Build verification runs the project's own test command in the checkout and
 * records the run against the exact Git identity it observed. Non-Build cards
 * have no checkout to test, so --tests refuses with the alternative. */
async function verifyTests(
  deps: CliDeps,
  card: WorkerCard,
  scanned: { flags: Record<string, string | undefined> },
): Promise<CliResult> {
  if (card.kind !== "build")
    return {
      exitCode: 2,
      stderr:
        "--tests applies to Build cards only; research and explore use their artifact verification.",
    };
  if (card.workspace_kind === "exploratory")
    return {
      exitCode: 1,
      stderr:
        "Build test verification needs a real project checkout. Create or open the recovery audit card instead of testing this preserved \
exploratory card.",
    };
  const target = await testTarget(deps, card);
  if ("refusal" in target) return target.refusal;
  const result = await deps.runHostTests(target.checkoutPath, target.command);
  const run: TestRun = {
    command: target.command.display,
    gitRoot: target.gitRoot,
    headSha: target.headSha,
    exitCode: result.exitCode,
    outputSha256: createHash("sha256").update(result.output).digest("hex"),
    output: result.output.slice(-8000),
  };
  recordVerificationRun(deps, card.id, run);
  return testResult(deps, card, run, Boolean(scanned.flags.json));
}

type TestTarget = {
  checkoutPath: string;
  command: TestCommand;
  gitRoot: string;
  headSha: string;
};

/** The checkout plus the conventional test command to run in it. Both are
 * verified, never guessed: no Git identity means the run cannot be recorded
 * against a tree, and no conventional command means Stelow refuses to execute
 * arbitrary shell text from a receipt. */
async function testTarget(
  deps: CliDeps,
  card: WorkerCard,
): Promise<TestTarget | Refusal> {
  const checkout = await deps.cardCheckout(card);
  const evidence = checkout?.path
    ? await deps.gitEvidence(checkout.path)
    : null;
  if (
    !checkout?.path ||
    !evidence?.isGit ||
    !evidence.gitRoot ||
    !evidence.headSha
  )
    return refuse({
      exitCode: 1,
      stderr:
        "The Build checkout has no verifiable Git root and HEAD. Restore its project workspace, then retry.",
    });
  const command = deps.testCommandForCheckout(checkout.path);
  if (!command)
    return refuse({
      exitCode: 1,
      stderr:
        "No safe conventional test command was found (package.json test script, go.mod, Cargo.toml, or pytest project). Add a project test \
command; Stelow will not execute arbitrary shell text from a receipt.",
    });
  return {
    checkoutPath: checkout.path,
    command,
    gitRoot: evidence.gitRoot,
    headSha: evidence.headSha,
  };
}

/** The run is recorded against the exact Git identity it observed, so a later
 * done can tell a current test run from a stale one. */
function recordVerificationRun(
  deps: CliDeps,
  cardId: string,
  run: TestRun,
): void {
  deps.db
    .prepare(
      "INSERT INTO verification_runs (id, card_id, command, git_root, head_sha, exit_code, output_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      deps.randomId("verify"),
      cardId,
      run.command,
      run.gitRoot,
      run.headSha,
      run.exitCode,
      run.outputSha256,
      deps.now(),
    );
}

async function testResult(
  deps: CliDeps,
  card: WorkerCard,
  run: TestRun,
  json: boolean,
): Promise<CliResult> {
  // Same stage contracts done enforces, surfaced early as warnings: fix them
  // before done refuses with the same lines.
  const docDepths = await deps.docDepths(card).catch(() => []);
  const gapLoop = await reworkLoopWarning(deps, card);
  if (json)
    return {
      exitCode: run.exitCode,
      stdout: JSON.stringify(
        {
          pass: run.exitCode === 0,
          command: run.command,
          gitRoot: run.gitRoot,
          headSha: run.headSha,
          outputSha256: run.outputSha256,
          output: run.output,
          docDepths,
          gapLoop,
        },
        null,
        2,
      ),
    };
  const warnings = docWarning(docDepths) + gapWarning(gapLoop);
  return run.exitCode === 0
    ? {
        exitCode: 0,
        stdout: `PASS: ${run.command} recorded at ${run.headSha}.\n${run.output}${warnings}`,
      }
    : {
        exitCode: run.exitCode,
        stderr: `FAIL: ${run.command} recorded at ${run.headSha}.\n${run.output}${warnings}`,
      };
}

/** The same rework loop done enforces, surfaced early: escalations without
 * scopes and open rework warn here instead of ambushing at done. Read-only —
 * creating scopes stays a gap-scopes call. */
async function reworkLoopWarning(
  deps: CliDeps,
  card: WorkerCard,
): Promise<GapLoop> {
  const gapState = await deps.gapState(card).catch(() => null);
  return {
    unscoped: (gapState?.matched ? gapState.escalated : [])
      .filter(
        (gap) =>
          !gapState?.auditGapScopes.some((scope) => scope.gap === gap.description),
      )
      .map((gap) => gap.description),
    openRework: (gapState?.auditGapScopes ?? [])
      .filter((scope) => !isDoneStatus(scope.status))
      .map((scope) => `${scope.id} (${scope.status})`),
  };
}

function docWarning(docDepths: DocDepth[]): string {
  if (docDepths.length === 0) return "";
  return `\nWARNING: workflow documents need depth (done will refuse):\n${docDepths
    .map((doc) => `FAIL ${doc.label} (${doc.path}): ${doc.failures.join("; ")}`)
    .join("\n")}`;
}

function gapWarning(gapLoop: GapLoop): string {
  if (gapLoop.unscoped.length === 0 && gapLoop.openRework.length === 0) return "";
  return `\nWARNING: rework loop open (done will refuse):\n${
    [
      ...gapLoop.unscoped.map(
        (gap) => `UNSCOPED ${gap} — run bb stelow gap-scopes`,
      ),
      ...gapLoop.openRework.map(
        (scope) =>
          `OPEN ${scope} — finish it, then re-run the critique`,
      ),
    ].join("\n")
  }`;
}

/** Research and explore verify their own deliverable through the pure
 * predicates the sync gate uses. A Build card has no artifact verify, so it
 * must say so rather than reporting a vacuous pass. */
async function verifyArtifact(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  if (card.kind === "research") return verifyResearch(deps, card, json);
  if (card.kind === "explore") {
    const artifact = await deps.researchArtifacts
      .exploreArtifact(card)
      .catch(() => ({
        ready: false as const,
        fingerprint: null as string | null,
        failures: [] as string[],
      }));
    const report = exploreVerifyReport(
      card.id,
      card.explore_stage,
      artifact.ready,
      artifact.failures,
    );
    if (json)
      return {
        exitCode: report.pass ? 0 : 1,
        stdout: JSON.stringify(report, null, 2),
      };
    return verifyText(exploreVerifyText(report));
  }
  return {
    exitCode: 2,
    stderr: `Build verification requires --tests: run \`bb stelow verify --tests\` before its audit receipt and done.`,
  };
}

async function verifyResearch(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  const readiness = await deps.researchArtifacts
    .researchReadiness(card)
    .catch(() => null);
  if (!readiness)
    return { exitCode: 1, stderr: "Unable to read card state — retry verify." };
  const report = researchVerifyReport(
    card.id,
    deps.strategyRounds(card).length,
    readiness.ready || readiness.invalid.length > 0,
    readiness.invalid,
    readiness.evidence,
  );
  if (json)
    return {
      exitCode: report.pass ? 0 : 1,
      stdout: JSON.stringify(report, null, 2),
    };
  return verifyText(researchVerifyText(report));
}

function verifyText(text: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): CliResult {
  return {
    exitCode: text.exitCode,
    ...(text.stdout ? { stdout: text.stdout } : {}),
    ...(text.stderr ? { stderr: text.stderr } : {}),
  };
}
