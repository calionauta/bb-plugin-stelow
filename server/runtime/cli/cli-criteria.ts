import { readFileSync } from "node:fs";
import { resolveArtifactPath } from "../../../lib/artifact-manifest.mjs";
import { judgeArtifactCriteria } from "../../../lib/skill-criteria.mjs";
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
  PRESET_NEEDS_JUDGE,
} from "./cli-judging-route.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE =
  "Usage: bb stelow criteria --skill <skill-id> --artifact <path> [--card <card_id>] [--json]";
const MODE_REFUSAL =
  "Artifact criteria runs in Built-in rules mode. Set it to Decision API or preset judging in Manage agent presets → Decision routers.";

type CriteriaInput = {
  skillArg: string;
  artifactArg: string;
  content: string;
  json: boolean;
};

/** Advisory semantic criteria check: score an artifact against its skill's
 * semantic criteria through the Decision API. Read-only — writes no rows,
 * publishes nothing, blocks nothing. Runs only in api mode with a configured
 * provider; everything else refuses with the fix named. */
export function createCriteriaCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "criteria") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json"],
      valued: ["--card", "--skill", "--artifact"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    if (!scanned.flags.skill)
      return {
        exitCode: 2,
        stderr:
          "Pass --skill <skill-id> (e.g. stelow-workflow-shape-up) or a path under skills/.",
      };
    if (!scanned.flags.artifact)
      return { exitCode: 2, stderr: "Pass --artifact <workspace-relative path>." };
    return runCriteria(deps, card, {
      skillArg: scanned.flags.skill,
      artifactArg: scanned.flags.artifact,
      content: "",
      json,
    });
  };
}

async function runCriteria(
  deps: CliDeps,
  card: WorkerCard,
  input: CriteriaInput,
): Promise<CliResult> {
  const disabled = decisionApiEnabled();
  if (disabled) return disabled;
  const point = judgingPoint(deps, MODE_REFUSAL);
  if ("refusal" in point) return point.refusal;
  const skillText = readSkill(deps, input.skillArg);
  if (typeof skillText !== "string") return skillText.refusal;
  const content = await readArtifact(deps, card, input.artifactArg);
  if (typeof content !== "string") return content.refusal;
  const route = judgingRoute(deps, point.point, point.mode);
  if ("refusal" in route) return route.refusal;
  if (route.mode === "preset" && !route.presetId)
    return { exitCode: 1, stderr: PRESET_NEEDS_JUDGE };
  const judgment =
    route.mode === "preset" && route.presetId
      ? await deps.judgeCriteria({
          presetId: route.presetId,
          projectId: card.project_id,
          skillText,
          artifactText: content,
          routeAt: route.routeAt,
        })
      : await judgeArtifactCriteria({
          provider: route.provider,
          endpoint: route.endpoint,
          apiKey: route.apiKey,
          model: route.model,
          skillText,
          artifactText: content,
          routeAt: route.routeAt,
        });
  if (!judgment.ok)
    return {
      exitCode: 1,
      stderr: `Criteria judging failed: ${judgment.error ?? "call failed"} — built-in rules still apply; retry or check the provider.`,
    };
  return criteriaResult(input, judgment, route);
}

function readSkill(deps: CliDeps, skillArg: string): string | Refusal {
  const skillRel = skillArg.includes("/") ? skillArg : `${skillArg}/SKILL.md`;
  const skillFull = resolveArtifactPath(deps.skillsDir, skillRel);
  let skillText: string | null = null;
  try {
    skillText = skillFull ? readFileSync(skillFull, "utf8") : null;
  } catch {
    skillText = null;
  }
  if (skillText) return skillText;
  return refuse({
    exitCode: 2,
    stderr: `Unknown skill "${skillArg}" — skills live under the plugin's skills/ directory (stelow-*).`,
  });
}

async function readArtifact(
  deps: CliDeps,
  card: WorkerCard,
  artifactArg: string,
): Promise<string | Refusal> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path) return refuse({ exitCode: 1, stderr: ERR_WORKSPACE_UNAVAILABLE });
  const full = resolveArtifactPath(workspace.path, artifactArg);
  const content = full
    ? await deps.bb.sdk.files
        .read({ path: full })
        .then((file) => file.content)
        .catch(() => null)
    : null;
  if (typeof content === "string" && content.trim()) return content;
  return refuse({
    exitCode: 1,
    stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then judge.`,
  });
}

function criteriaResult(
  input: CriteriaInput,
  judgment: { findings: CriteriaFinding[] },
  route: { mode: string; provider: string; presetId: string | null },
): CliResult {
  const summary = criteriaSummary(judgment.findings);
  if (input.json)
    return {
      exitCode: 0,
      stdout: JSON.stringify(
        {
          skill: input.skillArg,
          artifact: input.artifactArg,
          provider: route.provider,
          presetId: route.mode === "preset" ? route.presetId : null,
          findings: judgment.findings,
          summary,
        },
        null,
        2,
      ),
    };
  const judgeLabel =
    route.mode === "preset" && route.presetId
      ? `preset ${route.presetId}`
      : route.provider;
  return {
    exitCode: 0,
    stdout: [
      `Artifact criteria: ${input.skillArg} × ${input.artifactArg} (${judgeLabel}, ${judgment.findings.length} criteria)`,
      ...judgment.findings.map(criteriaLine),
      `Summary: ${summary.met} met, ${summary.unmet} unmet, ${summary.unverifiable} unverifiable — advisory only, never blocking.`,
    ].join("\n"),
  };
}

type CriteriaFinding = {
  id: string;
  verdict: string;
  score: number | null;
  confidence: number | null;
  text: string;
};

type CriteriaTally = { met: number; unmet: number; unverifiable: number };

function criteriaSummary(findings: CriteriaFinding[]): CriteriaTally {
  const met = findings.filter((finding) => finding.verdict === "met").length;
  const unmet = findings.filter((finding) => finding.verdict === "unmet").length;
  return { met, unmet, unverifiable: findings.length - met - unmet };
}

function criteriaLine(finding: CriteriaFinding): string {
  return `${verdictMark(finding.verdict)} ${finding.id} — ${finding.verdict}${
    finding.score !== null
      ? ` (score ${finding.score}, confidence ${finding.confidence ?? "n/a"})`
      : ""
  }: \
${finding.text}`;
}

function verdictMark(verdict: string): string {
  return verdict === "met" ? "✓" : verdict === "unmet" ? "✗" : "?";
}
