/**
 * The GitHub seam: every call Stelow makes to the builtin `github` plugin.
 *
 * Thin typed wrappers, nothing more. The github plugin owns its auth, sync,
 * and cache; Stelow only reads tagged issues, mirrors comments, and (for
 * issue creation) clears the trigger label after import. Nothing here decides
 * policy — the slices above it own that.
 */
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { sortedUnion } from "../lib/github-lists.mjs";
import { githubUnavailableStatus, type GithubStatus } from "./github-status.js";

export type { GithubStatus };

export interface GithubPluginStatus {
  ghOk: boolean;
  ghState: string;
  repos: Array<{ repo: string; projectId: string | null }>;
  lastSyncedAt: string | null;
}

/** What the SDK accepts as an RPC input — the plugin bridge takes JSON. */
type GithubRpcInput = string | number | boolean | null | GithubRpcInput[] | { [key: string]: GithubRpcInput };

export interface GithubIssueItem {
  repo: string;
  number: number;
  kind: string;
  title: string;
  state: string;
  author: string;
  labels: string[];
  url: string;
  body: string;
  updatedAt: string;
  assignees?: unknown;
}

export interface GithubIssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface GithubIssueDetail extends GithubIssueItem {
  comments: GithubIssueComment[];
}

export type GithubResolvedStatus = GithubStatus;

export interface GithubClient {
  status: () => Promise<GithubPluginStatus>;
  listItems: (input: { kind?: "issue" | "pr"; state?: "open" | "closed"; repo?: string }) => Promise<{ items: GithubIssueItem[] }>;
  getIssue: (input: { repo: string; number: number }) => Promise<{ issue: GithubIssueDetail }>;
  setLabels: (input: { repo: string; number: number; labels: string[] }) => Promise<{ ok: boolean; labels: string[] }>;
  assignableUsers: (input: { repo: string }) => Promise<{ users: string[] }>;
  repositoryLabels: (input: { repo: string }) => Promise<{ labels: string[] }>;
  commentIssue: (input: { repo: string; number: number; body: string }) => Promise<{ ok: boolean }>;
  setIssueState: (input: { repo: string; number: number; state: "open" | "closed" }) => Promise<{ ok: boolean }>;
  /** Availability + auth. Never throws. */
  statusResolved: () => Promise<GithubResolvedStatus>;
  /** Per-repo picker data, fail-soft per repo. */
  pickers: (repos: string[]) => Promise<{ labels: string[]; assignees: string[] }>;
}

/**
 * A plugin that is genuinely missing is an answer, not a failure: `ok` stays
 * true so the board can say "not installed" over "not reachable".
 */
function resolveStatusFailure(message: string): GithubResolvedStatus {
  const pluginMissing = /plugin.*(not.*found|missing|unavailable)|github.*not/i.test(message);
  return { ...githubUnavailableStatus(), ok: pluginMissing };
}

export function createGithubClient(bb: BbPluginApi): GithubClient {
  const call = <T>(method: string, input: GithubRpcInput): Promise<T> =>
    bb.sdk.plugins.callRpc<T>({ pluginId: "github", method, input, outputSchema: z.any() });

  const status = () => call<GithubPluginStatus>("status", null);
  const listItems = (input: { kind?: "issue" | "pr"; state?: "open" | "closed"; repo?: string }) =>
    call<{ items: GithubIssueItem[] }>("listItems", { state: "open", ...input });
  const getIssue = (input: { repo: string; number: number }) => call<{ issue: GithubIssueDetail }>("getIssue", input);
  const setLabels = (input: { repo: string; number: number; labels: string[] }) => call<{ ok: boolean; labels: string[] }>("setLabels", input);
  const assignableUsers = (input: { repo: string }) => call<{ users: string[] }>("assignableUsers", input);
  const repositoryLabels = (input: { repo: string }) => call<{ labels: string[] }>("repositoryLabels", input);
  const commentIssue = (input: { repo: string; number: number; body: string }) => call<{ ok: boolean }>("commentIssue", input);
  const setIssueState = (input: { repo: string; number: number; state: "open" | "closed" }) => call<{ ok: boolean }>("setIssueState", input);

  async function statusResolved(): Promise<GithubResolvedStatus> {
    try {
      const result = await status();
      return { ok: true, pluginAvailable: true, ghOk: Boolean(result.ghOk), repos: result.repos ?? [] };
    } catch (error) {
      return resolveStatusFailure(error instanceof Error ? error.message : "");
    }
  }

  // Alphabetical pickers over EXISTING things, not just what's on open
  // issues: assignable users and repo labels per tracked repo, fail-soft per
  // repo so one rejection never empties the pickers.
  async function pickers(repos: string[]): Promise<{ labels: string[]; assignees: string[] }> {
    const labelLists: unknown[] = [];
    const userLists: unknown[] = [];
    await Promise.all(repos.map(async (repo) => {
      try {
        labelLists.push((await repositoryLabels({ repo })).labels);
      } catch { /* repo unreachable — derived lists still cover it */ }
      try {
        userLists.push((await assignableUsers({ repo })).users);
      } catch { /* same */ }
    }));
    return { labels: sortedUnion(labelLists), assignees: sortedUnion(userLists) };
  }

  return { status, listItems, getIssue, setLabels, assignableUsers, repositoryLabels, commentIssue, setIssueState, statusResolved, pickers };
}
