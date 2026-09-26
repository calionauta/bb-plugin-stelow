import { evaluateDecisionCall } from "../../lib/decision-api.mjs";
import {
  buildPresetJudgePrompt,
  parsePresetJudgeOutput,
} from "../../lib/preset-judge.mjs";
import { resolveScoredVerdicts } from "../../lib/score-verdicts.mjs";
import type {
  PresetJudgeArgs,
  PresetJudgeResult,
} from "./preset-judge-runner.ts";

export type ScoredBatchItem = { id: string; text: string };
export type ScoredBatchFinding = {
  id: string;
  name: string;
  score: number | null;
  confidence: number | null;
  verdict: string;
  error: string | null;
};
export type ScoredBatchResult =
  | { ok: true; findings: ScoredBatchFinding[] }
  | { ok: false; error: string };

export type ScoredBatchArgs = {
  items: Array<{ id: string; text: string }>;
  questions: Record<string, unknown>;
  keyPrefix: string;
  state: string;
  mode: string;
  presetId: string | null;
  projectId: string | null;
  title: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  routeAt: number;
};

type Judge = (args: PresetJudgeArgs) => Promise<PresetJudgeResult>;
type DecisionCall = typeof evaluateDecisionCall;

function failure(error: string): ScoredBatchResult {
  return { ok: false, error };
}

function verdictRecord(verdicts: Array<{
  id: string;
  status: string;
  confidence: number | null;
}>) {
  return Object.fromEntries(
    verdicts.map((verdict) => [
      verdict.id,
      { status: verdict.status, confidence: verdict.confidence },
    ]),
  );
}

type ScoredJudgeContext = {
  judgeViaPreset: Judge;
  evaluateCall: DecisionCall;
};

async function judgeWithPreset(
  context: ScoredJudgeContext,
  args: ScoredBatchArgs,
): Promise<ScoredBatchResult> {
  if (!args.presetId) return failure("preset mode needs a judge preset");
  const judged = await context.judgeViaPreset({
    presetId: args.presetId,
    projectId: args.projectId,
    title: args.title,
    prompt: buildPresetJudgePrompt({
      kind: "criteria",
      state: args.state,
      questions: args.items.map(({ id, text }) => ({ id, text })),
    }),
  });
  if (!judged.ok || !judged.text) return failure(judged.error ?? "judge failed");
  const parsed = parsePresetJudgeOutput({ kind: "criteria", text: judged.text });
  if (!parsed.ok) return failure(parsed.error);
  return {
    ok: true,
    findings: resolveScoredVerdicts({
      items: args.items,
      verdicts: verdictRecord(parsed.verdicts),
      keyPrefix: args.keyPrefix,
      routeAt: args.routeAt,
    }),
  };
}

async function callForItem(
  context: ScoredJudgeContext,
  args: ScoredBatchArgs,
  item: ScoredBatchItem,
) {
  const key = `${args.keyPrefix}:${item.id}`;
  const result = await context.evaluateCall({
    provider: args.provider,
    endpoint: args.endpoint,
    apiKey: args.apiKey,
    model: args.model,
    state: args.state,
    questions: { [key]: args.questions[key] } as never,
  });
  const answer = result.ok ? result.answers?.[key] ?? null : null;
  return {
    key,
    answer: answer
      ? {
          type: answer.type,
          score: answer.score,
          confidence: answer.confidence ?? undefined,
        }
      : null,
  };
}

async function judgeWithApi(
  context: ScoredJudgeContext,
  args: ScoredBatchArgs,
): Promise<ScoredBatchResult> {
  const answers = await Promise.all(
    args.items.map((item) => callForItem(context, args, item)),
  );
  return {
    ok: true,
    findings: resolveScoredVerdicts({
      items: args.items,
      answers: Object.fromEntries(
        answers.map(({ key, answer }) => [key, answer]),
      ),
      keyPrefix: args.keyPrefix,
      routeAt: args.routeAt,
    }),
  };
}

export function createScoredBatchJudge(
  judgeViaPreset: Judge,
  evaluateCall: DecisionCall = evaluateDecisionCall,
) {
  const context = { judgeViaPreset, evaluateCall };
  return (args: ScoredBatchArgs): Promise<ScoredBatchResult> =>
    args.mode === "preset"
      ? judgeWithPreset(context, args)
      : judgeWithApi(context, args);
}
