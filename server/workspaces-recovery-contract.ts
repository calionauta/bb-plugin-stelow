import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Publish = (event: string, payload: Record<string, unknown>) => void;

export type RecoveryCard = {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  workspace_kind: "project" | "exploratory";
  workspace_path: string | null;
  workspace_host_id: string | null;
  worker_thread_id: string | null;
  last_assistant_text: string | null;
};

export type RecoveryGitEvidence = {
  isGit: boolean;
  gitRoot: string | null;
  branch: string | null;
  headSha: string | null;
  changedFiles: number;
};

export type RecoveryCandidate = {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
  headSha: string | null;
  changedFiles: number;
  evidence: string;
  gitRoot: string | null;
};

export type RecoveryRow = {
  project_id: string;
  project_name: string;
  source_path: string;
  evidence: string;
  git_root: string | null;
  branch: string | null;
  head_sha: string | null;
  changed_files: number;
};

export type ProjectSource = {
  path: string;
  hostId: string;
  isDefault?: boolean;
};

export type Project = { sources: ProjectSource[] };

export type AuditCardInput = {
  projectId: string;
  environment: {
    type: "host";
    hostId: string;
    workspace: { type: "unmanaged"; path: string };
  };
  prompt: string;
  attachments: Array<{ path: string; type: "localFile" | "localImage" }>;
  intent: "investigate";
  appetite: "Complete";
  reviewMode: "Product Spec + Interface + Tech Review + Code Diff";
  kind: "build";
  start: true;
};

export interface WorkspaceRecoveryDeps {
  db: Db;
  now: () => number;
  publish: Publish;
  cardNotFound: string;
  cardArchived: string;
  cards: {
    get: (cardId: string) => RecoveryCard | undefined;
    create: (input: AuditCardInput) => Promise<{ cardId: string }>;
    comment: (
      cardId: string,
      target: string,
      targetId: string,
      author: "user" | "agent",
      body: string,
    ) => string;
  };
  gitEvidence: (path: string) => Promise<RecoveryGitEvidence>;
  listProjects: () => Promise<Array<{
    id: string;
    name: string;
    sources?: ProjectSource[];
  }>>;
  getProject: (projectId: string) => Promise<Project | null>;
  getThreadOutput: (threadId: string) => Promise<string>;
}

const candidateSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  headSha: z.string().nullable(),
  changedFiles: z.number(),
  evidence: z.string(),
});

export const workspaceRecoveryRpcContract = defineRpcContract({
  workspaceRecovery: {
    experimental_description: "One evidenced next step for work that happened elsewhere",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      kind: z.enum(["attached", "promote", "external-project", "ambiguous", "documents-only"]),
      message: z.string(),
      workspace: z.object({ path: z.string().nullable(), isGit: z.boolean(), hasSource: z.boolean() }),
      candidates: z.array(candidateSchema),
      looseEvidence: z.array(z.object({ path: z.string(), kind: z.enum(["folder", "patch"]) })),
      recovery: z.object({
        projectId: z.string(),
        projectName: z.string(),
        path: z.string(),
        attachedAt: z.number(),
      }).nullable(),
      audit: z.object({ cardId: z.string(), cardName: z.string(), createdAt: z.number() }).nullable(),
      error: z.string().nullable(),
    }),
  },
  attachRecoveryCheckout: {
    experimental_description: "Attach a reviewed registered checkout to an exploratory card",
    input: z.object({ cardId: z.string(), projectId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
  },
  createRecoveryAudit: {
    experimental_description: "Create a build card auditing an attached recovery checkout",
    input: z.object({ cardId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      auditCardId: z.string().nullable(),
      auditCardName: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
});
