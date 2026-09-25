import { join } from "node:path";
import { contractForBuildArtifact } from "../../../lib/artifact-contracts.mjs";
import {
  parseArtifactManifest,
  resolveArtifactPath,
} from "../../../lib/artifact-manifest.mjs";
import { validateArtifact } from "../../../lib/artifact-validation.mjs";
import { exploreArtifactFile } from "../../../lib/research-artifacts.mjs";
import {
  exploreVerifyReport,
  exploreVerifyText,
  researchVerifyReport,
  researchVerifyText,
} from "../../../lib/research-artifacts.mjs";
import { researchStrategyById } from "../../../lib/research-strategies.mjs";
import { techniqueById } from "../../../lib/stage-catalog.mjs";
import { refuse, type CliResult, type Refusal } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { ResearchReadiness } from "../research-artifacts.js";
import type { WorkerCard } from "../../workers-types.js";

export type ReviewSubject = {
  artifactText: string;
  contractLabel: string;
  evidence: "verified" | "hypothesis-only";
  fingerprint: string | null;
};


/** Deterministic precondition: review only sees verify-PASS artifacts. The
 * document must be registered, readable, and pass its stage contract — thin
 * files never reach the reviewer. */
export async function buildDocumentSubject(
  deps: CliDeps,
  card: WorkerCard,
  artifactArg: string,
): Promise<ReviewSubject | Refusal> {
  const workspace = await deps.cardWorkspace(card);
  if (!workspace?.path || !card.dir_hash)
    return refuse({ exitCode: 1, stderr: "No workflow state for this card yet." });
  const stateDir = await deps
    .workflowStateDir(workspace.path, card.id, card.dir_hash)
    .catch(() => null);
  if (!stateDir)
    return refuse({ exitCode: 1, stderr: "No workflow state for this card yet." });
  const stateBlob = await deps.bb.sdk.files
    .read({ path: join(stateDir, "state.md") })
    .then((file) => file.content)
    .catch(() => null);
  const registered = stateBlob
    ? parseArtifactManifest(stateBlob).some((fields) => fields.path === artifactArg)
    : false;
  if (!registered)
    return refuse({
      exitCode: 2,
      stderr: `Unknown artifact "${artifactArg}" — review only registered manifest documents (see the card Artifacts).`,
    });
  const content = await readArtifact(deps, workspace.path, artifactArg);
  if (typeof content !== "string")
    return refuse({
      exitCode: 1,
      stderr: `Artifact "${artifactArg}" is missing or empty — write it first, then review.`,
    });
  const contract = contractForBuildArtifact(artifactArg, content);
  if (!contract)
    return refuse({
      exitCode: 2,
      stderr: `Artifact "${artifactArg}" matches no known stage contract — review covers spec-product, spec-tech, interfaces, testing-strategy, \
and critique reports.`,
    });
  const depth = validateArtifact(content, contract);
  if (!depth.pass)
    return refuse(depthRefusal(artifactArg, depth.failures as DepthFailure[]));
  return {
    artifactText: content,
    contractLabel: `build document (${contract.id})`,
    evidence: "verified",
    fingerprint: null,
  };
}

function readArtifact(
  deps: CliDeps,
  workspacePath: string,
  artifactArg: string,
): Promise<string | null> {
  const full = resolveArtifactPath(workspacePath, artifactArg);
  if (!full) return Promise.resolve(null);
  return deps.bb.sdk.files
    .read({ path: full })
    .then((file) => file.content)
    .catch(() => null);
}

type DepthFailure = { detail: string };

function depthRefusal(artifactArg: string, failures: DepthFailure[]): CliResult {
  return {
    exitCode: 1,
    stderr: `Review refused: deterministic depth fails — fix first, then review (review budget is never spent on thin files).\nFAIL ${artifactArg}: \
${failures
      .map((failure) => failure.detail)
      .slice(0, 3)
      .join("; ")}`,
  };
}

/** The card deliverable for research and explore: the primary round plus the
 * index, or the stage artifact. Both read through the same deterministic
 * verify the sync gate uses, so a non-PASS card never spends review budget. */
export async function deliverableSubject(
  deps: CliDeps,
  card: WorkerCard,
): Promise<ReviewSubject | Refusal> {
  if (card.kind === "research") {
    const readiness = await deps.researchArtifacts
      .researchReadiness(card)
      .catch(() => null);
    if (!readiness)
      return refuse({ exitCode: 1, stderr: "Unable to read card state — retry review." });
    if (!readiness.ready || readiness.invalid.length > 0)
      return refuse(researchVerifyRefusal(deps, card, readiness));
    const history = deps.strategyRounds(card);
    const latest = history[history.length - 1];
    const strategyLabel =
      researchStrategyById(latest?.id ?? "")?.label ?? latest?.id ?? "research";
    const workspace = await deps.cardWorkspace(card);
    const index = await deps.readResearchIndex(card).catch(() => null);
    const indexText = index && index.ok === true ? index.content : "";
    const primary =
      workspace?.path && latest?.file
        ? await deps.bb.sdk.files
            .read({ path: resolveArtifactPath(workspace.path, latest.file) ?? "" })
            .then((file) => file.content)
            .catch(() => null)
        : null;
    return {
      artifactText: `Research index:\n${typeof indexText === "string" ? indexText : ""}\n\nPrimary round:\n${typeof primary === "string" ? primary : ""}`,
      contractLabel: `${strategyLabel} primary round`,
      evidence: readiness.evidence,
      fingerprint: readiness.fingerprint,
    };
  }
  const artifact = await deps.researchArtifacts
    .exploreArtifact(card)
    .catch(() => ({
      ready: false as const,
      fingerprint: null as string | null,
      failures: [] as string[],
    }));
  if (!artifact.ready) {
    const report = exploreVerifyReport(
      card.id,
      card.explore_stage,
      artifact.ready,
      artifact.failures,
    );
    return refuse(verifyRefusal(exploreVerifyText(report)));
  }
  const techniqueLabel =
    techniqueById(card.explore_stage ?? "")?.label ??
    card.explore_stage ??
    "explore";
  const stateDir = await exploreStateDir(deps, card);
  const content = stateDir
    ? await deps.bb.sdk.files
        .read({
          path: join(stateDir, exploreArtifactFile(card.explore_stage ?? "")),
        })
        .then((file) => file.content)
        .catch(() => null)
    : null;
  return {
    artifactText: typeof content === "string" ? content : "",
    contractLabel: `${techniqueLabel} stage deliverable`,
    evidence: "verified",
    fingerprint: artifact.fingerprint,
  };
}

function researchVerifyRefusal(
  deps: CliDeps,
  card: WorkerCard,
  readiness: ResearchReadiness,
): CliResult {
  const report = researchVerifyReport(
    card.id,
    deps.strategyRounds(card).length,
    readiness.ready || readiness.invalid.length > 0,
    readiness.invalid,
    readiness.evidence,
  );
  return verifyRefusal(researchVerifyText(report));
}

function verifyRefusal(textOut: { stdout?: string; stderr?: string }): CliResult {
  return {
    exitCode: 1,
    stderr: `Review refused: deterministic verify fails — fix first, then review \
(review budget is never spent on thin files).\n${
      textOut.stderr ?? textOut.stdout ?? ""
    }`,
  };
}

async function exploreStateDir(
  deps: CliDeps,
  card: WorkerCard,
): Promise<string | null> {
  const workspace = await deps.cardWorkspace(card);
  if (!card.dir_hash || !workspace?.path) return null;
  return deps
    .workflowStateDir(workspace.path, card.id, card.dir_hash)
    .catch(() => null);
}
