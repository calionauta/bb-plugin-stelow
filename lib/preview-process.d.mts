// Type declarations for lib/preview-process.mjs
import type { PreviewSession } from "./preview-session-store.mjs";

export declare const PREVIEW_KILL_GRACE_MS: number;
export declare function clearStartTimer(session: PreviewSession): void;
export declare function killPreviewProcess(session: PreviewSession, killGraceMs?: number): void;
export declare function spawnPreviewProcess(
  session: PreviewSession,
  effects: {
    spawnProcess: (command: string | null, options: { cwd: string; env: Record<string, string> }) => unknown;
    cwd: string;
    env: Record<string, string>;
    startTimeoutMs: number;
    logLimit?: number;
    onReady: (session: PreviewSession) => void | Promise<void>;
    onSettled: (session: PreviewSession, code: number | null) => void;
  },
): { ok: boolean; error: string | null };
export declare function createProcessSupervisor(effects: {
  onReady: (session: PreviewSession) => void | Promise<void>;
  onSettled: (session: PreviewSession, code: number | null) => void;
  startTimeoutMs: number;
  logLimit?: number;
  killGraceMs?: number;
}): {
  spawn: (
    session: PreviewSession,
    options: { spawnProcess: (command: string | null, options: { cwd: string; env: Record<string, string> }) => unknown; cwd: string; env: Record<string, string> },
  ) => { ok: boolean; error: string | null };
  clearTimer: (session: PreviewSession) => void;
  kill: (session: PreviewSession) => void;
};
