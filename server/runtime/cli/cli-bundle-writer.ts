import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  buildArtifactTrailer,
  parseArtifactManifest,
  renderBundleManifest,
  resolveArtifactPath,
} from "../../../lib/artifact-manifest.mjs";
import {
  assignBundleNames,
  parseBundleManifest,
  staleBundleEntries,
  unbundledSources,
} from "../../../lib/run-bundle.mjs";
import { sumTokenBreakdowns, tokenBreakdownFromEvents } from "../../../lib/token-usage.mjs";
import { readCardStateBlob } from "./cli-card-state.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

export type BundleEntry = {
  name: string;
  stage: string | null;
  sha8: string;
  sourcePath: string;
};

export type BundleCheck = {
  ok: true;
  check: true;
  dir: string;
  fresh: boolean;
  stale: Array<BundleEntry & { reason: string }>;
  added: string[];
  missing: string[];
  committed: boolean | null;
};

export type BundleWrite = {
  ok: true;
  check: false;
  dir: string;
  files: BundleEntry[];
  missing: string[];
  trailer: string[];
  wrote: boolean;
};

export type BundleFailure = { ok: false; error: string };

export type BundleResult = BundleCheck | BundleWrite | BundleFailure;

export type ExportRunBundle = {
  (card: WorkerCard, opts: { checkOnly: true; dirRel?: string }): Promise<BundleCheck | BundleFailure>;
  (card: WorkerCard, opts?: { checkOnly?: false; dirRel?: string }): Promise<BundleWrite | BundleFailure>;
};

type ReadableSource = {
  stage: string | null;
  sourcePath: string;
  content: string;
  sha8: string;
};

type BundleSources = {
  registered: Array<{ path: string; stage?: string | null }>;
  readable: ReadableSource[];
  unreadable: string[];
  targetRel: string;
  targetAbs: string;
  workspacePath: string;
};

/** Shared run-bundle writer: `export` calls it on demand, `done` calls it on
 * every completion so docs/runs/<card>/ converges to the card's current
 * artifacts instead of rotting after the first manual export. Idempotent:
 * stable basenames, overwrite-in-place, manifest rewritten. */
export function createBundleWriter(deps: CliDeps): ExportRunBundle {
  async function exportRunBundle(
    card: WorkerCard,
    opts?: { checkOnly?: boolean; dirRel?: string },
  ): Promise<BundleResult> {
    const sources = await readBundleSources(deps, card, opts);
    if ("error" in sources) return { ok: false, error: sources.error };
    if (opts?.checkOnly) return checkBundle(deps, sources);
    return writeBundle(deps, card, sources);
  }
  return exportRunBundle as ExportRunBundle;
}

/** Reads every registered artifact once: check and write both need the
 * content and its SHA, and an unreadable source is reported, never copied. */
async function readBundleSources(
  deps: CliDeps,
  card: WorkerCard,
  opts: { dirRel?: string } | undefined,
): Promise<BundleSources | { error: string }> {
  const workspace = await deps.cardWorkspace(card).catch(() => null);
  if (!workspace?.path)
    return { error: "The card has no workspace to export into." };
  const stateBlob = await readCardStateBlob(deps, card);
  const registered = stateBlob
    ? parseArtifactManifest(stateBlob).filter(
        (fields) => typeof fields.path === "string" && fields.path.length > 0,
      )
    : [];
  const targetRel = opts?.dirRel ?? `docs/runs/${card.id}`;
  const targetAbs = resolveArtifactPath(workspace.path, targetRel);
  if (!targetAbs)
    return {
      error: `Refusing export dir "${targetRel}": relative path inside the workspace only.`,
    };
  const { readable, unreadable } = await readRegisteredSources(deps, workspace.path, registered);
  return {
    registered,
    readable,
    unreadable,
    targetRel,
    targetAbs,
    workspacePath: workspace.path,
  };
}

/** Reads each registered artifact once: an empty or unreadable source is
 * reported, never copied into the bundle. */
async function readRegisteredSources(
  deps: CliDeps,
  workspacePath: string,
  registered: Array<{ path: string; stage?: string | null }>,
): Promise<{ readable: ReadableSource[]; unreadable: string[] }> {
  const readable: ReadableSource[] = [];
  const unreadable: string[] = [];
  for (const fields of registered) {
    const sourcePath = fields.path as string;
    const full = resolveArtifactPath(workspacePath, sourcePath);
    const content = full
      ? await deps.bb.sdk.files
          .read({ path: full })
          .then((file) => file.content)
          .catch(() => null)
      : null;
    if (typeof content !== "string" || !content.trim()) {
      unreadable.push(sourcePath);
      continue;
    }
    readable.push({
      stage: fields.stage ?? null,
      sourcePath,
      content,
      sha8: sha8(content),
    });
  }
  return { readable, unreadable };
}

function sha8(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

/** Drift check: what changed, what is new, what cannot be read, plus the
 * commit dimension (does the bundle dir match HEAD, or is it uncommitted?). */
async function checkBundle(
  deps: CliDeps,
  sources: BundleSources,
): Promise<BundleCheck | BundleFailure> {
  const { registered, readable, unreadable, targetRel, targetAbs } = sources;
  const manifestContent = await readBundleManifest(deps, targetAbs);
  const bundled = manifestContent === null ? [] : parseBundleManifest(manifestContent);
  const shaBySource = new Map(
    readable.map((entry) => [entry.sourcePath, entry.sha8]),
  );
  const stale = staleBundleEntries(bundled, shaBySource);
  const added = unbundledSources(registered, bundled);
  const drifted = stale.length > 0 || added.length > 0 || unreadable.length > 0;
  // Null when there is nothing to compare (no bundle yet) or no git repo to
  // compare against — the bundle then lives in the workspace only, and the
  // report says so.
  const committed = await bundleCommitted(
    deps,
    manifestContent,
    targetRel,
    sources.workspacePath,
  );
  return {
    ok: true,
    check: true,
    dir: targetRel,
    fresh: !drifted,
    stale,
    added,
    missing: unreadable,
    committed,
  };
}

async function bundleCommitted(
  deps: CliDeps,
  manifestContent: string | null,
  targetRel: string,
  workspacePath: string,
): Promise<boolean | null> {
  if (manifestContent === null) return null;
  const status = await deps.runGitIn(workspacePath, [
    "status",
    "--porcelain",
    "--",
    targetRel,
  ]).catch(() => null);
  return status && status.ok ? status.stdout.trim().length === 0 : null;
}

function readBundleManifest(
  deps: CliDeps,
  targetAbs: string,
): Promise<string | null> {
  return deps.bb.sdk.files
    .read({ path: join(targetAbs, "manifest.md") })
    .then((file) => file.content)
    .catch(() => null);
}

/** Nothing readable and no bundle yet: writing a manifest of only missing
 * entries would be noise — skip, and say so. */
async function writeBundle(
  deps: CliDeps,
  card: WorkerCard,
  sources: BundleSources,
): Promise<BundleWrite | BundleFailure> {
  const { readable, unreadable, targetRel, targetAbs, workspacePath } = sources;
  if (readable.length === 0) {
    const priorManifest = await readBundleManifest(deps, targetAbs);
    if (priorManifest === null)
      return {
        ok: true,
        check: false,
        dir: targetRel,
        files: [],
        missing: [...unreadable],
        trailer: [],
        wrote: false,
      };
  }
  try {
    await deps.bb.sdk.files.mkdir({
      path: targetAbs,
      rootPath: workspacePath,
      recursive: true,
    });
  } catch {
    return { ok: false, error: `Could not create ${targetRel} — retry export.` };
  }
  const { files, missing } = await writeBundleFiles(deps, sources, workspacePath);
  const gapTotals = await bundleGapTotals(deps, card);
  const manifest = renderBundleManifest({
    cardId: card.id,
    cardName: card.name,
    stage: card.stage,
    generatedAt: new Date().toISOString(),
    files,
    missing,
    gapTotals,
    tokens: await bundleTokenEvidence(deps, card),
  });
  try {
    await deps.bb.sdk.files.write({
      path: join(targetAbs, "manifest.md"),
      rootPath: workspacePath,
      expectedSha256: null,
      content: manifest,
    });
  } catch {
    return {
      ok: false,
      error: `Exported ${files.length} file(s) but could not write manifest.md — retry export.`,
    };
  }
  const trailer = buildArtifactTrailer(
    card.id,
    files.map((file) => ({ stage: file.stage, path: file.sourcePath })),
    gapTotals,
  );
  return {
    ok: true,
    check: false,
    dir: targetRel,
    files,
    missing,
    trailer,
    wrote: true,
  };
}

async function writeBundleFiles(
  deps: CliDeps,
  sources: BundleSources,
  workspacePath: string,
): Promise<{ files: BundleEntry[]; missing: string[] }> {
  const { readable, unreadable, targetAbs } = sources;
  const files: BundleEntry[] = [];
  const missing = [...unreadable];
  for (const plan of assignBundleNames(readable)) {
    const source = readable.find((entry) => entry.sourcePath === plan.sourcePath);
    if (!source) continue;
    try {
      await deps.bb.sdk.files.write({
        path: join(targetAbs, plan.name),
        rootPath: workspacePath,
        expectedSha256: null,
        content: source.content,
      });
    } catch {
      missing.push(plan.sourcePath);
      continue;
    }
    files.push({
      name: plan.name,
      stage: plan.stage,
      sha8: source.sha8,
      sourcePath: plan.sourcePath,
    });
  }
  return { files, missing };
}

async function bundleGapTotals(
  deps: CliDeps,
  card: WorkerCard,
) {
  const gapState =
    card.kind === "build" ? await deps.gapState(card).catch(() => null) : null;
  return gapState?.matched ? gapState.totals : null;
}

/** Token evidence joins the bundle: provider-reported splits across the card's
 * threads, summed once, committed with the run. Bounded (20 latest threads)
 * and fail-open — export never blocks on it. */
async function bundleTokenEvidence(deps: CliDeps, card: WorkerCard) {
  try {
    const threadIds = deps.workers.ledgerThreadIds(card.id, 20);
    const reports = await Promise.all(
      threadIds.map(async (threadId) => {
        try {
          const events = await deps.bb.sdk.threads.events.list({
            threadId,
            types: ["thread/tokenUsage/updated"],
            order: "desc",
            limit: "1",
          });
          return tokenBreakdownFromEvents(events);
        } catch {
          return null;
        }
      }),
    );
    return sumTokenBreakdowns(reports);
  } catch {
    return null;
  }
}
