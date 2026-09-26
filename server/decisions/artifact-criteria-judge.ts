import {
  groupCriteriaByKind,
  parseCriteriaBlock,
} from "../../lib/skill-criteria.mjs";
import {
  buildPresetJudgePrompt,
  parsePresetJudgeOutput,
} from "../../lib/preset-judge.mjs";
import type {
  PresetJudgeArgs,
  PresetJudgeResult,
} from "./preset-judge-runner.ts";

export type PresetFinding = {
  id: string;
  kind: "semantic";
  text: string;
  score: number | null;
  confidence: number | null;
  verdict: "met" | "unmet" | "unverifiable";
  error: string | null;
};

export type PresetCriteriaResult =
  | { ok: true; findings: PresetFinding[]; evaluated: number }
  | {
      ok: false;
      findings: PresetFinding[];
      evaluated: 0;
      error: string;
    };

type Judge = (args: PresetJudgeArgs) => Promise<PresetJudgeResult>;

export function presetCriteriaFindings({
  verdicts,
  semantic,
  routeAt,
}: {
  verdicts: Array<{ id: string; status: string; confidence: number | null }>;
  semantic: Array<{ id: string; text: string }>;
  routeAt: number;
}): PresetFinding[] {
  const byId = new Map(
    semantic.map((criterion) => [criterion.id, criterion.text]),
  );
  return verdicts
    .filter((verdict) => byId.has(verdict.id))
    .map((verdict) => {
      const confident =
        typeof verdict.confidence === "number" && verdict.confidence >= routeAt;
      return {
        id: verdict.id,
        kind: "semantic" as const,
        text: byId.get(verdict.id) ?? verdict.id,
        score: null,
        confidence: verdict.confidence,
        verdict:
          !confident || verdict.status === "unverifiable"
            ? ("unverifiable" as const)
            : (verdict.status as "met" | "unmet"),
        error: null,
      };
    });
}

const failure = (error: string): PresetCriteriaResult => ({
  ok: false,
  findings: [],
  evaluated: 0,
  error,
});

export function createArtifactCriteriaJudge(judgeViaPreset: Judge) {
  return async function judgePresetCriteria({
    presetId,
    projectId,
    skillText,
    artifactText,
    routeAt,
  }: {
    presetId: string;
    projectId: string | null;
    skillText: string;
    artifactText: string;
    routeAt: number;
  }): Promise<PresetCriteriaResult> {
    const semantic = groupCriteriaByKind(
      parseCriteriaBlock(skillText),
    ).semantic;
    if (semantic.length === 0) {
      return { ok: true, findings: [], evaluated: 0 };
    }
    const prompt = buildPresetJudgePrompt({
      kind: "criteria",
      state: artifactText,
      questions: semantic.map(({ id, text }) => ({ id, text })),
    });
    const judged = await judgeViaPreset({
      presetId,
      projectId,
      title: "Stelow judge: artifact criteria",
      prompt,
    });
    if (!judged.ok || !judged.text) return failure(judged.error ?? "judge failed");

    const parsed = parsePresetJudgeOutput({ kind: "criteria", text: judged.text });
    if (!parsed.ok) return failure(parsed.error);
    if (parsed.verdicts.length === 0) {
      return failure("judge verdicts match no known criteria");
    }
    const findings = presetCriteriaFindings({
      verdicts: parsed.verdicts,
      semantic,
      routeAt,
    });
    return { ok: true, findings, evaluated: findings.length };
  };
}
