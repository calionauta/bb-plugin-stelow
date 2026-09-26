/**
 * The GitHub RPC contract: shapes the UI and the runtime both validate
 * against. One place, so a slice can move without moving the wire format.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const label = z.string().min(1).max(60);
const labelList = z.array(label).min(1).max(10);
const author = z.string().min(1).max(40);
const authorList = z.array(author).max(20);
// Accepts either a list or the comma-separated text the dialog's textarea
// holds; both normalize to the same list before the rule is stored.
const authorInput = z.union([authorList, z.string().max(800)]);

const automationRuleSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  enabled: z.boolean(),
  labels: labelList,
  trustedAuthors: authorList,
  promptTemplate: z.string().max(2_000),
  startImmediate: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// One factory, not a shared instance: each RPC owns its own schema object.
const watchedLabelsSchema = () => z.object({ labels: labelList.optional(), label: label.optional() }).strict();

const candidateIssueSchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  labels: z.array(z.string()),
  author: z.string(),
  assignees: z.array(z.string()),
  url: z.string(),
  body: z.string(),
  updatedAt: z.string(),
  projectId: z.string().nullable(),
  alreadyImported: z.boolean(),
  cardId: z.string().nullable(),
  cardName: z.string().nullable(),
  cardStatus: z.string().nullable(),
  postedAt: z.number().nullable(),
  related: z.array(z.string()),
});

const previewEntrySchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
});

const runSchema = z.object({
  sourceKey: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  cardId: z.string(),
  cardName: z.string().nullable(),
  cardStatus: z.string().nullable(),
  outcome: z.string().nullable(),
  firedAt: z.number(),
});

export const githubRpcContract = defineRpcContract({
  listGithubCandidates: {
    experimental_description: "GitHub issues matching watcher labels, with import state",
    input: watchedLabelsSchema(),
    output: z.object({
      issues: z.array(candidateIssueSchema),
      allLabels: z.array(z.string()),
      allAssignees: z.array(z.string()),
    }),
  },
  importGithubIssue: {
    experimental_description: "Import one GitHub issue as a parked or started card",
    input: z.object({
      projectId: z.string().nullable().optional(),
      repo: z.string(),
      number: z.number().int().positive(),
      labels: z.array(label).max(10).optional(),
      label: label.optional(),
      start: z.boolean().default(true),
      isolated: z.boolean().default(false),
      intent: z.enum(["new-product", "feature", "bugfix", "refactor", "investigate", "unknown"]).optional(),
    }).strict(),
    output: z.object({ ok: z.boolean(), cardId: z.string().nullable(), skipped: z.string().nullable(), error: z.string().nullable() }),
  },
  listAutomationRules: {
    experimental_description: "Per-project GitHub label watchers with recent run outcomes",
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ rules: z.array(automationRuleSchema) }),
  },
  saveAutomationRule: {
    experimental_description: "Create or update a label watcher; fails closed without isolation",
    input: z.object({
      id: z.string().nullable().optional(),
      projectId: z.string(),
      labels: labelList.optional(),
      label: label.optional(),
      trustedAuthors: authorInput.optional(),
      promptTemplate: z.string().max(2_000).optional(),
      enabled: z.boolean().default(true),
      startImmediate: z.boolean().default(false),
    }).strict(),
    output: z.object({ rule: automationRuleSchema, primed: z.number().int().nonnegative() }),
  },
  previewAutomationRule: {
    experimental_description: "Dry-run a label watcher: what would match now, and why not",
    input: z.object({
      projectId: z.string(),
      labels: labelList.optional(),
      label: label.optional(),
      trustedAuthors: authorInput.optional(),
    }).strict(),
    output: z.object({
      matches: z.array(previewEntrySchema),
      skipped: z.array(previewEntrySchema.extend({ reason: z.string(), owner: z.string().nullable() })),
      checkedAt: z.number(),
    }),
  },
  listAutomationRuleRuns: {
    experimental_description: "Recent scheduler runs for one watcher rule",
    input: z.object({ ruleId: z.string(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
    output: z.object({ runs: z.array(runSchema) }),
  },
  deleteAutomationRule: {
    experimental_description: "Delete a label watcher rule",
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  postGithubCompletion: {
    experimental_description: "Post a card completion summary back to its GitHub issue",
    input: z.object({ cardId: z.string(), closeIssue: z.boolean().default(false) }).strict(),
    output: z.object({ ok: z.boolean(), issueUrl: z.string().nullable(), error: z.string().nullable() }),
  },
  createLinkedGithubIssue: {
    experimental_description: "Create a GitHub issue for a card and link it",
    input: z.object({ cardId: z.string(), repo: z.string().nullable().optional() }).strict(),
    output: z.object({ ok: z.boolean(), url: z.string().nullable(), number: z.number().int().positive().nullable(), error: z.string().nullable() }),
  },
  getLinkedDiscussion: {
    experimental_description: "Read-only mirror of the linked GitHub issue comments",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      linked: z.boolean(),
      repo: z.string().nullable(),
      number: z.number().int().positive().nullable(),
      url: z.string().nullable(),
      comments: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.number() })),
      updatedAt: z.number().nullable(),
      canCreate: z.boolean(),
      repos: z.array(z.string()),
    }),
  },
  postIssueComment: {
    experimental_description: "Post a human-approved comment to the linked GitHub issue",
    input: z.object({ cardId: z.string(), body: z.string().min(1).max(60000) }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
});
