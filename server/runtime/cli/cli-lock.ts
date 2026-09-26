import {
  acquireWorkspaceClaims,
  addClaimWaiters,
  checkWorkspaceClaims,
  releaseWorkspaceClaims,
  CLAIM_TTL_MS,
} from "../../../lib/card-claims.mjs";
import { resolveClaimKey } from "../../../lib/card-claim-key.mjs";
import { isClaimTerminal } from "../../../lib/card-terminal.mjs";
import { refuse, usage, type CliCommandFn, type CliResult, type Refusal } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE =
  "Usage: bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id> [--file <f>...] [--ttl N] [--json]";

type LockOp = "acquire" | "release" | "check";

type LockTarget = {
  op: LockOp;
  rest: string[];
  card: WorkerCard | undefined;
  claimRoot: string;
  claimScope: string | null;
  claimFiles: string[];
  at: number;
};

/** Helper exit codes are meaningful here (1 = lock conflict): pass through.
 * The workspace claim registry (lib/card-claims) is keyed by the checkout the
 * worker actually writes to (lib/card-claim-key), so cards isolated in their
 * own worktrees do not falsely serialize. Host/UI callers without a card
 * context keep the helper behavior unchanged. State dir and helper cwd stay
 * on the source: state ≠ execution. */
export function createLockCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "lock") return null;
    const target = await lockTarget(deps, argv, ctx);
    if ("refusal" in target) return target.refusal;
    const result = await deps.runHelper(
      ["lock", target.op, ...target.rest],
      target.rootPath,
      target.stateDir ?? undefined,
    );
    const claimResult = await applyClaimRegistry(deps, target, result);
    if (claimResult) return claimResult;
    // Acquire/release mutate the claim room the card reads: publish so
    // claimed indicators flip without waiting for a lifecycle event. Check
    // stays silent (read-only).
    if (
      (target.op === "acquire" || target.op === "release") &&
      result.code === 0 &&
      target.card
    ) {
      deps.bb.realtime.publish("card-state", { cardId: target.card.id });
      deps.bb.realtime.publish("board-changed", { cardId: target.card.id });
    }
    return {
      exitCode: result.code ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

type LockTargetOrRefusal =
  | (LockTarget & { rootPath: string; stateDir: string | null })
  | Refusal;

async function lockTarget(
  deps: CliDeps,
  argv: string[],
  ctx: { projectId?: string | null; threadId?: string | null },
): Promise<LockTargetOrRefusal> {
  const args = argv.slice(1);
  const op = args[0];
  if (op !== "acquire" && op !== "release" && op !== "check")
    return refuse(usage(USAGE));
  const parsed = parseLockArgs(args);
  if (parsed.result) return refuse(parsed.result);
  const card = ctx.threadId ? deps.getCardByWorkerThread(ctx.threadId) : undefined;
  const workspace = card ? await deps.cardWorkspace(card) : null;
  const rootPath = workspace?.path ?? (await deps.projectRoot(parsed.projectId));
  if (!rootPath)
    return refuse({ exitCode: 1, stderr: "Workspace path is unavailable." });
  const stateDir = card?.dir_hash
    ? await deps.workflowStateDir(rootPath, card.id, card.dir_hash)
    : null;
  const guard = await deps.ensureProjectArtifacts(
    rootPath,
    stateDir,
    Boolean(card?.dir_hash),
  );
  if (guard) return refuse({ exitCode: 1, stderr: guard });
  const claimRoot = await claimRootFor(deps, card, rootPath);
  const { claimScope, claimFiles } = claimSelection(parsed.rest);
  return {
    op,
    rest: parsed.rest,
    card,
    rootPath,
    stateDir,
    claimRoot,
    claimScope,
    claimFiles,
    at: deps.now(),
  };
}

function parseLockArgs(
  args: string[],
): { rest: string[]; projectId: string | null; result?: CliResult } {
  const rest: string[] = [];
  let projectId: string | null = null;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === "--project") {
      projectId = args[index + 1] ?? null;
      index++;
      continue;
    }
    if (
      args[index] === "--scope" ||
      args[index] === "--file" ||
      args[index] === "--ttl" ||
      args[index] === "--json"
    ) {
      rest.push(args[index]!);
      if (args[index] !== "--json") {
        rest.push(args[index + 1] ?? "");
        index++;
      }
      continue;
    }
    if (!args[index]!.startsWith("--")) {
      rest.push(args[index]!);
      continue;
    }
    return { rest, projectId, result: usage(USAGE) };
  }
  return { rest, projectId };
}

async function claimRootFor(
  deps: CliDeps,
  card: WorkerCard | undefined,
  rootPath: string,
): Promise<string> {
  if (!card) return rootPath;
  const checkout = await deps.cardCheckout(card).catch(() => null);
  return (
    resolveClaimKey({ checkoutPath: checkout?.path ?? null, sourcePath: rootPath }) ??
    rootPath
  );
}

function claimSelection(rest: string[]): {
  claimScope: string | null;
  claimFiles: string[];
} {
  const scopeIndex = rest.indexOf("--scope");
  const claimScope = scopeIndex >= 0 ? (rest[scopeIndex + 1] ?? null) : null;
  const claimFiles: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === "--file" && rest[index + 1]) {
      claimFiles.push(rest[index + 1]!);
      index++;
    } else if (
      !rest[index]!.startsWith("--") &&
      rest[index - 1] !== "--scope" &&
      rest[index - 1] !== "--ttl"
    )
      claimFiles.push(rest[index]!);
  }
  return { claimScope, claimFiles };
}

type ClaimOutcome = {
  acquired: Array<{ file: string; fencing: number }>;
  renewed: Array<{ file: string }>;
  stolen: Array<{ file: string; previousHolder: string; fencing: number }>;
  conflicts: ClaimConflict[];
} | null;

type ClaimConflict = {
  file: string;
  heldBy: string;
  heldScope: string | null;
  expiresAt: number;
};

/** A null result means "the claim registry had nothing to say" and the
 * helper's own verdict stands. Every registry path is advisory: the helper
 * lock already decided, so a registry write failure must not flip the exit
 * code. */
async function applyClaimRegistry(
  deps: CliDeps,
  target: LockTarget & { rootPath: string },
  result: { code: number | null; stdout: string; stderr: string },
): Promise<CliResult | null> {
  if (!target.card) return null;
  if (target.op === "acquire") return applyAcquire(deps, target, result);
  if (target.op === "release") return applyRelease(deps, target);
  return applyCheck(deps, target, result);
}

async function applyAcquire(
  deps: CliDeps,
  target: LockTarget,
  result: { stdout: string; stderr: string },
): Promise<CliResult | null> {
  let outcome: ClaimOutcome = null;
  try {
    outcome = acquireWorkspaceClaims(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: target.claimFiles,
      scope: target.claimScope,
      ttlMs: CLAIM_TTL_MS,
      nowMs: target.at,
    });
  } catch {
    /* advisory: helper lock already decided */
  }
  if (!outcome) return null;
  trailSteals(deps, target.card!.id, outcome.stolen);
  outcome = reapDeadHolders(deps, target, outcome);
  const live = outcome.conflicts.filter((entry) => isLiveHolder(deps, entry));
  if (live.length === 0) return null;
  queueWaiters(deps, target, live);
  return blockedResult(deps, target, live, result);
}

function trailSteals(
  deps: CliDeps,
  cardId: string,
  stolen: Array<{ file: string; previousHolder: string }>,
): void {
  for (const steal of stolen) {
    deps.logCardComment(
      cardId,
      "card",
      cardId,
      "agent",
      `Stole expired workspace claim on ${steal.file} (previous holder card ${steal.previousHolder}) — its lease lapsed, so work continues; \
the previous holder re-acquires if still live.`,
    );
  }
}

/** Claims left by terminal/gone cards are dead weight: reap and re-acquire
 * instead of parking a live card behind a ghost. */
function reapDeadHolders(
  deps: CliDeps,
  target: LockTarget,
  outcome: NonNullable<ClaimOutcome>,
): NonNullable<ClaimOutcome> {
  const dead = outcome.conflicts.filter((entry) => !isLiveHolder(deps, entry));
  if (dead.length === 0) return outcome;
  try {
    const del = deps.db.prepare(
      "DELETE FROM card_claims WHERE workspace_path = ? AND file_path = ? AND card_id = ?",
    );
    for (const entry of dead) del.run(target.claimRoot, entry.file, entry.heldBy);
    return acquireWorkspaceClaims(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: target.claimFiles,
      scope: target.claimScope,
      ttlMs: CLAIM_TTL_MS,
      nowMs: target.at,
    });
  } catch {
    /* advisory */
    return outcome;
  }
}

function queueWaiters(
  deps: CliDeps,
  target: LockTarget,
  live: ClaimConflict[],
): void {
  try {
    addClaimWaiters(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: live.map((entry) => entry.file),
      scope: target.claimScope,
      nowMs: target.at,
    });
  } catch {
    /* advisory */
  }
  for (const entry of live) {
    const holder = deps.getCard(entry.heldBy);
    deps.recordInboxEvent(
      target.card!,
      "paused",
      deps.lockBlockedSummary(
        entry.file,
        holder?.display_name ?? holder?.name ?? entry.heldBy,
        entry.expiresAt,
      ),
      `lock-blocked:${target.card!.id}:${entry.file}`,
      target.at,
    );
  }
}

function isLiveHolder(deps: CliDeps, entry: ClaimConflict): boolean {
  const holder = deps.getCard(entry.heldBy);
  return holder !== undefined && !isClaimTerminal(holder.status);
}

function blockedResult(
  deps: CliDeps,
  target: LockTarget,
  live: ClaimConflict[],
  result: { stdout: string; stderr: string },
): CliResult {
  const lines = live.map((entry) => {
    const holder = deps.getCard(entry.heldBy);
    const heldBy = holder?.display_name ?? holder?.name ?? entry.heldBy;
    const expiresAt = new Date(entry.expiresAt).toISOString();
    return `BB-LOCK-BLOCKED file=${entry.file} heldBy=${heldBy} expiresAt=${expiresAt}`;
  });
  const retryGuidance = "do not retry in a loop";
  return {
    exitCode: 1,
    stdout: result.stdout,
    stderr: [
      lines.join("\n"),
      `Park this scope and work an independent one (or wait for the host nudge) — ${retryGuidance}.`,
      "The host resumes this card when the file frees.",
      ...(result.stderr ? [result.stderr] : []),
    ].join("\n"),
  };
}

async function applyRelease(
  deps: CliDeps,
  target: LockTarget,
): Promise<CliResult | null> {
  let released: Array<{ workspacePath: string; file: string }> = [];
  try {
    released = releaseWorkspaceClaims(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: target.claimFiles,
    });
  } catch {
    /* advisory */
  }
  if (released.length > 0)
    await deps.notifyClaimWaiters(
      target.claimRoot,
      released.map((row) => row.file),
    );
  return null;
}

/** Check doubles as a lease heartbeat for the caller's own claims;
 * cross-card walls ride on stderr so --json stdout stays parseable. */
async function applyCheck(
  deps: CliDeps,
  target: LockTarget,
  result: { code: number | null; stdout: string; stderr: string },
): Promise<CliResult | null> {
  let seen: {
    free: string[];
    conflicts: Array<{ file: string; heldBy: string; expiresAt: number }>;
  } | null = null;
  try {
    seen = checkWorkspaceClaims(deps.db, {
      cardId: target.card!.id,
      workspacePath: target.claimRoot,
      files: target.claimFiles,
      ttlMs: CLAIM_TTL_MS,
      nowMs: target.at,
    });
  } catch {
    /* advisory */
  }
  const liveWalls = (seen?.conflicts ?? []).filter((entry) => isLiveHolder(deps, entry as ClaimConflict));
  if (liveWalls.length === 0) return null;
  const lines = liveWalls.map(
    (entry) =>
      `BB-LOCK-WALL file=${entry.file} heldBy=${entry.heldBy} expiresAt=${new Date(entry.expiresAt).toISOString()}`,
  );
  return {
    exitCode: result.code ?? 1,
    stdout: result.stdout,
    stderr: `${lines.join("\n")}${result.stderr ? `\n${result.stderr}` : ""}`,
  };
}
