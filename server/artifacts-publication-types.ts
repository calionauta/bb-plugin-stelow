import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export interface PublicationCard {
  id: string;
  status: string;
  workspace_kind: "project" | "exploratory" | "worktree";
  workspace_host_id: string | null;
  kind: string;
  intent: string;
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
  cardStatusOf: (value: unknown) => string;
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
  relevanceNote: z.string().nullable(),
  events: z.array(z.object({
    id: z.string(),
    action: z.string(),
    message: z.string(),
    commitSha: z.string().nullable(),
    pullRequestUrl: z.string().nullable(),
    createdAt: z.number(),
  })),
});

export type PublicationSnapshot = z.infer<typeof snapshotSchema>;
export { snapshotSchema };
