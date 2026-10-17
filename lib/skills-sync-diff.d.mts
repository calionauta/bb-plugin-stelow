// Type declarations for lib/skills-sync-diff.mjs

export const STATE_FILE: string;
export const CORE_SKILLS: string[];
export const WORKFLOW_SKILLS: string[];
export interface SingleFileSpec {
  repoPath: string;
  stateKey: string;
  localRel: string;
  optional?: boolean;
}
export const SINGLE_FILES: SingleFileSpec[];
export const EXECUTION_ASSET_PREFIXES: string[];
export function assertSingleFilePresent(
  entry: { sha: string } | undefined,
  opts: { repoPath: string; optional?: boolean; log: (msg: string) => void },
): void;
export function walk(rootDir: string, dir?: string): Array<{ rel: string; abs: string }>;
export function loadState(stateFile: string): Record<string, unknown>;
export function saveState(stateFile: string, state: Record<string, unknown>): void;
export function defaultStateFile(targetDir: string): string;
export const SYNC_TIMESTAMP_KEY: string;
export function readLastSyncAt(stateFile: string): number | null;
export function readPinnedStelowSource(repoRoot: string): { version: string; commit: string };
export function fileMode(path: string): number | null;
export function localGitBlobSha(path: string): string;
export function gitBlobSha(content: Uint8Array | string): string;
export interface ForkEntry {
  path?: string;
  area?: string;
  reason: string;
  ref?: string;
  status?: string;
}
export interface ForkAllowlist {
  pin: string;
  upstream_version: string;
  forks: ForkEntry[];
}
export function readUpstreamForks(repoRoot: string): ForkAllowlist;
export interface DriftEntry {
  path: string;
  kind: "modified" | "extra-local" | "missing-local";
}
export function diffFileMaps(local: Map<string, string>, remote: Map<string, string>): DriftEntry[];
export function applyAllowlist(
  diffs: DriftEntry[],
  allowlist: Partial<ForkAllowlist>,
): { listed: Array<DriftEntry & { reason: string }>; unlisted: DriftEntry[]; stale: string[] };
