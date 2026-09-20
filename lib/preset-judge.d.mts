export declare const PRESET_JUDGE_TIMEOUT_MS: number;
export declare const PRESET_JUDGE_POLL_MS: number;

export declare function buildPresetJudgePrompt(options: {
  kind: "choice" | "criteria";
  state?: string | null;
  questions?: Record<string, unknown> | Array<{ id?: string; text?: string }> | null;
}): string;

export interface PresetJudgeChoice {
  ok: true;
  choice: string;
  confidence: number | null;
}

export interface PresetJudgeCriteria {
  ok: true;
  verdicts: Array<{ id: string; status: "met" | "unmet" | "unverifiable"; confidence: number | null }>;
}

export interface PresetJudgeFailure {
  ok: false;
  error: string;
}

export declare function parsePresetJudgeOutput(options: {
  kind: "choice" | "criteria";
  text?: string | null;
  validChoices?: string[] | null;
}): PresetJudgeChoice | PresetJudgeCriteria | PresetJudgeFailure;
