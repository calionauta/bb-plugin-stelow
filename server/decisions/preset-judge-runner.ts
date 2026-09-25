import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  PRESET_JUDGE_POLL_MS,
  PRESET_JUDGE_TIMEOUT_MS,
} from "../../lib/preset-judge.mjs";
import type { PresetRow } from "../preset-contracts.ts";

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
  bb: BbPluginApi;
  getPresetById: (id: string) => PresetRow | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
};

const failed = (error: string): PresetJudgeResult => ({
  ok: false,
  text: null,
  error,
});

async function readCompletedOutput(
  deps: RunnerDeps,
  threadId: string,
): Promise<PresetJudgeResult> {
  const output = await deps.bb.sdk.threads
    .output({ threadId })
    .catch(() => null);
  const text = output?.output ?? null;
  return typeof text === "string" && text.length > 0
    ? { ok: true, text, error: null }
    : failed("Preset judge returned no output.");
}

async function waitForCompletion(
  deps: RunnerDeps,
  threadId: string,
  deadline: number,
): Promise<PresetJudgeResult> {
  for (;;) {
    const live = await deps.bb.sdk.threads
      .get({ threadId })
      .catch(() => null);
    const status = (live as { status?: string } | null)?.status ?? null;
    if (status === "idle" || status === "error") {
      return readCompletedOutput(deps, threadId);
    }
    if (deps.now() >= deadline) return failed("Preset judge timed out.");
    await deps.sleep(deps.pollMs);
  }
}

function spawnPresetThread(
  deps: RunnerDeps,
  args: PresetJudgeArgs,
  preset: PresetRow,
) {
  // delegation-site: preset-judge
  return deps.bb.sdk.threads.spawn({
    projectId: args.projectId!,
    environment: { type: "project-default" },
    visibility: "hidden",
    title: args.title,
    providerId: preset.provider_id,
    model: preset.model_id,
    reasoningLevel: preset.reasoning_level as
      | "low" | "medium" | "high" | "xhigh" | "max" | "none" | "ultra" | "ultracode",
    permissionMode: preset.permission_mode as "accept-edits" | "auto" | "full",
    input: [{ type: "text", mentions: [], text: args.prompt }],
  });
}

async function cleanupPresetThread(deps: RunnerDeps, threadId: string) {
  await deps.bb.sdk.threads.stop({ threadId }).catch(() => null);
  await deps.bb.sdk.threads.archive({ threadId }).catch(() => null);
}

async function runPresetJudge(
  deps: RunnerDeps,
  args: PresetJudgeArgs,
  preset: PresetRow,
  timeoutMs: number,
): Promise<PresetJudgeResult> {
  let threadId: string | null = null;
  try {
    const thread = await spawnPresetThread(deps, args, preset);
    threadId = thread.id;
    return await waitForCompletion(deps, threadId, deps.now() + timeoutMs);
  } catch (error) {
    return failed(error instanceof Error ? error.message : "Preset judge failed.");
  } finally {
    if (threadId) await cleanupPresetThread(deps, threadId);
  }
}

function judgeWithPreset(
  deps: RunnerDeps,
  args: PresetJudgeArgs,
): Promise<PresetJudgeResult> {
  const preset = deps.getPresetById(args.presetId);
  if (!preset) return Promise.resolve(failed(`Unknown preset "${args.presetId}".`));
  if (!args.projectId) {
    return Promise.resolve(failed("Preset judging needs a project."));
  }
  const timeoutMs = args.timeoutMs ?? PRESET_JUDGE_TIMEOUT_MS;
  return runPresetJudge(deps, args, preset, timeoutMs);
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
    pollMs: options.pollMs ?? PRESET_JUDGE_POLL_MS,
  };
  return judgeWithPreset.bind(null, deps);
}
