import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { checkAdvanceContracts } from "../../lib/advance-contracts.mjs";
import { requiredForStage } from "../../lib/question-contracts.mjs";
import { normalizeReviewGates } from "../../lib/review-gates.mjs";
import { parseWorkflowConfig } from "../../lib/workflow-config.mjs";
import type { WorkerCard } from "../workers-types.js";
import { parseCurrentStage } from "../../lib/current-stage.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Receipt = { path: string; content: string; modifiedAtMs: number | null };
type Contract = {
  id: string;
  kind: "human-ask" | "agent-receipt" | "skip";
  receipt: string;
};

type QuestionContractsGateDeps = {
  bb: BbPluginApi;
  db: Db;
  syncOpenQuestionInbox: (card: WorkerCard) => Promise<string[] | null>;
};

function stageEnteredAt(state: string): number | null {
  const values = [...state.matchAll(/^\s+at:\s*([^\n]+)$/gm)];
  const value = values.at(-1)?.[1]?.trim().replace(/["']/g, "") ?? "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type SelectedGate = {
  atom: "tech" | "diff";
  label: string;
  artifact: string;
};

/**
 * The two gate stages the generated catalog cannot contract yet: `plan-gate`
 * is blocked by an upstream conflict and `diff-gate` reviews the working tree,
 * not a document. The methodology still says both block when their atom is
 * selected, so the host enforces that fact here — scoped to the atom the card
 * actually selected, never to a guessed mode matrix. Unselected gates stay
 * automatic, and unreadable state stays fail-open.
 */
function selectedGate(stage: string, gates: string[]): SelectedGate | null {
  if (stage === "plan-gate" && gates.includes("tech")) {
    return { atom: "tech", label: "technical-plan", artifact: "tech plan" };
  }
  if (stage === "diff-gate" && gates.includes("diff")) {
    return { atom: "diff", label: "code-diff", artifact: "working-tree diff" };
  }
  return null;
}

function gateAnswerRefusal(gate: SelectedGate, stage: string): string {
  return `Refused: the selected ${gate.label} gate needs a human answer on the card before advancing \`${stage}\`. `
    + `Ask with \`bb stelow ask\` and attach the ${gate.artifact} as --artifact; the answer is the gate decision.`;
}

function requiredContracts(state: string): {
  stage: string;
  enteredAt: number;
  contracts: Contract[];
  gate: SelectedGate | null;
} | null {
  const stage = parseCurrentStage(state) ?? "";
  const { quality, explorationCount, reviewMode, reviewGates } = parseWorkflowConfig(state, {
    strict: true,
  });
  if (!stage || !quality || (!reviewMode && !reviewGates)) return null;
  const gate = selectedGate(stage, normalizeReviewGates(reviewGates ?? reviewMode ?? []));
  let contracts: Contract[];
  try {
    contracts = requiredForStage({
      stage,
      explorationCount: explorationCount ?? undefined,
      reviewMode: reviewGates ?? reviewMode ?? [],
    }).filter((entry) => entry.kind !== "skip");
  } catch {
    return null;
  }
  if (contracts.length === 0 && gate === null) return null;
  const enteredAt = stageEnteredAt(state);
  return enteredAt !== null ? { stage, enteredAt, contracts, gate } : null;
}

function pathEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) =>
    typeof entry === "string" ? entry : String(entry?.path ?? ""),
  ).filter(Boolean);
}

async function collectReceipts(
  deps: QuestionContractsGateDeps,
  stateDir: string,
): Promise<Receipt[] | null> {
  const listed = await deps.bb.sdk.files.listPaths({
    path: stateDir,
    includeFiles: true,
    includeDirectories: false,
    limit: 500,
  }).catch(() => null);
  if (!listed) return null;
  const paths = pathEntries(listed.paths);
  return Promise.all(paths.map(async (path) => {
    const file = await deps.bb.sdk.files.read({ path }).catch(() => null);
    const modifiedAtMs = file?.modifiedAtMs;
    return {
      path: path.startsWith(`${stateDir}/`) ? path.slice(stateDir.length + 1) : path,
      content: typeof file?.content === "string" ? file.content : "",
      modifiedAtMs: typeof modifiedAtMs === "number" && Number.isFinite(modifiedAtMs)
        ? modifiedAtMs
        : null,
    };
  }));
}

function answeredSinceEntry(
  deps: QuestionContractsGateDeps,
  card: WorkerCard,
  enteredAt: number,
): boolean {
  return Boolean(
    deps.db.prepare(
      "SELECT 1 FROM inbox_events WHERE card_id = ? AND kind = 'question' "
        + "AND resolved_reason = 'answered' AND resolved_at >= ? LIMIT 1",
    ).get(card.id, enteredAt),
  );
}

export function createQuestionContractsGate(deps: QuestionContractsGateDeps) {
  return async function questionContractsGate(
    card: WorkerCard,
    stateDir: string | null,
  ): Promise<string | null> {
    if (!stateDir) return null;
    const stateFile = await deps.bb.sdk.files
      .read({ path: join(stateDir, "state.md") })
      .catch(() => null);
    const state = typeof stateFile?.content === "string" ? stateFile.content : null;
    if (!state) return null;
    const required = requiredContracts(state);
    if (!required) return null;
    const synced = await deps.syncOpenQuestionInbox(card);
    if (synced === null) return null;
    let answered: boolean;
    try {
      answered = answeredSinceEntry(deps, card, required.enteredAt);
    } catch {
      // An unreadable answer record is unknown, not proof that nobody
      // answered; a guard that cannot read must not invent a deadlock.
      return null;
    }
    if (required.gate && !answered) {
      return gateAnswerRefusal(required.gate, required.stage);
    }
    if (required.contracts.length === 0) return null;
    const receipts = await collectReceipts(deps, stateDir);
    if (!receipts) return null;
    return checkAdvanceContracts({
      stage: required.stage,
      enteredAt: required.enteredAt,
      contracts: required.contracts,
      receipts,
      answered,
    });
  };
}
