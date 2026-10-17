import { PRESET_JUDGE_TIMEOUT_MS } from "../../lib/preset-judge.mjs";

export type PresetJudgeResult = {
  ok: boolean;
  text: string | null;
  error: string | null;
};
export type PresetJudgeArgs = {
  presetId: string;
  projectId: string | null;
  title: string;
  prompt: string;
  timeoutMs?: number;
};
type RunnerDeps = {
  bb: unknown;
  getPresetById: (id: string) => unknown | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
};

void PRESET_JUDGE_TIMEOUT_MS;

/**
 * Deterministic preset-judge stub. The hidden-LLM judge thread
 * (hidden thread spawning) is removed: every decision resolves through the
 * single deterministic decision-api point, and preset mode degrades to
 * built-in rules. This entry point stays so callers keep one shape, but
 * it never spawns and always fails closed with a naming error.
 */
function judgeDisabled(): PresetJudgeResult {
  return {
    ok: false,
    text: null,
    error: "preset judge disabled: decisions resolve via the Decision API or built-in rules",
  };
}

function judgeWithPreset(
  _deps: RunnerDeps,
  _args: PresetJudgeArgs,
): Promise<PresetJudgeResult> {
  return Promise.resolve(judgeDisabled());
}

export function createPresetJudgeRunner(
  options: Omit<RunnerDeps, "now" | "sleep" | "pollMs"> & {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
  },
) {
  const deps: RunnerDeps = {
    ...options,
    now: options.now ?? Date.now,
    sleep:
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    pollMs: options.pollMs ?? 5000,
  };
  return judgeWithPreset.bind(null, deps);
}
