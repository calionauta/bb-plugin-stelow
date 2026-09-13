// Type declarations for lib/preview-session.mjs
export declare const PREVIEW_LOG_LIMIT: number;
export declare const PREVIEW_PORT_MIN: number;
export declare const PREVIEW_PORT_MAX: number;
export declare const PREVIEW_MAX_SESSIONS: number;
export declare function previewSourceLabel(environment: { isWorktree?: boolean; workspaceProvisionType?: string | null; branchName?: string | null } | null | undefined): string;
export declare const PREVIEW_STATES: readonly string[];
export declare function previewKey(hostId: string | null | undefined, path: string | null | undefined): string;
export interface PreviewLogState {
  lines: string[];
  carry: string;
}
export declare function appendLog(state: Partial<PreviewLogState> | null | undefined, chunk: unknown, limit?: number): PreviewLogState;
export declare function previewLogText(state: Partial<PreviewLogState> | null | undefined): string;
export declare function pickPort(preferred: number | null | undefined, taken?: number[], options?: { min?: number; max?: number }): number | null;
export interface PreviewHint {
  tone: "info" | "warn";
  text: string;
  action: string | null;
}
export declare function previewHints(options?: {
  paired?: boolean;
  reach?: { provider: string } | null;
  effectiveUrl?: string | null;
  hasServerAccessProvider?: boolean;
}): PreviewHint[];
export declare function previewTransparency(options: {
  detection: { framework: string; evidence: string } | null;
  command: string;
  port: number | null;
  checkout: string;
  provider?: string | null;
}): { stack: string; evidence: string; command: string; port: number | null; checkout: string; provider: string | null } | null;
export declare function previewAction(state: string, hasDetection: boolean): "start" | "stop" | "none";
export type PreviewState = "stopped" | "starting" | "running" | "failed";
export type PreviewFrameMode = "frame" | "open" | "copy";
export interface PreviewView {
  available: boolean;
  error: string | null;
  checkout: string | null;
  source: string | null;
  label: string | null;
  evidence: string | null;
  state: PreviewState;
  command: string | null;
  port: number | null;
  url: string | null;
  provider: string | null;
  reason: string | null;
  frame: PreviewFrameMode | null;
  frameReason: string | null;
  paired: boolean;
  hints: PreviewHint[];
  log: string;
  startedAt: number | null;
}
export declare const EMPTY_PREVIEW: PreviewView;
export declare function previewShape(options?: {
  detection?: { framework: string; evidence: string; port?: number | null; frames?: boolean } | null;
  declared?: { url?: string | null; port?: number | null } | null;
  session?: { port?: number | null; command?: string; state?: PreviewState; error?: string | null; startedAt?: number; log?: Partial<PreviewLogState> } | null;
  paired?: boolean;
  share?: unknown;
  checkout?: string | null;
  error?: string | null;
  appOrigin?: string | null;
  source?: string | null;
}): PreviewView;
export declare function previewText(view: PreviewView | null | undefined): string;
