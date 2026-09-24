import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createPublicationOperations } from "./artifacts-publication-operations.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export interface PublicationCard {
  id: string;
  status: string;
  workspace_kind: "project" | "exploratory";
  workspace_host_id: string | null;
}

export interface PublicationEnvironment {
  id?: string | null;
  path?: string | null;
  hostId?: string | null;
  isWorktree?: boolean;
}

export interface PublicationCheckout {
  path: string;
  hostId: string | null;
  environmentId: string | null;
  environment: PublicationEnvironment | null;
  source: string;
}

export interface ArtifactsPublicationDeps {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  randomId: (prefix: string) => string;
  cardNotFound: string;
  cards: {
    get: (cardId: string) => PublicationCard | undefined;
    checkout: (card: PublicationCard) => Promise<PublicationCheckout | null>;
  };
  normalizeStatus: (value: unknown) => string;
}

const capabilitySchema = z.object({ available: z.boolean(), reason: z.string().nullable() });

const snapshotSchema = z.object({
  available: z.boolean(),
  message: z.string().nullable(),
  source: z.string().nullable(),
  environmentId: z.string().nullable(),
  isWorktree: z.boolean(),
  branch: z.object({
    current: z.string().nullable(),
    default: z.string().nullable(),
    headSha: z.string().nullable(),
  }).nullable(),
  workingTree: z.object({
    state: z.string(),
    hasUncommittedChanges: z.boolean(),
    files: z.number(),
  }).nullable(),
  mergeBase: z.object({
    branch: z.string(),
    ahead: z.number(),
    behind: z.number(),
    hasCommittedUnmergedChanges: z.boolean(),
  }).nullable(),
  pullRequest: z.object({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    state: z.string(),
    attention: z.string(),
    review: z.string(),
    checks: z.string(),
    mergeability: z.string(),
  }).nullable(),
  pullRequestMessage: z.string().nullable(),
  capabilities: z.object({
    commit: capabilitySchema,
    squashMerge: capabilitySchema,
    markReady: capabilitySchema,
    markDraft: capabilitySchema,
    mergePullRequest: capabilitySchema,
  }),
  events: z.array(z.object({
    id: z.string(),
    action: z.string(),
    message: z.string(),
    commitSha: z.string().nullable(),
    pullRequestUrl: z.string().nullable(),
    createdAt: z.number(),
  })),
});

const commitDiffSchema = z.object({
  found: z.boolean(),
  commitSha: z.string().nullable(),
  shortstat: z.string().nullable(),
  files: z.array(z.object({
    path: z.string(),
    display: z.string(),
    patch: z.string().nullable(),
    binary: z.boolean(),
    changeKind: z.string(),
    additions: z.number(),
    deletions: z.number(),
    truncated: z.boolean(),
    loadMode: z.string(),
  })),
  truncated: z.boolean(),
  error: z.string().nullable(),
});

export type PublicationSnapshot = z.infer<typeof snapshotSchema>;

export const publicationRpcContract = defineRpcContract({
  publicationStatus: {
    experimental_description: "Git publication snapshot: branch, tree, merge-base, PR, capabilities",
    input: z.object({ cardId: z.string() }).strict(),
    output: snapshotSchema,
  },
  publicationCommitDiff: {
    experimental_description: "Read-only diff of one recorded publication commit",
    input: z.object({
      cardId: z.string(),
      commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
    }).strict(),
    output: commitDiffSchema,
  },
  publicationCommit: {
    experimental_description: "Save a local commit in the card's checkout through BB",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), commitSha: z.string().nullable() }),
  },
  publicationSquashMerge: {
    experimental_description: "Squash branch commits into one local commit on the base branch",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), commitSha: z.string().nullable() }),
  },
  publicationPushTerminal: {
    experimental_description: "Push the branch in the card's own terminal and stream the result",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), terminalId: z.string().nullable() }),
  },
  publicationPullPush: {
    experimental_description: "Pull with rebase then push in the card's checkout, the rejected-push fix",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), terminalId: z.string().nullable() }),
  },
  publicationPushTerminals: {
    experimental_description: "Live push shells for a card with readable output tails",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      remote: z.object({ owner: z.string(), repo: z.string(), webUrl: z.string() }).nullable(),
      terminals: z.array(z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        exitCode: z.number().nullable(),
        createdAt: z.number(),
        pushState: z.enum(["waiting", "running", "succeeded", "failed"]),
        pushExit: z.number().nullable(),
        outputTail: z.string().nullable(),
        outputUnavailable: z.boolean(),
      })),
    }),
  },
  publicationPullRequestAction: {
    experimental_description: "Mark a PR ready or draft, or merge it; checks stay authoritative",
    input: z.object({
      cardId: z.string(),
      operation: z.enum(["ready", "draft", "merge"]),
      method: z.enum(["merge", "rebase", "squash"]).optional(),
    }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), pullRequestUrl: z.string().nullable() }),
  },
});

export function runPublicationMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS publication_events (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    commit_sha TEXT,
    pull_request_url TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_publication_events_card
    ON publication_events(card_id, created_at DESC);`);
}

export function createArtifactsPublication(deps: ArtifactsPublicationDeps) {
  return { handlers: createPublicationOperations(deps) };
}
