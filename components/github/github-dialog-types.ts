/**
 * The shapes the GitHub dialog's two tabs and their shared chrome agree on.
 * They are named here rather than in the composition root so a tab can be read,
 * and a tab component typed, without opening the dialog's state hook.
 */

export type GithubStatus = {
  ok: boolean;
  pluginAvailable: boolean;
  ghOk: boolean;
  repos: Array<{ repo: string; projectId: string | null }>;
};

export type GithubProject = { id: string; name: string };

export type GithubCandidate = {
  repo: string;
  number: number;
  title: string;
  labels: string[];
  author: string;
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
  projectId: string | null;
  alreadyImported: boolean;
  cardId: string | null;
  cardName: string | null;
  cardStatus: string | null;
  postedAt: number | null;
  related: string[];
};

export type AutomationRule = {
  id: string;
  projectId: string;
  labels: string[];
  trustedAuthors: string[];
  promptTemplate: string;
  startImmediate: boolean;
  enabled: boolean;
};

export type RulePreview = {
  labels: string[];
  matches: Array<{ repo: string; number: number; title: string; url: string; author: string }>;
  skipped: Array<{ repo: string; number: number; title: string; reason: string; owner: string | null }>;
};

export type RuleRunEntry = {
  sourceKey: string;
  repo: string;
  number: number;
  cardName: string | null;
  cardStatus: string | null;
  outcome: string | null;
  firedAt: number;
};

// Run outcomes in plain words; null predates outcome tracking.
export const RULE_RUN_OUTCOME: Record<string, string> = {
  started: "Started",
  parked: "Parked",
  "already-imported": "Already imported",
};

// Dry-run skip reasons in plain language (server sends the codes).
export const RULE_SKIP_REASON: Record<string, string> = {
  "missing-labels": "missing a watched label",
  "other-project": "belongs to another project",
  "already-fired": "already drafted by a rule",
  "already-imported": "already imported",
};

export type GithubTab = "import" | "auto";
