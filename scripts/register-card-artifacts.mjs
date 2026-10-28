#!/usr/bin/env node
/**
 * Register a card's own documents in its state.md artifact trail.
 *
 * The audit gate refuses completion when the state dir holds a document that
 * `state.md` never registered — the trail is what the card shows a reader, and a
 * file the trail does not name is evidence nobody will find. Old cards wrote
 * some of these (an audit run's report, a verification ui-review) without
 * registering them, so `done` refused with the unregistered paths named.
 *
 * Only files the layout already treats as workflow documents are registered:
 * Markdown and JSON under the card's own areas, never `state.md`, its backups,
 * or anything under `runs/`' nested tool output that has no document shape.
 *
 * Usage: node scripts/register-card-artifacts.mjs --state <state.md> [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const args = process.argv.slice(2);
const stateAt = args.indexOf("--state");
const dryRun = args.includes("--dry-run");
if (stateAt < 0) {
  console.error("Usage: node scripts/register-card-artifacts.mjs --state <state.md> [--dry-run]");
  process.exit(2);
}

const statePath = args[stateAt + 1];
const cardDir = dirname(statePath);
const state = readFileSync(statePath, "utf8");

const SKIP_DIRS = new Set(["locks", ".git"]);
const DOCUMENT = /\.(md|json)$/;

function walk(dir, depth = 0) {
  if (depth > 4) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(path, depth + 1));
      continue;
    }
    if (!DOCUMENT.test(entry.name)) continue;
    if (entry.name === "state.md") continue;
    if (/\.bak|\.backup/.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

const registered = new Set(
  [...state.matchAll(/^\s*path:\s*(\S+)\s*$/gm)].map((match) => match[1]),
);
// The state dir's own root, as the card refers to it (`.stelow/<date>/sw-<id>`),
// and the repository root three segments above it.
const root = cardDir.slice(cardDir.indexOf(".stelow"));
const repoRoot = join(cardDir, "..", "..", "..");
const toRegister = walk(cardDir)
  .map((path) => relative(repoRoot, path))
  .filter((path) => !registered.has(path));

if (toRegister.length === 0) {
  console.log(`${statePath}: every document is registered`);
  process.exit(0);
}
if (dryRun) {
  console.log(`${statePath}: would register ${toRegister.length}`);
  for (const path of toRegister) console.log("  " + path);
  process.exit(0);
}

const AREA_STAGES = new Set([
  "plans", "critiques", "verification", "context", "execution", "runs",
  "architecture", "interfaces", "diagnosis", "gate",
]);

const entryFor = (path) => {
  const area = path.split("/")[3] ?? "";
  const stage = AREA_STAGES.has(area)
    ? area
    : path.endsWith("audit.md") ? "audit" : "execution";
  return [
    `  - stage: ${stage}`,
    "    kind: document",
    `    label: ${path.split("/").pop()}`,
    `    path: ${path}`,
    `    generated_at: ${new Date().toISOString()}`,
  ].join("\n");
};

const block = toRegister.map(entryFor).join("\n");
// `artifacts:` may be empty or absent; append to whichever shape this file has.
let next;
if (/^artifacts:\s*$/m.test(state)) {
  next = state.replace(/^artifacts:\s*$/m, `artifacts:\n${block}`);
} else {
  next = state.replace(/^history:/m, `artifacts:\n${block}\n\nhistory:`);
}
writeFileSync(statePath, next);
console.log(`${statePath}: registered ${toRegister.length} document(s)`);
for (const path of toRegister) console.log("  " + path);
