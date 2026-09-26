import { buildGapTriageState, gapsToTriageBatch } from "../../../lib/gap-registry.mjs";
import { TASK_EVIDENCE_DIFF_CHARS } from "../../../lib/task-evidence.mjs";
import {
  ERR_WORKSPACE_UNAVAILABLE,
  noCardInContext,
  refuse,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
  type Refusal,
} from "./cli-contract.js";
import {
  decisionApiEnabled,
  judgingPoint,
  judgingRoute,
} from "./cli-judging-route.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow gap-triage [--card <card_id>] [--json]";
const MODE_REFUSAL =
  "Gap triage needs the Artifact criteria router in Decision API or preset mode. Set it in Manage agent presets → Decision routers.";

type GapState = {
  matched: boolean;
  failures: string[];
  escalated: unknown[];
  critiqueText: string;
};

/** Advisory gap-triage: the worker classified the critique's gaps (fixed /
 * documented / escalate). This asks a judge, per escalated gap, whether it is
 * a genuine gap — second-opining the worker's own classification, never the
 * routing (the impact×effort matrix and scope conversion stay deterministic).
 * The judge reads the critique and the working diff, never the gap wording
 * alone. Read-only, never a gate. */
export function createGapTriageCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "gap-triage") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (card.kind !== "build")
      return {
        exitCode: 1,
        stderr:
          "gap-triage runs on Build cards — research and explore have no execution critique.",
      };
    return runGapTriage(deps, card, json);
  };
}

async function runGapTriage(
  deps: CliDeps,
  card: WorkerCard,
  json: boolean,
): Promise<CliResult> {
  const disabled = decisionApiEnabled();
  if (disabled) return disabled;
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path)
    return { exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE };
  const gapState = await deps.gapState(card).catch(() => null);
  const early = gapStateRefusal(gapState);
  if (early) return early;
  const point = judgingPoint(deps, MODE_REFUSAL);
  if ("refusal" in point) return point.refusal;
  const route = judgingRoute(deps, point.point, point.mode);
  if ("refusal" in route) return route.refusal;
  const batch = gapsToTriageBatch((gapState as GapState).escalated as never);
  if (batch.items.length === 0)
    return {
      exitCode: 0,
      stdout: "Escalated gaps carry no descriptions to triage.",
    };
  const diff = await deps.workingDiffFor(workspace.path, TASK_EVIDENCE_DIFF_CHARS);
  const critiqueText = (gapState as GapState).critiqueText;
  const judged = await judgeGaps(deps, card, batch, route, critiqueText, diff);
  if ("refusal" in judged) return judged.refusal;
  return triageResult(card.id, route, judged.findings, critiqueText.length, diff, json);
}

type GapBatch = { items: Array<{ id: string; text: string; name: string }>; questions: Record<string, unknown> };
type GapRoute = {
  mode: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  routeAt: number;
  presetId: string | null;
};

/** Genuineness cannot be judged from the gap's wording alone: the judge gets
 * the critique that claimed the gaps plus the working diff that shows whether
 * the code still has them. */
async function judgeGaps(
  deps: CliDeps,
  card: WorkerCard,
  batch: GapBatch,
  route: GapRoute,
  critiqueText: string,
  diff: string,
): Promise<{ findings: Array<{ name: string; verdict: string; confidence: number | null }> } | Refusal> {
  const evidence = buildGapTriageState({ critiqueText, diff });
  const judged = await deps.judgeScoredBatch({
    items: batch.items,
    questions: batch.questions as Record<string, unknown>,
    keyPrefix: "gap",
    state: evidence,
    mode: route.mode,
    presetId: route.presetId,
    projectId: card.project_id,
    title: "Stelow judge: gap triage",
    provider: route.provider,
    endpoint: route.endpoint,
    apiKey: route.apiKey,
    model: route.model,
    routeAt: route.routeAt,
  });
  if (!judged.ok)
    return refuse({
      exitCode: 1,
      stderr: `Gap triage failed: ${judged.error} — retry or check the router.`,
    });
  return { findings: judged.findings };
}

function gapStateRefusal(
  gapState: { matched: boolean; failures: string[]; escalated: unknown[] } | null,
): CliResult | null {
  if (!gapState?.matched)
    return {
      exitCode: 1,
      stderr:
        "No execution critique found — write it first, then triage its gaps.",
    };
  if (gapState.failures.length > 0)
    return { exitCode: 1, stderr: gapState.failures.join("\n") };
  if (gapState.escalated.length === 0)
    return {
      exitCode: 0,
      stdout:
        "No escalated gaps to triage — nothing the registry routed to a rework scope.",
    };
  return null;
}

function triageResult(
  cardId: string,
  route: { provider: string },
  findings: Array<{
    name: string;
    verdict: string;
    confidence: number | null;
  }>,
  critiqueChars: number,
  diff: string,
  json: boolean,
): CliResult {
  const genuine = findings.filter((finding) => finding.verdict === "met").length;
  const dismissed = findings.filter((finding) => finding.verdict === "unmet").length;
  const uncertain = findings.length - genuine - dismissed;
  if (json)
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          card: cardId,
          provider: route.provider,
          evidence: { critiqueChars, diffChars: diff.length },
          findings,
          summary: { genuine, dismissed, unverifiable: uncertain },
        },
        null,
        2,
      ),
    };
  const blind =
    diff.length === 0
      ? " (no working-tree diff — judgments rest on the critique alone; commit or stage the work and re-run for code-grounded verdicts)"
      : "";
  return {
    exitCode: 0,
    stdout: [
      `Gap triage (${findings.length} escalated gaps judged for genuineness against the critique and the working diff):`,
      ...findings.map(
        (finding) =>
          `${verdictMark(finding.verdict)} ${finding.verdict}${
            finding.confidence !== null
              ? ` (confidence ${finding.confidence})`
              : ""
          }: ${finding.name}`,
      ),
      `Summary: ${genuine} genuine, ${dismissed} dismissed, ${uncertain} unverifiable — advisory only; routing stays deterministic.${blind}`,
    ].join("\n"),
  };
}

function verdictMark(verdict: string): string {
  return verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
}
