#!/usr/bin/env node
/**
 * How much of the suite's wall-clock is spent starting processes.
 *
 * The gate is 394 leaf commands, nearly all `node ...`, and a node start costs
 * ~30ms before the first assertion runs. That makes process boot a fixed cost
 * the suite pays whether or not a test is cheap — the pure `lib/` tests execute
 * in microseconds inside the process that is already up. Measured on
 * 2026-10-05: twelve pure tests in one process take 0.61s total, while the same
 * twelve as twelve commands take roughly five times that in boot alone.
 *
 * This prints the census so the number is visible before anyone acts on it, and
 * exits non-zero only when the ratio crosses a ceiling. It writes nothing and
 * runs no test: it reads package.json and prices the commands.
 *
 * Usage: node scripts/check-test-boot-cost.mjs [--ceiling <ratio>]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Measured on this host: `node -e ""` averages ~32ms. Pricing every command at
 * zero execution time therefore *understates* the overhead, which is the safe
 * direction for a ceiling. */
const NODE_BOOT_MS = 32;

/** The share of leaf commands that may be a separate `node` process.
 *
 * This is recorded debt, not an aspiration. Measured 2026-10-05: 393 of 394 leaf
 * commands start node, 99.7%, about 12.6s of pure process boot per full run. The
 * ceiling sits one command above where the suite actually is, which is the
 * honest setting for a guard whose purpose is to stop the number growing while
 * the debt is still owed — a ceiling set at where we wish we were would fail on
 * every run and be turned off within a week.
 *
 * Lower it as pure `lib/` tests are folded into `npm run test:fast`. Never raise
 * it to accommodate a new command; fold the test instead. */
const DEFAULT_CEILING = 0.998;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Split one shell script on `&&` / `||` and keep the real commands. */
function leafCommands(script) {
  return script
    .split(/&&|\|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Every leaf command reachable from a top-level test script, walking `npm run`
 * one level at a time. A script reachable twice is counted once. */
function walk(scripts, names) {
  const seen = new Set();
  const leaves = [];
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const script = scripts[name];
    if (typeof script !== "string") return;
    for (const command of leafCommands(script)) {
      const nested = command.match(/^npm run ([\w:-]+)/);
      if (nested) visit(nested[1]);
      else leaves.push(command);
    }
  };
  for (const name of names) visit(name);
  return leaves;
}

function main(argv) {
  const ceilingIndex = argv.indexOf("--ceiling");
  const ceiling = ceilingIndex >= 0 ? Number(argv[ceilingIndex + 1]) : DEFAULT_CEILING;
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 1) {
    console.error("--ceiling takes a ratio between 0 and 1");
    return 2;
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  const testScripts = Object.keys(scripts).filter((name) => /^test(:|$)/.test(name));
  const leaves = walk(scripts, testScripts);

  const nodeCommands = leaves.filter((command) => /^node\b/.test(command));
  const ratio = nodeCommands.length / leaves.length;
  const bootMs = nodeCommands.length * NODE_BOOT_MS;

  console.log(
    `test boot cost: ${leaves.length} leaf commands, ${nodeCommands.length} start node ` +
      `(${(ratio * 100).toFixed(1)}%), ~${(bootMs / 1000).toFixed(1)}s of process boot per full run`,
  );
  console.log(`  ceiling: ${(ceiling * 100).toFixed(1)}%`);
  console.log("  the fast loop (npm run test:fast) runs the pure rules in one process; see package.json");

  if (ratio > ceiling) {
    console.error(
      `\nFAIL: ${(ratio * 100).toFixed(1)}% of leaf commands start a process, above the ${(ceiling * 100).toFixed(1)}% ceiling.\n` +
        "Fold pure `lib/` tests into a grouped runner instead of adding another top-level command.",
    );
    return 1;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
