// Type declarations for lib/preview-lifecycle.mjs
import type { PreviewSession } from "./preview-session-store.mjs";

export interface PreviewTarget {
  checkout: string;
  hostId: string | null;
  slug?: string;
  source?: string | null;
}

export interface PreviewDeps {
  now: () => number;
  baseEnv: Record<string, string>;
  startTimeoutMs: number;
  spawnProcess: (command: string | null, options: { cwd: string; env: Record<string, string> }) => unknown;
  store: {
    all: () => PreviewSession[];
    live: () => PreviewSession[];
    under: (hostId: string | null | undefined, checkout: string | null | undefined) => PreviewSession[];
    liveUnder: (hostId: string | null | undefined, checkout: string | null | undefined) => PreviewSession[];
    has: (key: string) => boolean;
    set: (session: PreviewSession) => unknown;
    delete: (key: string) => boolean;
    clear: () => void;
  };
  connect: {
    isPaired: () => Promise<boolean>;
    exposeUrl: (port: number) => Promise<string | null>;
    unexpose: (port: number) => Promise<void>;
  };
  appRootAt: (checkout: string, slug?: string) => Promise<{ detection: unknown; declared: unknown; root: string }>;
  supervisor: {
    spawn: (session: PreviewSession, options: { spawnProcess: PreviewDeps["spawnProcess"]; cwd: string; env: Record<string, string> }) => { ok: boolean; error: string | null };
    clearTimer: (session: PreviewSession) => void;
    kill: (session: PreviewSession) => void;
  };
}

export interface PreviewRuntime {
  start: (target: PreviewTarget) => Promise<{ ok: boolean; error: string | null }>;
  stop: (target: PreviewTarget) => Promise<{ ok: boolean; error: string | null }>;
  view: (target: PreviewTarget, appOrigin?: string | null) => Promise<Record<string, unknown>>;
  dispose: () => void;
  share: (target: PreviewTarget) => Promise<{ ok: boolean; error: string | null }>;
}

export declare function createPreviewLifecycle(deps: PreviewDeps): PreviewRuntime;
export declare function startPreview(deps: PreviewDeps, target: PreviewTarget): Promise<{ ok: boolean; error: string | null }>;
export declare function stopPreviews(deps: PreviewDeps, target: PreviewTarget): Promise<{ ok: boolean; error: string | null }>;
export declare function sharePreview(deps: PreviewDeps, target: PreviewTarget): Promise<{ ok: boolean; error: string | null }>;
export declare function previewView(deps: PreviewDeps, target: PreviewTarget, appOrigin?: string | null): Promise<Record<string, unknown>>;
export declare function disposePreviews(deps: PreviewDeps): void;
