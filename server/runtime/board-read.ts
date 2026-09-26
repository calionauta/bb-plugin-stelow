/**
 * Reading the Stelow board: stelow.json plus the per-workflow state files it
 * points at.
 *
 * The board is the only surface that must survive a partially-written
 * workspace, so every read here is fail-soft and reports a refusal the user
 * can act on instead of throwing. A workflow is listed from its tracking
 * entry, then enriched with the stage from its OWN state.md — a project holds
 * several workflows, so a single project-level stage would be a lie.
 *
 * The document list walks the whole state dir, nested areas included, and
 * keeps the manifest's own definition of a deliverable: the gate handler
 * approves a gate against this list, so a machine artifact the layout put in
 * `plans/` has to be findable and the bookkeeping that shares the directory
 * has to stay out.
 */
import { isAbsolute } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  isDeliverableArtifactPath,
  isPublishableArtifactContent,
} from "../../lib/artifact-manifest.mjs";
import { normalizeReviewGates } from "../../lib/review-gates.mjs";
import { workflowSchema } from "../contracts.js";
import { normalizeStatus, workflowScopes } from "../scopes.js";
import { gateReceiptFor } from "./gate-vocabulary.js";
import { array, record, text, type LooseRecord } from "./values.js";
import { join, projectRoot, readJson } from "./root-paths.js";

type Workflow = z.infer<typeof workflowSchema>;
type FilesApi = BbPluginApi["sdk"]["files"];

/**
 * How deep the artifact walk descends. Workflow areas are one level below the
 * state dir (`plans/`, `context/`, `reviews/`), the headroom covers a nested
 * card dir, and the bound is what keeps a cyclic listing from hanging a read.
 */
const MAX_WALK_DEPTH = 4;

export type Board = {
  rootPath: string | null;
  workflows: Workflow[];
  error: string | null;
};

/** Which registered document a workspace file is, by its name prefix. */
function classifyArtifact(
  filename: string,
): Workflow["artifacts"][number]["kind"] {
  if (filename.startsWith("spec-product")) return "product-spec";
  if (filename.startsWith("interfaces")) return "interfaces";
  if (filename.startsWith("spec-tech")) return "tech-plan";
  if (filename.includes("critique")) return "critique";
  return "other";
}

/** One listed path, and whether it is a directory to descend into. */
type DirEntry = { path: string; directory: boolean };

/** One directory as the host reports it, in whatever shape it lists entries. */
async function listDir(
  files: FilesApi,
  dir: string,
  includeDirectories: boolean,
): Promise<DirEntry[]> {
  const result = await files
    .listPaths({ path: dir, includeFiles: true, includeDirectories })
    .catch(() => null);
  return array(record(result).paths)
    .map((entry) => {
      const raw = typeof entry === "string" ? entry : text(record(entry).path);
      if (!raw) return null;
      return { path: listedPath(dir, raw), directory: record(entry).kind === "directory" };
    })
    .filter((entry): entry is DirEntry => entry !== null);
}

/**
 * Where a listed entry really lives.
 *
 * The host lists a directory with paths relative to the directory it was
 * asked about, but a listing that already names the file in full is honoured
 * rather than re-rooted. Anything else is read as relative to `dir`.
 */
function listedPath(dir: string, raw: string): string {
  if (isAbsolute(raw) || raw.startsWith(`${dir}/`)) return raw;
  return join(dir, raw);
}

/** Only a path below the directory the walk started from. */
function insideDir(dir: string, path: string): boolean {
  return path.startsWith(`${dir}/`);
}

/**
 * Every file under a directory, nested workflow areas included.
 *
 * The state-dir layout puts machine artifacts one level down — `plans/
 * spec-product_<v>.md`, `context/recon-receipt.json`, `reviews/review-*.md` —
 * so a top-level-only listing missed every one of them, and the gate handler
 * that approves against this list refused with "the gate artifact does not
 * exist yet" for a spec that was on disk. Unreadable directories contribute
 * nothing: the board reads a half-written workspace by design.
 *
 * This is the ONE walk of a state dir. The card's artifact read walks the
 * same tree to surface documents the manifest forgot, and two walks of one
 * directory are how the card and the board came to disagree about what a card
 * contains — so both call this.
 */
export async function listNestedFiles(
  files: FilesApi,
  dir: string,
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_WALK_DEPTH) return [];
  const entries = await listDir(files, dir, true);
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.directory && insideDir(dir, entry.path))
      .map((entry) => listNestedFiles(files, entry.path, depth + 1)),
  );
  const direct = entries
    .filter((entry) => !entry.directory && insideDir(dir, entry.path))
    .map((entry) => entry.path);
  return [...new Set([...direct, ...nested.flat()])];
}

/** Receipt file names already approved for this workflow, newest state wins. */
async function approvedReceipts(
  files: FilesApi,
  root: string,
  dirHash: string,
): Promise<Set<string>> {
  // Receipts are written flat (one file per gate), so this read stays
  // top-level: descending would spend a call per entry on a hot path for
  // nothing the gate handler ever wrote.
  const listed = await listDir(
    files,
    join(root, `.stelow/approvals/${dirHash}`),
    false,
  );
  return new Set(
    listed.map((entry) => entry.path.split("/").pop()!).filter(Boolean),
  );
}

/**
 * One registered document, or null when the file is not a deliverable
 * artifact. The bar is the manifest's own — the workflow's `state.md` and
 * its backups, a disposable draft, a non-Markdown file, and an empty or
 * template-only file are bookkeeping, not evidence of work — judged on the
 * state-dir-relative path so the board and the card list the same documents.
 */
async function readArtifact(
  files: FilesApi,
  path: string,
  root: string,
  created: string,
  dirHash: string,
  receipts: Set<string>,
): Promise<Workflow["artifacts"][number] | null> {
  const relative = path.startsWith(root)
    ? path.slice(root.length + 1)
    : `.stelow/${created}/${dirHash}/${path.replace(/^\//, "")}`;
  if (!isDeliverableArtifactPath(relative)) return null;
  const content = await files
    .read({ path })
    .then((file) => file.content)
    .catch(() => null);
  if (!isPublishableArtifactContent(content)) return null;
  const filename = relative.split("/").pop() ?? relative;
  const kind = classifyArtifact(filename);
  const receipt = gateReceiptFor(kind);
  return {
    kind,
    label: filename,
    path: relative,
    approved: receipt ? receipts.has(receipt) : false,
  };
}

/**
 * The documents a workflow registered, sorted by path so the board lists
 * them in the same order on every read. A workflow without a created date
 * and dir hash has no directory to read, which is an empty list, not an error.
 */
export async function findArtifacts(
  files: FilesApi,
  root: string,
  workflow: LooseRecord,
): Promise<Workflow["artifacts"]> {
  const created = text(workflow.created).slice(0, 10);
  const dirHash = text(workflow.dirHash);
  if (!created || !dirHash) return [];
  const paths = await listNestedFiles(
    files,
    join(root, `.stelow/${created}/${dirHash}`),
  );
  if (paths.length === 0) return [];
  const receipts = await approvedReceipts(files, root, dirHash);
  const candidates = await Promise.all(
    paths.map((path) =>
      readArtifact(files, path, root, created, dirHash, receipts),
    ),
  );
  return candidates
    .filter(
      (artifact): artifact is Workflow["artifacts"][number] =>
        artifact !== null,
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Configured phases of one workflow, numbered from 1 when unnamed. */
function workflowPhases(raw: LooseRecord): Workflow["phases"] {
  return array(raw.phases).map((entry, phaseIndex) => {
    const phase = record(entry);
    return {
      id: text(phase.id, `phase-${phaseIndex + 1}`),
      name: text(phase.name, text(phase.id, `Phase ${phaseIndex + 1}`)),
      status: normalizeStatus(phase.status),
    };
  });
}

/** The stage the workflow's own state.md records, or "" when unreadable. */
async function stageFromState(
  bb: BbPluginApi,
  rootPath: string,
  raw: LooseRecord,
): Promise<string> {
  const dirHash = text(raw.dirHash);
  const created = text(raw.created).slice(0, 10);
  if (!dirHash || !created) return "";
  const stateBlob = await bb.sdk.files
    .read({ path: join(rootPath, `.stelow/${created}/${dirHash}/state.md`) })
    .catch(() => null);
  return text(stateBlob?.content.match(/current_stage:\s*(\S+)/)?.[1]);
}

/** One board row: tracking metadata, the real stage, and its documents. */
async function boardWorkflow(
  bb: BbPluginApi,
  rootPath: string,
  raw: LooseRecord,
  index: number,
): Promise<Workflow> {
  const config = record(raw.config);
  const stage = record(raw.stage);
  const phases = workflowPhases(raw);
  const recorded = await stageFromState(bb, rootPath, raw);
  const reviewGates = Array.isArray(config.review_gates)
    ? config.review_gates.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : config.review_mode;
  return {
    id: text(raw.dirHash, text(raw.name, `workflow-${index + 1}`)),
    name: text(raw.name, `Workflow ${index + 1}`),
    description: text(raw.description),
    status: normalizeStatus(raw.status),
    stage:
      recorded ||
      text(
        stage.current_stage,
        phases.find((phase) => phase.status === "in-progress")?.name ??
          "Not started",
      ),
    appetite: text(config.appetite, "Core"),
    reviewMode: text(config.review_mode, "Auto"),
    reviewGates: normalizeReviewGates(
      Array.isArray(reviewGates)
        ? reviewGates.filter((entry): entry is string => typeof entry === "string")
        : reviewGates,
    ) as Array<"spec" | "interface" | "scope" | "tech" | "diff">,
    ...(typeof raw.dirHash === "string" ? { dirHash: raw.dirHash } : {}),
    ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
    phases,
    scopes: workflowScopes(raw),
    artifacts: await findArtifacts(bb.sdk.files, rootPath, raw),
  };
}

/**
 * Board scoped to an explicit workspace root (project source, or a single
 * exploratory card dir). onlyDirHash restricts the listing to one workflow —
 * used when a card worker asks for status: its project's source root holds no
 * stelow.json (each exploratory card owns its own file), so resolving by
 * project alone yields a misleading "not found".
 */
export async function boardFromRoot(
  bb: BbPluginApi,
  rootPath: string,
  onlyDirHash?: string | null,
): Promise<Board> {
  const trackingPath = join(rootPath, "stelow.json");
  const tracking = await readJson(bb.sdk.files, trackingPath);
  if (!tracking) {
    return {
      rootPath,
      workflows: [],
      error: `No stelow.json found (looked in ${trackingPath}). Start a Stelow workflow first — card workers: your file lives in your own state dir, not the \
project root.`,
    };
  }
  const entries = array(tracking.workflows).filter(
    (value) => !onlyDirHash || text(record(value).dirHash) === onlyDirHash,
  );
  if (onlyDirHash && entries.length === 0) {
    return {
      rootPath,
      workflows: [],
      error: `No workflow ${onlyDirHash} in ${trackingPath}. The card may have been reseeded — read the state dir from your spawn prompt.`,
    };
  }
  const workflows: Workflow[] = [];
  for (const [index, value] of entries.entries()) {
    workflows.push(
      await boardWorkflow(bb, rootPath, record(value), index),
    );
  }
  return { rootPath, workflows, error: null };
}

/** The board of the selected project, or the refusal to select one. */
export async function loadBoard(
  bb: BbPluginApi,
  projectId: string | null,
): Promise<Board> {
  const rootPath = await projectRoot(bb, projectId);
  if (!rootPath) {
    return {
      rootPath: null,
      workflows: [],
      error: projectId
        ? "Project workspace path is unavailable."
        : "Select a bb project to view its Stelow board.",
    };
  }
  return boardFromRoot(bb, rootPath);
}
