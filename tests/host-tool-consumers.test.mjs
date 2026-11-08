import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_TOOL_IDS } from "../lib/host-tools.mjs";

/**
 * The About panel promises that workers use these tools when present. A row for
 * a tool the vendored methodology never names is that promise without a
 * mechanism, and it is invisible: the row renders, the probe reports "not
 * installed", and nothing anywhere says no step would call it.
 *
 * So every installable tool must be named in `skills/`, or be declared in
 * `data/host-tool-consumers.json` as host-only with a reason. A mention is
 * necessary, not sufficient — this gate cannot judge whether a mention is a
 * real consumer, only that the question was asked at the moment the tool was
 * added. That is the whole point: the tool arrives in a diff, and the diff now
 * has to answer.
 *
 * An exemption whose tool the skills DO mention is stale and fails, the same
 * way a healed fork entry does upstream: a standing exemption that is no longer
 * standing is a lie about the tree.
 *
 * The walk is over the vendored methodology, not over source: `skills/` is
 * synced content, so reading it is a fact about upstream, not a source pin.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(root, "skills");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile() && /\.(md|sh|json|yaml)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const corpus = walk(skillsRoot)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** Named as a word: `sem` must not be satisfied by `semantic`. */
function namesTool(id) {
  return new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(corpus);
}

const ledger = JSON.parse(readFileSync(join(root, "data", "host-tool-consumers.json"), "utf8"));
assert.ok(Array.isArray(ledger.hostOnly), "host-tool-consumers.json names a hostOnly list");

const declared = new Map();
for (const entry of ledger.hostOnly) {
  assert.ok(HOST_TOOL_IDS.includes(entry.id), `hostOnly names a real tool: ${entry.id}`);
  assert.ok(
    typeof entry.reason === "string" && entry.reason.trim().length > 20,
    `hostOnly entry ${entry.id} states why the skill tree cannot name it`,
  );
  declared.set(entry.id, entry.reason);
}

for (const id of HOST_TOOL_IDS) {
  if (namesTool(id)) {
    assert.ok(
      !declared.has(id),
      `${id} is named in skills/ — its host-only exemption is stale, drop it`,
    );
    continue;
  }
  assert.ok(
    declared.has(id),
    `${id} is advertised in the About panel but named nowhere in skills/. Name it in a skill `
    + `reference (see code-map.md for the retrieval tools), or declare it host-only with a reason `
    + `in data/host-tool-consumers.json.`,
  );
}

console.log(
  `host tool consumers ok: ${HOST_TOOL_IDS.length} advertised tool(s), `
  + `${ledger.hostOnly.length} host-only exemption(s)`,
);
