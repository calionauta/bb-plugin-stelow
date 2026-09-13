// Type declarations for lib/preview-runtime.mjs
import type { ChildProcess } from "node:child_process";
import type { PreviewView } from "./preview-session.mjs";

/** What a preview needs to know about where it runs. */
export interface PreviewTarget {
  /** The checkout the card's code lives in — a worker worktree or the project source. */
  checkout: string;
  hostId: string | null | undefined;
  /** The card's name, used to pick between several app directories by convention. */
  slug?: string | null;
  /** In the user's words, where this checkout came from (worker worktree vs project source). */
  source?: string | null;
  environment?: unknown;
}

export interface PreviewResult {
  ok: boolean;
  error: string | null;
}

export interface PreviewEffects {
  /** One file's text, or null when it is absent or unreadable. */
  readFile(path: string): Promise<string | null>;
  /** Child directory names of a directory; [] when it cannot be read. */
  listDirs(dir: string): string[];
  joinPath(...parts: string[]): string;
  spawnProcess(command: string, options: { cwd: string; env: Record<string, string> }): ChildProcess;
  /** `bb connect <args> --json`, parsed; null when unpaired, unsupported or unparseable. */
  runConnect(args: string[]): Promise<Record<string, unknown> | null>;
  now?(): number;
  baseEnv?: Record<string, string>;
  /** Bound on `starting` before the session fails with its log (default 60s). */
  startTimeoutMs?: number;
}

export declare const PREVIEW_START_TIMEOUT_MS: number;

export interface PreviewRuntime {
  start(target: PreviewTarget): Promise<PreviewResult>;
  stop(target: PreviewTarget): Promise<PreviewResult>;
  view(target: PreviewTarget, appOrigin?: string | null): Promise<PreviewView>;
  /** Retry the Connect share for a live preview (the "Share this port" button). */
  share(target: PreviewTarget): Promise<PreviewResult>;
  /** Kill every preview this runtime started. Safe to call more than once. */
  dispose(): void;
}

export declare function createPreviewRuntime(effects: PreviewEffects): PreviewRuntime;
