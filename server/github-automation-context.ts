/**
 * The dependency surface every GitHub slice receives, plus the two host
 * policy helpers they all share: the kill switch and warn-once.
 *
 * The slices (migrations, issue flow, comments, completion, rules) each own
 * one job; this module owns nothing but what they cannot own themselves —
 * the shape of the host they plug into.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type GithubDb = ReturnType<BbPluginApi["storage"]["database"]>;

/** Minimal card shape this feature needs — the core CardRow satisfies it. */
export interface GithubCard {
  id: string;
  display_name: string | null;
  name: string;
  prompt: string;
  intent: string;
  stage: string;
  status: string;
}

export interface GithubAutomationDeps {
  db: GithubDb;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  presets: {
    getWorktreePresetId: () => string | null;
    getEffectiveBuildEnvironmentKind: () => string;
    pinCardPreset: (cardId: string, presetId: string) => boolean;
  };
  cards: {
    get: (cardId: string) => GithubCard | undefined;
    create: (args: {
      projectId: string;
      prompt: string;
      attachments: Array<{ path: string; type: "localFile" | "localImage" }>;
      intent: string;
      appetite: string;
      reviewMode: string | string[];
      presetId?: string | null;
      start?: boolean;
    }) => Promise<{ cardId: string; threadId: string | null }>;
    comment: (cardId: string, target: string, targetId: string, author: "user" | "agent", body: string) => string;
    workspace: (card: GithubCard) => Promise<{ path: string; hostId: string | null } | null>;
    scopes: (card: GithubCard, rootPath: string | null) => Array<{ name: string; status: string; tasks: Array<{ status: string }> }>;
    normalizeStatus: (value: unknown) => string;
    statusLabel: (status: string) => string;
  };
}

/**
 * Kill switch: STELOW_GITHUB_ISSUES=0 disables the scheduler and every RPC.
 * Each refusal names the variable, so a disabled host is never a mystery.
 */
export function githubIssuesEnabled(): boolean {
  return process.env.STELOW_GITHUB_ISSUES !== "0";
}

export function requireGithubIssuesEnabled(): void {
  if (!githubIssuesEnabled()) throw new Error("GitHub issues are disabled on this host (STELOW_GITHUB_ISSUES=0).");
}

/**
 * Warn-once key registry. Persistent states (a repo with no project yet, an
 * unreachable issue) retry silently after one line in the log — self-healing,
 * no five-minute spam, and the next fix is visible.
 */
export function createWarnOnce(): (key: string) => boolean {
  const warned = new Set<string>();
  return (key: string) => {
    if (warned.has(key)) return false;
    warned.add(key);
    return true;
  };
}

/**
 * Effective spawn environment for GitHub-created build cards. The
 * band-routed preset wins over any passed preset at spawn time, so the gate
 * must check this — never mere preset existence.
 */
export function effectiveGithubSpawnEnvKind(deps: GithubAutomationDeps): string {
  return deps.presets.getEffectiveBuildEnvironmentKind();
}

/** Default New-worktree preset for auto-started GitHub workers. */
export function resolveWorktreePreset(deps: GithubAutomationDeps): string | null {
  return deps.presets.getWorktreePresetId();
}
