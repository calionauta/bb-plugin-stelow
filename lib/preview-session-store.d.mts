// Type declarations for lib/preview-session-store.mjs

export interface PreviewSession {
  key: string;
  checkout: string;
  command: string | null;
  port: number;
  state: "stopped" | "starting" | "running" | "failed";
  log: { lines: string[]; carry: string };
  error: string | null;
  share: string | null;
  child: unknown;
  timer: unknown;
}

export declare function isLive(session: PreviewSession): boolean;
export declare function createSessionStore(): {
  all: () => PreviewSession[];
  live: () => PreviewSession[];
  under: (hostId: string | null | undefined, checkout: string | null | undefined) => PreviewSession[];
  liveUnder: (hostId: string | null | undefined, checkout: string | null | undefined) => PreviewSession[];
  has: (key: string) => boolean;
  set: (session: PreviewSession) => Map<string, PreviewSession>;
  delete: (key: string) => boolean;
  clear: () => void;
};
