import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createPublicationOperations } from "./artifacts-publication-operations.js";
import {
  snapshotSchema,
  type ArtifactsPublicationDeps,
  type Db,
  type PublicationCard,
  type PublicationCheckout,
  type PublicationEnvironment,
  type PublicationSnapshot,
} from "./artifacts-publication-types.js";

export type {
  ArtifactsPublicationDeps,
  Db,
  PublicationCard,
  PublicationCheckout,
  PublicationEnvironment,
  PublicationSnapshot,
};
export { snapshotSchema };

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
