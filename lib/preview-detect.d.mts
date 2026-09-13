// Type declarations for lib/preview-detect.mjs
export declare const PREVIEW_CONFIG_REL: string;
export declare const PREVIEW_PROBE_FILES: readonly string[];
export declare const PREVIEW_TIERS: readonly string[];
export declare const PREVIEW_SKIP_DIRS: readonly string[];
export declare function previewAppDirs(names: unknown): string[];
export declare function pickAppDir(detecting: unknown, slug?: string | null): string | null;
export interface PreviewSnapshot {
  exists(rel: string): boolean;
  read(rel: string): string | null;
}
export interface PreviewDetection {
  framework: string;
  command: string;
  port: number | null;
  portFlag: string | null;
  tier: string;
  evidence: string;
  frames?: boolean;
  url?: string | null;
}
export declare function previewSnapshot(files: Map<string, string> | Record<string, string>): PreviewSnapshot;
export declare function parseDeclaredPreview(raw: unknown): { command: string; port: number | null; url: string | null; framework: string } | null;
export declare function parsePreviewUrl(text: unknown): { url: string; port: number } | null;
export declare function previewReady(output: string, port: number | null): { url: string; port: number } | null;
export declare function previewFailed(output: string): string | null;
export declare function detectPreview(snapshot: PreviewSnapshot, options?: { declared?: string | null; allowStatic?: boolean; dir?: string | null }): PreviewDetection | null;
export declare function previewCommand(detection: PreviewDetection | null, port: number | null): string;
export declare function previewLabel(detection: PreviewDetection | null): string;
