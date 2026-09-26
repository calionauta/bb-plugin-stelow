import {
  noCardInContext,
  scanCardId,
  unknownCard,
  type CliCommandFn,
  type CliResult,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { BundleCheck, BundleWrite, ExportRunBundle } from "./cli-bundle-writer.js";

const USAGE =
  "Usage: bb stelow export [--json] [--check] [--card <card_id>] [--dir <relpath>]";

/** On-demand bundle refresh plus drift check. `done` refreshes the bundle
 * automatically on every completion; --check reports changed/missing/new
 * sources without writing anything. Idempotent: stable basenames,
 * overwrite-in-place. */
export function createExportCommand(
  deps: CliDeps,
  exportRunBundle: ExportRunBundle,
): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "export") return null;
    const args = argv.slice(1);
    const json = args.includes("--json");
    const checkOnly = args.includes("--check");
    const scanned = scanCardId(args, ctx, deps.getCardByWorkerThread, {
      usage: USAGE,
      boolean: ["--json", "--check"],
      valued: ["--card", "--dir"],
    });
    if (scanned.result) return scanned.result;
    if (!scanned.cardId) return noCardInContext();
    const card = deps.getCard(scanned.cardId);
    if (!card) return unknownCard(scanned.cardId);
    const bundle = checkOnly
      ? await exportRunBundle(card, { checkOnly: true, dirRel: scanned.flags.dir })
      : await exportRunBundle(card, { dirRel: scanned.flags.dir });
    if (!bundle.ok) return { exitCode: 1, stderr: bundle.error };
    if (bundle.check) return checkResult(bundle, json);
    return writeResult(bundle, json, card.id);
  };
}

function checkResult(bundle: BundleCheck, json: boolean): CliResult {
  const drift = [
    ...bundle.stale.map((entry) => `${entry.sourcePath} (${entry.reason})`),
    ...bundle.added.map((sourcePath) => `${sourcePath} (new)`),
    ...bundle.missing.map((sourcePath) => `${sourcePath} (unreadable)`),
  ];
  const settled = bundle.fresh && bundle.committed !== false;
  if (bundle.committed === false)
    drift.push(`${bundle.dir}/ differs from HEAD — commit it with the work`);
  if (json)
    return {
      exitCode: settled ? 0 : 1,
      stdout: JSON.stringify(
        {
          fresh: bundle.fresh,
          committed: bundle.committed,
          stale: bundle.stale,
          added: bundle.added,
          missing: bundle.missing,
        },
        null,
        2,
      ),
    };
  if (settled)
    return {
      exitCode: 0,
      stdout: `Bundle fresh: docs/runs matches every registered artifact.${
        bundle.committed === null
          ? " (no git repo — bundle lives in the workspace only)"
          : " (committed)"
      }`,
    };
  return {
    exitCode: 1,
    stderr: [
      `Bundle not settled — run \`bb stelow export\`, then commit:`,
      ...drift.map((line) => `- ${line}`),
    ].join("\n"),
  };
}

function writeResult(
  bundle: BundleWrite,
  json: boolean,
  cardId: string,
): CliResult {
  if (!bundle.wrote)
    return {
      exitCode: 0,
      stdout: `No registered artifacts — nothing to bundle.${
        bundle.missing.length > 0
          ? ` (${bundle.missing.length} registered but unreadable: ${
              bundle.missing.join(", ")
            })`
          : ""
      }`,
    };
  const payload = {
    card: cardId,
    dir: bundle.dir,
    files: bundle.files,
    missing: bundle.missing,
    trailer: bundle.trailer,
  };
  if (json)
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
  return {
    exitCode: 0,
    stdout: [
      `Exported ${bundle.files.length} artifact(s) to ${bundle.dir}/ (+ manifest.md)${
        bundle.missing.length > 0
          ? ` — ${bundle.missing.length} registered but unreadable: ${
              bundle.missing.join(", ")
            }`
          : ""
      }.`,
      `Commit the directory with the work, then paste below the commit subject:`,
      ...bundle.trailer,
    ].join("\n"),
  };
}
