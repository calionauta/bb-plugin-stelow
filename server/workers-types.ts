import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type WorkerCard = {
  id: string;
  project_id: string;
  name: string;
  display_name: string | null;
  prompt: string;
  intent: string;
  status: string;
  stage: string;
  activity: string;
  worker_thread_id: string | null;
  worker_preset_id: string | null;
  preset_restart_pending: number | null;
  dir_hash: string | null;
  auto_continue_count: number | null;
  auto_continue_stage: string | null;
  spawn_retry_count: number | null;
  spawn_retry_thread: string | null;
  attachments: string;
  workspace_kind: "project" | "exploratory";
  workspace_path: string | null;
  workspace_host_id: string | null;
  kind: "build" | "research" | "explore";
  research_strategy: string | null;
  research_strategies: string | null;
  explore_stage: string | null;
  last_error: string | null;
  last_assistant_text: string | null;
  last_idle_at: number | null;
  environment_label: string | null;
  created_at: number;
  updated_at: number;
};

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

export type WorkerScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type WorkerSpawnArgs = SpawnArgs;
