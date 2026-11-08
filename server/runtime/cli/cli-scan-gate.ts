import { scanReadiness, verificationReadiness } from "../../../lib/audit-verification.mjs";
import type { CliDeps, GitEvidence } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";
import type { CliResult } from "./cli-contract.js";

export type ScanRun = {
  scanners: string;
  git_root: string;
  head_sha: string;
  exit_code: number;
} | undefined;

type VerificationRun = {
  command: string;
  git_root: string;
  head_sha: string;
  exit_code: number;
} | undefined;

/** The host-recorded proof gates: tests then scan, first refusal wins. One
 * call so the done chain and the verify warning read the same verdicts. */
export function testAndScanEvidence(
  deps: CliDeps,
  card: WorkerCard,
  git: GitEvidence,
): { refusal: CliResult } | { run: NonNullable<VerificationRun> } {
  const run = latestVerificationRun(deps, card.id);
  const verification = verificationReadiness(run, git);
  if (!verification.ready) return { refusal: { exitCode: 1, stderr: verification.error } };
  const scan = scanReadiness(latestScanRun(deps, card.id), git);
  if (!scan.ready) return { refusal: { exitCode: 1, stderr: scan.error } };
  return { run: run as NonNullable<VerificationRun> };
}

function latestVerificationRun(deps: CliDeps, cardId: string): VerificationRun {
  return deps.db
    .prepare(
      "SELECT command, git_root, head_sha, exit_code FROM verification_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(cardId) as VerificationRun;
}

function latestScanRun(deps: CliDeps, cardId: string): ScanRun {
  try {
    return deps.db
      .prepare(
        "SELECT scanners, git_root, head_sha, exit_code FROM scan_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(cardId) as ScanRun;
  } catch {
    return undefined;
  }
}

/** The scan gate done enforces, surfaced early: a missing, failing, or
 * stale scan run warns instead of ambushing there. Warn-only — verify
 * never blocks on it. Read-only and fail-open on unreadable rows, but a
 * missing scan_runs table (old database) warns rather than staying
 * silent: done refuses there, so verify must say so first. */
export async function scanWarning(deps: CliDeps, card: WorkerCard): Promise<string> {
  if (card.kind !== "build") return "";
  const missingTableWarning = () =>
    "\nWARNING: security scan open (done will refuse):\n"
    + "SCAN SCANMISSING No passing security scan is recorded for this checkout. "
    + "Run `bb stelow scan --report <path>` with the required scanners, then run done.";
  let row: { exit_code?: number; git_root?: string; head_sha?: string } | undefined;
  try {
    row = deps.db
      .prepare(
        "SELECT git_root, head_sha, exit_code FROM scan_runs WHERE card_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(card.id) as typeof row;
  } catch {
    return missingTableWarning();
  }
  let gitRoot: string | null = null;
  let headSha: string | null = null;
  try {
    const checkout = await deps.cardCheckout(card);
    const evidence = checkout ? await deps.gitEvidence(checkout.path) : null;
    gitRoot = evidence?.gitRoot ?? null;
    headSha = evidence?.headSha ?? null;
  } catch {
    /* staleness stays unknown without HEAD; presence still warns */
  }
  const check = scanReadiness(
    row ? { exit_code: row.exit_code ?? 2, git_root: row.git_root ?? "", head_sha: row.head_sha ?? "" } : undefined,
    { gitRoot, headSha },
  );
  if (check.ready) return "";
  return `\nWARNING: security scan open (done will refuse):\nSCAN ${(check.code ?? "ScanMissing").toUpperCase()} ${check.error ?? ""}`;
}
