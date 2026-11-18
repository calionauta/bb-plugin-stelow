// Type declarations for lib/workflow-skills-sync.mjs
//
// This module is a stable facade: it re-exports from `skills-sync-fetch.mjs`
// (network), `skills-sync-diff.mjs` (local state + pure drift core) and
// `skills-sync-swap.mjs` (atomic publish) so historic import paths keep
// resolving. Every name re-exported below is declared, including the ones a
// caller rarely touches: an undeclared re-export made the facade quietly
// narrower than the module it publishes.

export interface SyncResult {
  changed: boolean;
  updated: string[];
  created: string[];
  removed: string[];
  errors: string[];
}

export interface SyncOptions {
  ref: string;
  log?: (msg: string) => void;
  statePath?: string;
}

export type LogFn = (msg: string) => void;

export function syncWorkflowSkills(targetDir: string, opts: SyncOptions): Promise<SyncResult>;

export function readPinnedStelowSource(repoRoot: string): { version: string; commit: string };

export function syncHelperScript(repoRoot: string, opts?: { log?: LogFn; statePath?: string }): Promise<SyncResult>;

export function gitBlobSha(content: Uint8Array | string): string;

export const WORKFLOW_SKILLS: string[];

export const SYNC_TIMESTAMP_KEY: string;

export function readLastSyncAt(stateFile: string): number | null;

/* ---- fetch phase (skills-sync-fetch.mjs) ---- */

export interface TreeBlob {
  path: string;
  sha: string;
}

export interface SkillTreeFile {
  skill: string;
  rel: string;
  sha: string;
}

export const REPO: string;
export const SRC_PREFIX: string;
export const TREE_URL: (ref: string) => string;
export const RAW_URL: (ref: string, path: string) => string;

export function fetchTreeBlobs(ref: string): Promise<TreeBlob[]>;
export function fetchStelowSkillTree(ref: string): Promise<SkillTreeFile[]>;
export function fetchVerifiedBlob(ref: string, repoPath: string, sha: string): Promise<Buffer>;

/* ---- diff phase: state and constants (skills-sync-diff.mjs) ---- */

export interface SyncState {
  [skillOrKey: string]: unknown;
}

export type FileDiffKind = "extra-local" | "modified" | "missing-local";

export interface FileDiff {
  path: string;
  kind: FileDiffKind;
}

export interface AllowlistFork {
  reason: string;
  path?: string;
  area?: string;
}

export interface UpstreamForks {
  pin?: string;
  upstream_version?: string;
  forks: AllowlistFork[];
}

export interface ListedDiff extends FileDiff {
  reason: string;
}

export interface AllowlistVerdict {
  listed: ListedDiff[];
  unlisted: FileDiff[];
  stale: string[];
}

export interface WalkedFile {
  rel: string;
  abs: string;
}

export const STATE_FILE: string;
export const CORE_SKILLS: string[];
export const SINGLE_FILES: string[];
export const EXECUTION_ASSET_PREFIXES: string[];

export function assertSingleFilePresent(rootDir: string, relPath: string): void;
export function walk(rootDir: string, dir?: string): WalkedFile[];
export function loadState(stateFile: string): SyncState;
export function saveState(stateFile: string, state: SyncState): void;
export function defaultStateFile(targetDir: string): string;
export function fileMode(path: string): number | null;
export function localGitBlobSha(path: string): string;
export function readUpstreamForks(repoRoot: string): UpstreamForks;
export function writePinnedRevision(repoRoot: string, pin: { version: string; commit: string }): { version: string; commit: string };
export function diffFileMaps(local: Map<string, string>, remote: Map<string, string>): FileDiff[];
export function applyAllowlist(diffs: readonly FileDiff[], allowlist: UpstreamForks | null | undefined): AllowlistVerdict;
