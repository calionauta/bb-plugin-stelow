import { execFile } from "node:child_process";
import { formatBytes, isStaleEnvironment, threadIdFromWorktreePath } from "../../../lib/worktree-storage.mjs";
import { scanFlags, type CliCommandFn } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow storage [--json] [--card <card_id>]";

type WorktreeRow = {
  environmentId: string;
  path: string | null;
  bytes: number | null;
  branch: string | null;
  status: string;
  stale: boolean;
  cardId: string | null;
  cardName: string | null;
  projectId: string | null;
  kind: string | null;
  cardStatus: string | null;
  stage: string | null;
};

type WorktreeEnvironment = {
  id?: unknown;
  path?: unknown;
  isWorktree?: unknown;
  branchName?: unknown;
  status?: unknown;
  lifecycle?: unknown;
};

/** Worktree disk attribution (read-only): every worktree BB reports, sized
 * with du, attributed to cards by thread, heaviest first. Unattributed rows
 * still list — an invisible copy is the failure this exists to prevent.
 * Per-path timeout; unreadable reads unknown. */
export function createStorageCommand(deps: CliDeps): CliCommandFn {
  return async (argv) => {
    if (argv[0] !== "storage") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const scan = scanFlags(args, { boolean: ["--json"], valued: ["--card"], usage: USAGE });
    if (!scan.ok) return scan.result;
    const onlyCardId = scan.flags.card;
    const rows = await collectWorktrees(deps, onlyCardId);
    rows.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
    const total = rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
    const unknown = rows.filter((row) => row.bytes === null).length;
    if (json)
      return {
        exitCode: 0,
        stdout: JSON.stringify(
          { totalBytes: total, worktrees: rows.length, unreadable: unknown, rows },
          null,
          2,
        ),
      };
    if (rows.length === 0)
      return { exitCode: 0, stdout: "No worktrees reported." };
    return { exitCode: 0, stdout: storageLines(rows, total, unknown).join("\n") };
  };
}

function duBytes(path: string): Promise<number | null> {
  return new Promise((resolveDu) => {
    execFile("du", ["-sb", path], { timeout: 8000 }, (error, stdout) => {
      if (error) return resolveDu(null);
      const match = /^\d+/.exec(String(stdout ?? ""));
      resolveDu(match ? Number.parseInt(match[0], 10) : null);
    });
  });
}

async function collectWorktrees(
  deps: CliDeps,
  onlyCardId: string | undefined,
): Promise<WorktreeRow[]> {
  const environments = await deps.bb.sdk.environments
    .list()
    .then((result) => (Array.isArray(result) ? result : []))
    .catch(() => []);
  const rows: WorktreeRow[] = [];
  for (const raw of environments) {
    const env = (raw ?? {}) as WorktreeEnvironment;
    if (typeof env.id !== "string" || env.isWorktree !== true) continue;
    const path = typeof env.path === "string" && env.path ? env.path : null;
    const bytes = path ? await duBytes(path).catch(() => null) : null;
    const owner = worktreeOwner(deps, path);
    const card = owner ? deps.getCard(owner) : undefined;
    if (onlyCardId && (!card || card.id !== onlyCardId)) continue;
    rows.push(worktreeRow(deps, env, path, bytes, card));
  }
  return rows;
}

function worktreeOwner(
  deps: CliDeps,
  path: string | null,
): string | null {
  const threadId = threadIdFromWorktreePath(path);
  return threadId ? deps.workers.ledgerCardId(threadId) : null;
}

function worktreeRow(
  deps: CliDeps,
  env: WorktreeEnvironment,
  path: string | null,
  bytes: number | null,
  card: WorkerCard | undefined,
): WorktreeRow {
  return {
    environmentId: env.id as string,
    path,
    bytes,
    branch: typeof env.branchName === "string" ? env.branchName : null,
    status: typeof env.status === "string" ? env.status : "unknown",
    stale: isStaleEnvironment(env),
    cardId: card?.id ?? null,
    cardName: card ? (card.display_name ?? card.name) : null,
    projectId: card?.project_id ?? null,
    kind: card?.kind ?? null,
    cardStatus: card?.status ?? null,
    stage: card?.stage ?? null,
  };
}

function storageLines(
  rows: WorktreeRow[],
  total: number,
  unknown: number,
): string[] {
  return [
    `Worktrees: ${rows.length} using ${formatBytes(total) ?? "unknown"}${
      unknown > 0 ? ` (${unknown} unreadable)` : ""
    }`,
    ...rows.map((row) => {
      const size = formatBytes(row.bytes) ?? "unknown size";
      const who = row.cardId
        ? `${row.cardName} (${row.cardId}, ${row.kind}/${row.cardStatus}/${row.stage})`
        : "unattributed";
      const stale = row.stale ? " · stale" : "";
      return `- ${size} · ${who}${row.branch ? ` · ${row.branch}` : ""}${stale}\n  ${row.path ?? "no path"}`;
    }),
  ];
}
