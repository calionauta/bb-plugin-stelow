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

// One overload per kind: the parser checks its mode's payload before every
// ok:true return, so an ok:true result always carries the mode's key. The
// mode is keyed in the signature, which is what lets a call site drop its
// shape-mismatch guard instead of re-narrowing an un-narrowed union.
export declare function parsePresetJudgeOutput(options: {
  kind: "choice";
  text?: string | null;
  validChoices?: string[] | null;
}): PresetJudgeChoice | PresetJudgeFailure;
export declare function parsePresetJudgeOutput(options: {
  kind: "criteria";
  text?: string | null;
  validChoices?: string[] | null;
}): PresetJudgeCriteria | PresetJudgeFailure;
