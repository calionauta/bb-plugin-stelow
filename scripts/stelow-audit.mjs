#!/usr/bin/env node
/**
 * Run the boundary gate.
 *
 * Four instruments, one exit code: the vendored tree equals the pin, every
 * declared helper verb is answered by the pin, the transition projection agrees
 * with the helper, and the pin is a commit upstream released. The verdict and
 * the failure shapes live in `lib/audit-gate.mjs`; this file only spawns,
 * prints and exits.
 *
 * Usage:
 *   node scripts/stelow-audit.mjs             # full gate (CI, operators)
 *   node scripts/stelow-audit.mjs --offline   # skips the GitHub check, says so
 *
 * Through npm, pass the flag after `--`: `npm run stelow-audit -- --offline`.
 * Without it npm consumes `--offline` as its own option and the full gate runs —
 * the safe direction, but a surprise worth naming here instead of in someone's
 * terminal history.
 *
 * `--offline` never reports the same green a full run reports: the closing line
 * names what was not verified. A gate that quietly narrows is a gate that says
 * "green" about something nobody checked.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exitCodeFor,
  instrumentResult,
  planGate,
  renderLine,
  renderSummary,
  summarize,
} from "../lib/audit-gate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const offline = process.argv.includes("--offline");
const { planned, skipped } = planGate({ offline });

if (planned.length === 0) {
  console.error("boundary gate: nothing to run — planGate returned no instruments");
  process.exit(1);
}

const results = [];
for (const instrument of planned) {
  console.log(`boundary gate: running ${instrument.id} — ${instrument.label}`);
  const [command, ...args] = instrument.command;
  const run = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  results.push(instrumentResult(instrument, run.status));
}

console.log("");
for (const result of results) console.log(renderLine(result));
console.log("");

const summary = summarize(results, { skipped });
console.log(renderSummary(summary));
process.exit(exitCodeFor(summary));
