// Type declarations for lib/preview-reach.mjs
export declare const PREVIEW_PROVIDERS: readonly string[];
export declare function isLoopbackHost(host: unknown): boolean;
export declare function browseHost(host: unknown): string;
export declare function localPreviewUrl(port: unknown): string | null;
export declare function parseShareExpose(raw: unknown): { url: string; port: number | null; hostId: string | null } | null;
export interface PreviewReach {
  provider: "declared" | "share" | "local";
  url: string;
  port: number | null;
  reason: string;
}
export declare function resolvePreviewReach(options?: {
  port?: number | null;
  declared?: { url?: string | null; port?: number | null } | null;
  share?: unknown;
  paired?: boolean;
  localOnly?: boolean;
}): PreviewReach | null;
export declare function previewFrameVerdict(url: string, options?: { appOrigin?: string | null; frames?: boolean } ): { mode: "frame" | "open" | "copy"; reason: string };
export declare function reachLabel(reach: PreviewReach | null): string;
