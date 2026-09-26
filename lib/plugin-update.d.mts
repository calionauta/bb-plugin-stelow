export declare function selectOwnEntry(entries: unknown, pluginId: string): { id: string; outcome: string; installed?: { version?: unknown; display?: unknown }; candidate?: { version?: unknown; display?: unknown }; detail?: unknown } | null;
export declare function mapUpdateEntry(entry: unknown): {
  outcome: "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
};
export declare function shortRef(version: unknown, display: unknown): string | null;
export declare function isPathInstall(display: unknown): boolean;
export declare function updateAvailableFrom(info: unknown): boolean;
export declare function updateComparison(version: unknown, githubRelease: unknown): {
  installed: string | null;
  published: string | null;
  state: "current" | "behind" | "ahead" | "unknown";
};
export interface GithubReleaseInfo {
  tag: string;
  url: string;
  checkedAt: number;
  newer: boolean;
}
export interface BuildInfo {
  version: string;
  builtAt: string | null;
  stelowVersion: string | null;
  skills: string[];
  pluginUpdate: PluginUpdateVerdict;
  githubRelease: GithubReleaseInfo | null;
}
export interface PluginUpdateState {
  confirming: boolean;
  updating: boolean;
  checking: boolean;
  error: string | null;
  notice: string | null;
  buildInfo?: BuildInfo | null;
  updateAvailable?: boolean;
}
export interface PluginUpdateCheckResult {
  pluginUpdate: PluginUpdateVerdict;
  githubRelease: GithubReleaseInfo | null;
}
export interface PluginUpdateApplyResult {
  applied: boolean;
  detail?: string | null;
  to?: string | null;
}
export declare function initialPluginUpdateState(): PluginUpdateState;
export declare function beginPluginUpdateCheck(previous: PluginUpdateState): PluginUpdateState;
export declare function completePluginUpdateCheck(previous: PluginUpdateState, buildInfo: BuildInfo | null, result: PluginUpdateCheckResult): PluginUpdateState;
export declare function failPluginUpdateCheck(previous: PluginUpdateState, cause: unknown): PluginUpdateState;
export declare function beginPluginUpdateApply(previous: PluginUpdateState): PluginUpdateState;
export declare function completePluginUpdateApply(previous: PluginUpdateState, result: PluginUpdateApplyResult, buildInfo: BuildInfo | null): PluginUpdateState;
export declare function failPluginUpdateApply(previous: PluginUpdateState, cause: unknown, applied: boolean): PluginUpdateState;
export declare function timeOutPluginUpdateApply(previous: PluginUpdateState): PluginUpdateState;
export interface PluginUpdateVerdict {
  outcome: "checking" | "unavailable" | "update-available" | "current" | "incompatible" | "pinned";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
  checkedAt: number | null;
}
export declare function applyFailedCheck(previous: PluginUpdateVerdict | null, reason: string, checkedAt?: number): PluginUpdateVerdict;
