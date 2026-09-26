import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { checkAdvanceContracts } from "../../lib/advance-contracts.mjs";
import { requiredForStage } from "../../lib/question-contracts.mjs";
import { parseWorkflowConfig } from "../../lib/workflow-config.mjs";
import type { WorkerCard } from "../workers-types.js";

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

function requiredContracts(state: string): {
  stage: string;
  enteredAt: number;
  contracts: Contract[];
} | null {
  const stage = state.match(/^current_stage:\s*(\S+)/m)?.[1]?.trim() ?? "";
  const { appetite, reviewMode, reviewGates } = parseWorkflowConfig(state, {
    strict: true,
  });
  if (!stage || !appetite || (!reviewMode && !reviewGates)) return null;
  let contracts: Contract[];
  try {
    contracts = requiredForStage({
      stage,
      appetite,
      reviewMode: reviewGates ?? reviewMode ?? [],
    }).filter((entry) => entry.kind !== "skip");
  } catch {
    return null;
  }
  const enteredAt = stageEnteredAt(state);
  return contracts.length > 0 && enteredAt !== null
    ? { stage, enteredAt, contracts }
    : null;
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
    const receipts = await collectReceipts(deps, stateDir);
    if (!receipts) return null;
    const synced = await deps.syncOpenQuestionInbox(card);
    if (synced === null) return null;
    return checkAdvanceContracts({
      stage: required.stage,
      enteredAt: required.enteredAt,
      contracts: required.contracts,
      receipts,
      answered: answeredSinceEntry(deps, card, required.enteredAt),
    });
  };
}
