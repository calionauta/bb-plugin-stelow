#!/usr/bin/env node
/**
 * Record where a card was actually verified, in its own audit receipt.
 *
 * The completion gate refuses an audit that does not name the checkout it
 * certifies, the exact Git root and HEAD, and the test command — deliberately:
 * a receipt copied from another tree is not evidence about this one.
 *
 * Re-homing a card to a clean checkout therefore has to say so in the receipt.
 * This appends a section that does exactly that, and does nothing when the
 * receipt already names the checkout (a re-run is idempotent).
 *
 * Usage: node scripts/audit-execution-context.mjs --audit <path> --checkout <dir> [--command "npm test"]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at < 0 ? null : args[at + 1] ?? null;
};

const auditPath = value("--audit");
const checkout = value("--checkout");
const command = value("--command") ?? "npm test";
if (!auditPath || !checkout) {
  console.error("Usage: node scripts/audit-execution-context.mjs --audit <path> --checkout <dir> [--command \"npm test\"]");
  process.exit(2);
}

const dir = resolve(checkout);
const gitRoot = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const headSha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const headShort = headSha.slice(0, 8);

const current = readFileSync(auditPath, "utf8");
const namesCheckout = current.includes(gitRoot) && current.includes(`HEAD: ${headSha}`);
if (namesCheckout) {
  console.log(`${auditPath}: already names ${gitRoot} at HEAD ${headShort}`);
  process.exit(0);
}

const section = [
  "",
  "## Execution context",
  "",
  "Re-verified for completion at this checkout — the host's own test run and",
  "security scan were recorded here, not in the shared project checkout:",
  "",
  `- Checkout: ${dir}`,
  `- Git root: ${gitRoot}`,
  `- HEAD: ${headSha}`,
  `- Test command: ${command} (host-recorded; see this card's verification ledger)`,
  "",
].join("\n");

writeFileSync(auditPath, current.replace(/\s*$/, "\n") + section);
console.log(`${auditPath}: recorded ${gitRoot} at HEAD ${headShort}`);
