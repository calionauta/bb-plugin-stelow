import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  parseReport,
  renderScanLine,
  summarizeScan,
} from "../../../lib/scan-contract.mjs";
import { completionRoot } from "../workflow-state.js";
import {
  noCardInContext,
  refuse,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
  type Refusal,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE = "Usage: bb stelow scan --report <path> [--format auto|sarif|neutral] "
  + "[--fail-on <severity>] [--require-scanners <a,b>] [--card <card_id>] [--json]";

const FORMATS = new Set(["auto", "sarif", "neutral"]);

/** Tri-state security scan: reads any security platform's report through
 * the neutral contract and records clean / failed / did-not-run against
 * the exact Git identity observed. Never executes scanner binaries —
 * the report file is the input, so no arbitrary shell text runs here. */
export function createScanCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "scan") return null;
    const args = argv.slice(1);
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json"],
      valued: ["--card", "--report", "--format", "--fail-on", "--require-scanners"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    return runScan(deps, card, scanned.flags, Boolean(scanned.flags.json));
  };
}

type ScanTarget = { checkoutPath: string; gitRoot: string; headSha: string };

/** The checkout plus the Git identity the run is recorded against. Both
 * are verified, never guessed: no Git identity means the verdict cannot
 * be bound to a tree, so the run records as did-not-run instead. */
async function scanTarget(deps: CliDeps, card: WorkerCard): Promise<ScanTarget | Refusal> {
  const root = await completionRoot(deps, card);
  const evidence = root ? await deps.gitEvidence(root) : null;
  if (!root || !evidence?.isGit || !evidence.gitRoot || !evidence.headSha) {
    return refuse({
      exitCode: 2,
      stderr:
        "The Build checkout has no verifiable Git root and HEAD. Restore its project workspace, then retry.",
    });
  }
  return { checkoutPath: root, gitRoot: evidence.gitRoot, headSha: evidence.headSha };
}

async function runScan(
  deps: CliDeps,
  card: WorkerCard,
  flags: Record<string, string | undefined>,
  json: boolean,
): Promise<CliResult> {
  if (card.kind !== "build") {
    return {
      exitCode: 2,
      stderr: "--report scans a Build checkout; research and explore have no code tree to scan.",
    };
  }
  if (card.workspace_kind === "exploratory") {
    return {
      exitCode: 2,
      stderr:
        "Security scan needs a real project checkout. Create or open the recovery audit card instead of scanning this preserved exploratory card.",
    };
  }
  const reportArg = (flags.report ?? "").trim();
  if (!reportArg) return { exitCode: 2, stderr: USAGE };
  const format = (flags["format"] ?? "auto").trim().toLowerCase();
  if (!FORMATS.has(format)) return { exitCode: 2, stderr: USAGE };
  const failOn = (flags["fail-on"] ?? "high").trim();
  const requireScanners = flags["require-scanners"] ?? "";
  const target = await scanTarget(deps, card);
  if ("refusal" in target) {
    recordScanRun(deps, card.id, "[]", "", "", 2, "");
    return target.refusal;
  }
  const raw = await readReport(deps, target.checkoutPath, reportArg);
  const report = raw === null ? null : parseReport(raw, format as "auto" | "sarif" | "neutral");
  const summary = summarizeScan({ report, failOn, requireScanners });
  const reportSha = raw === null
    ? "missing"
    : createHash("sha256").update(raw).digest("hex");
  recordScanRun(
    deps,
    card.id,
    JSON.stringify(summary.scanners),
    target.gitRoot,
    target.headSha,
    summary.exitCode,
    reportSha,
  );
  return scanResult(card, summary, json);
}

/** The report as the host sees it: the exact path first, then relative
 * to the checkout. A file the host cannot read is did-not-run evidence,
 * never a crash — the run still records so done keeps refusing. */
async function readReport(deps: CliDeps, checkoutPath: string, reportArg: string): Promise<string | null> {
  const candidates = [reportArg, join(checkoutPath, reportArg)];
  for (const path of candidates) {
    try {
      const content = await deps.bb.sdk.files.read({ path }).then((file) => file.content);
      if (typeof content === "string") return content;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function recordScanRun(
  deps: CliDeps,
  cardId: string,
  scanners: string,
  gitRoot: string,
  headSha: string,
  exitCode: number,
  reportSha256: string,
): void {
  try {
    deps.db
      .prepare(
        "INSERT INTO scan_runs (id, card_id, scanners, git_root, head_sha, exit_code, report_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        deps.randomId("scan"),
        cardId,
        scanners,
        gitRoot,
        headSha,
        exitCode,
        reportSha256,
        deps.now(),
      );
  } catch {
    /* the verdict still reports; a ledger write never flips it */
  }
}

function scanResult(
  card: WorkerCard,
  summary: ReturnType<typeof summarizeScan>,
  json: boolean,
): CliResult {
  if (json) {
    return {
      exitCode: summary.exitCode,
      stdout: JSON.stringify({ card: card.id, ...summary }, null, 2),
    };
  }
  const line = renderScanLine(summary);
  // renderScanLine already carries the PASS / FAIL / DID-NOT-RUN prefix —
  // the command only routes it to the right stream, never re-prefixes it.
  if (summary.status === "clean") return { exitCode: 0, stdout: `${line}\n` };
  if (summary.status === "failed") return { exitCode: 1, stderr: `${line}\n` };
  return { exitCode: 2, stderr: `${line}\n` };
}
